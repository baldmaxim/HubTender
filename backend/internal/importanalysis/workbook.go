package importanalysis

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strings"

	"github.com/xuri/excelize/v2"
)

// WorkbookLimitError — превышение защитных лимитов (§15) → HTTP 413.
type WorkbookLimitError struct {
	Code   string // BOQ_IMPORT_FILE_TOO_LARGE | BOQ_IMPORT_WORKBOOK_LIMIT_EXCEEDED
	Reason string
}

func (e *WorkbookLimitError) Error() string { return e.Code + ": " + e.Reason }

// InvalidWorkbookError — файл не является поддерживаемым xlsx (§15).
type InvalidWorkbookError struct {
	Reason string
}

func (e *InvalidWorkbookError) Error() string { return "BOQ_IMPORT_INVALID_WORKBOOK: " + e.Reason }

// Fingerprint — SHA-256 исходных bytes файла (§3). В БД не сохраняется.
func Fingerprint(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

// preflight — проверки ДО полного parse (§15): подпись ZIP, состав, размеры,
// подозрительный compression ratio, запрет macro-enabled.
func preflight(data []byte) error {
	if len(data) > MaxCompressedBytes {
		return &WorkbookLimitError{Code: "BOQ_IMPORT_FILE_TOO_LARGE",
			Reason: fmt.Sprintf("файл больше %d MB", MaxCompressedBytes>>20)}
	}
	// Подпись ZIP (xlsx = zip): не полагаемся на расширение.
	if len(data) < 4 || data[0] != 'P' || data[1] != 'K' {
		return &InvalidWorkbookError{Reason: "файл не является xlsx (нет ZIP-подписи)"}
	}
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return &InvalidWorkbookError{Reason: "повреждённый xlsx-архив"}
	}
	if len(zr.File) > MaxZipEntries {
		return &WorkbookLimitError{Code: "BOQ_IMPORT_WORKBOOK_LIMIT_EXCEEDED",
			Reason: fmt.Sprintf("слишком много записей в архиве (%d)", len(zr.File))}
	}
	var totalUncompressed uint64
	hasContentTypes, hasWorkbook := false, false
	for _, f := range zr.File {
		totalUncompressed += f.UncompressedSize64
		name := f.Name
		if name == "[Content_Types].xml" {
			hasContentTypes = true
		}
		if name == "xl/workbook.xml" {
			hasWorkbook = true
		}
		// Запрет macro-enabled (§9/§15): macros никогда не исполняются и не
		// принимаются.
		if strings.Contains(name, "vbaProject") {
			return &InvalidWorkbookError{Reason: "macro-enabled workbook (.xlsm) не поддерживается"}
		}
	}
	if !hasContentTypes || !hasWorkbook {
		return &InvalidWorkbookError{Reason: "архив не является Excel workbook (xlsx)"}
	}
	if totalUncompressed > MaxUncompressedBytes {
		return &WorkbookLimitError{Code: "BOQ_IMPORT_WORKBOOK_LIMIT_EXCEEDED",
			Reason: "распакованный размер превышает лимит"}
	}
	if len(data) > 4096 && totalUncompressed > uint64(len(data))*MaxCompressionRatio {
		return &WorkbookLimitError{Code: "BOQ_IMPORT_WORKBOOK_LIMIT_EXCEEDED",
			Reason: "подозрительная степень сжатия архива"}
	}
	return nil
}

// OpenWorkbook — читает разрешённый xlsx в нормализованное представление
// (§2A). Формулы НЕ исполняются: сохраняется текст формулы и cached-значение,
// как их отдаёт excelize. Никаких финансовых расчётов.
func OpenWorkbook(fileName string, data []byte) (*Workbook, error) {
	if err := preflight(data); err != nil {
		return nil, err
	}
	f, err := excelize.OpenReader(bytes.NewReader(data))
	if err != nil {
		return nil, &InvalidWorkbookError{Reason: "excelize не смог открыть файл"}
	}
	defer f.Close() //nolint:errcheck

	wb := &Workbook{FileName: fileName, Fingerprint: Fingerprint(data)}
	sheetList := f.GetSheetList()
	if len(sheetList) == 0 {
		return nil, &InvalidWorkbookError{Reason: "в файле нет листов"}
	}
	if len(sheetList) > MaxSheets {
		return nil, &WorkbookLimitError{Code: "BOQ_IMPORT_WORKBOOK_LIMIT_EXCEEDED",
			Reason: fmt.Sprintf("слишком много листов (%d)", len(sheetList))}
	}

	for _, name := range sheetList {
		visible, _ := f.GetSheetVisible(name)
		rows, err := f.GetRows(name) // cached/отображаемые значения
		if err != nil {
			return nil, &InvalidWorkbookError{Reason: "не удалось прочитать лист «" + name + "»"}
		}
		if len(rows) > MaxRowsPerSheet {
			return nil, &WorkbookLimitError{Code: "BOQ_IMPORT_WORKBOOK_LIMIT_EXCEEDED",
				Reason: fmt.Sprintf("лист «%s»: строк больше лимита %d", name, MaxRowsPerSheet)}
		}
		sheet := Sheet{Name: name, Visible: visible}
		for ri, row := range rows {
			if len(row) > MaxColumnsPerSheet {
				return nil, &WorkbookLimitError{Code: "BOQ_IMPORT_WORKBOOK_LIMIT_EXCEEDED",
					Reason: fmt.Sprintf("лист «%s»: колонок больше лимита %d", name, MaxColumnsPerSheet)}
			}
			cells := make([]Cell, len(row))
			for ci, v := range row {
				if len(v) > MaxCellChars {
					v = v[:MaxCellChars]
				}
				cells[ci] = Cell{Raw: v}
				// Формула: excelize отдаёт текст формулы отдельно; cached
				// значение уже в Raw (GetRows возвращает cached result).
				cellName, _ := excelize.CoordinatesToCellName(ci+1, ri+1)
				if formula, _ := f.GetCellFormula(name, cellName); formula != "" {
					cells[ci].IsFormula = true
					cells[ci].Formula = formula
				}
			}
			sheet.Rows = append(sheet.Rows, cells)
		}
		wb.Sheets = append(wb.Sheets, sheet)
	}
	return wb, nil
}

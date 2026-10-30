package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"reflect"
	"regexp"
	"strings"

	"github.com/go-playground/validator/v10"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/su10/hubtender/backend/internal/calc"
	"github.com/su10/hubtender/backend/internal/repository"
	"github.com/su10/hubtender/backend/pkg/apierr"
)

// Пакетная запись строк прогона авторасценки:
// POST /api/v1/autoprice-runs/{sid}/items:bulk.

const (
	maxAutopriceBulkBody      = 8 << 20 // 8 МБ
	maxAutopriceBulkPositions = 50
	maxAutopriceBulkItems     = 2000
)

// autopriceBulkStore — граница сервиса пакетной записи.
type autopriceBulkStore interface {
	BulkWrite(ctx context.Context, sessionID, actorID string, positions []repository.AutopriceBulkPosition) (*repository.AutopriceBulkResult, error)
}

// AutopriceBulkHandler — пакетная запись строк BOQ прогона авторасценки.
type AutopriceBulkHandler struct {
	store    autopriceBulkStore
	validate *validator.Validate
}

// NewAutopriceBulkHandler creates an AutopriceBulkHandler.
func NewAutopriceBulkHandler(store autopriceBulkStore) *AutopriceBulkHandler {
	v := validator.New()
	// Имя поля в ошибках валидации — json-имя, а не имя Go-поля.
	v.RegisterTagNameFunc(func(f reflect.StructField) string {
		name := strings.SplitN(f.Tag.Get("json"), ",", 2)[0]
		if name == "-" {
			return ""
		}
		return name
	})
	return &AutopriceBulkHandler{store: store, validate: v}
}

// autopriceBulkItemReq — строка запроса: поля createBoqItemReq (те же правила
// и validate-теги) плюс ref/parent_ref. Поля parent_work_item_id и
// import_session_id из createBoqItemReq в пакете не действуют: родитель
// задаётся только через parent_ref, сессия — путём запроса.
type autopriceBulkItemReq struct {
	Ref       string `json:"ref"`
	ParentRef string `json:"parent_ref"`
	createBoqItemReq
}

type autopriceBulkPositionReq struct {
	PositionID string                 `json:"position_id"`
	Replace    bool                   `json:"replace"`
	Items      []autopriceBulkItemReq `json:"items"`
	Review     json.RawMessage        `json:"review"`
}

type autopriceBulkReq struct {
	Positions []autopriceBulkPositionReq `json:"positions"`
}

// autopriceBulkInvalid — первая найденная ошибка тела (422 invalid_item).
type autopriceBulkInvalid struct {
	PositionID, Ref, Field, Message string
}

// autopriceBulkExtras — position_id/ref/field из *AutopriceBulkError для тела ответа.
func autopriceBulkExtras(err error) map[string]any {
	var be *repository.AutopriceBulkError
	if !errors.As(err, &be) {
		return nil
	}
	m := map[string]any{"position_id": be.PositionID}
	if be.Ref != "" {
		m["ref"] = be.Ref
	}
	if be.Field != "" {
		m["field"] = be.Field
	}
	return m
}

func autopriceInvalidItem(w http.ResponseWriter, inv autopriceBulkInvalid) {
	extras := map[string]any{"position_id": inv.PositionID, "ref": inv.Ref, "field": inv.Field}
	autopriceError(w, http.StatusUnprocessableEntity, "invalid_item", inv.Message, extras)
}

// validationMessage — русский текст ошибки validator'а по тегу.
func validationMessage(fe validator.FieldError) string {
	switch fe.Tag() {
	case "required":
		return fe.Field() + ": обязательное поле"
	case "uuid":
		return fe.Field() + ": ожидается UUID"
	case "gte":
		return fmt.Sprintf("%s: значение не меньше %s", fe.Field(), fe.Param())
	case "gt":
		return fmt.Sprintf("%s: значение больше %s", fe.Field(), fe.Param())
	}
	return fe.Field() + ": недопустимое значение (" + fe.Tag() + ")"
}

// buildBulk проверяет тело до обращения к БД и собирает вход репозитория.
func (h *AutopriceBulkHandler) buildBulk(req autopriceBulkReq) ([]repository.AutopriceBulkPosition, *autopriceBulkInvalid) {
	out := make([]repository.AutopriceBulkPosition, 0, len(req.Positions))
	seenPos := make(map[string]bool, len(req.Positions))
	for _, p := range req.Positions {
		if !uuidPatchRe.MatchString(p.PositionID) {
			return nil, &autopriceBulkInvalid{p.PositionID, "", "position_id", "position_id: ожидается UUID позиции"}
		}
		if seenPos[p.PositionID] {
			return nil, &autopriceBulkInvalid{p.PositionID, "", "position_id", "position_id: позиция повторяется в запросе"}
		}
		seenPos[p.PositionID] = true

		items, inv := h.buildBulkItems(p)
		if inv != nil {
			return nil, inv
		}
		bp := repository.AutopriceBulkPosition{PositionID: p.PositionID, Replace: p.Replace, Items: items}
		if !isJSONNull(p.Review) {
			var rr putAutopriceReviewReq
			if err := json.Unmarshal(p.Review, &rr); err != nil {
				return nil, &autopriceBulkInvalid{p.PositionID, "", "review", "review: ожидается объект {basis, pd_refs, pd_note, questions, findings, volume_source}"}
			}
			in, field, msg := buildAutopriceReviewInput(rr)
			if msg != "" {
				return nil, &autopriceBulkInvalid{p.PositionID, "", "review." + field, msg}
			}
			bp.Review = &in
		}
		out = append(out, bp)
	}
	return out, nil
}

// buildBulkItems проверяет строки позиции: ref, parent_ref, тип, поля и
// согласованность название/тип; возвращает вход репозитория в порядке запроса.
func (h *AutopriceBulkHandler) buildBulkItems(p autopriceBulkPositionReq) ([]repository.AutopriceBulkItem, *autopriceBulkInvalid) {
	// Первый проход: ref уникальны, тип известен — иначе parent_ref не проверить.
	types := make(map[string]string, len(p.Items))
	for _, it := range p.Items {
		inv := func(field, msg string) *autopriceBulkInvalid {
			return &autopriceBulkInvalid{p.PositionID, it.Ref, field, msg}
		}
		if strings.TrimSpace(it.Ref) == "" {
			return nil, inv("ref", "ref: обязателен (произвольный ключ строки в пределах позиции)")
		}
		if _, dup := types[it.Ref]; dup {
			return nil, inv("ref", "ref: повторяется в позиции")
		}
		types[it.Ref] = it.BoqItemType
	}

	out := make([]repository.AutopriceBulkItem, 0, len(p.Items))
	for _, it := range p.Items {
		inv := func(field, msg string) *autopriceBulkInvalid {
			return &autopriceBulkInvalid{p.PositionID, it.Ref, field, msg}
		}
		isWork, isMat := calc.IsWorkBoqType(it.BoqItemType), calc.IsMaterialBoqType(it.BoqItemType)
		if err := h.validate.Struct(it.createBoqItemReq); err != nil {
			var ve validator.ValidationErrors
			if errors.As(err, &ve) && len(ve) > 0 {
				return nil, inv(ve[0].Field(), validationMessage(ve[0]))
			}
			return nil, inv("", "строка не прошла проверку: "+err.Error())
		}
		if !isWork && !isMat {
			return nil, inv("boq_item_type", "boq_item_type: раб, суб-раб, раб-комп., мат, суб-мат или мат-комп.")
		}
		if it.ParentWorkItemID != nil {
			return nil, inv("parent_work_item_id", "parent_work_item_id: в пакете не принимается, родитель задаётся через parent_ref")
		}
		if isWork && it.ParentRef != "" {
			return nil, inv("parent_ref", "parent_ref: у работы родителя быть не может, привязывается материал")
		}
		if it.ParentRef != "" {
			pt, ok := types[it.ParentRef]
			switch {
			case it.ParentRef == it.Ref:
				return nil, inv("parent_ref", "parent_ref: строка не может ссылаться на саму себя")
			case !ok:
				return nil, inv("parent_ref", "parent_ref: строка с таким ref не найдена в этой позиции")
			case !calc.IsWorkBoqType(pt):
				return nil, inv("parent_ref", "parent_ref: указывает не на работу ("+pt+")")
			}
		}
		// boq_items_material_check: у работы work_name_id, у материала — material_name_id.
		if isWork {
			if it.WorkNameID == nil {
				return nil, inv("work_name_id", "work_name_id: у работы обязателен")
			}
			if it.MaterialNameID != nil {
				return nil, inv("material_name_id", "material_name_id: у работы не задаётся")
			}
		} else {
			if it.MaterialNameID == nil {
				return nil, inv("material_name_id", "material_name_id: у материала обязателен")
			}
			if it.WorkNameID != nil {
				return nil, inv("work_name_id", "work_name_id: у материала не задаётся")
			}
		}
		out = append(out, repository.AutopriceBulkItem{
			Ref: it.Ref, ParentRef: it.ParentRef,
			Item: repository.CreateBoqItemInput{
				BoqItemType:            it.BoqItemType,
				MaterialType:           it.MaterialType,
				Description:            it.Description,
				UnitCode:               it.UnitCode,
				Quantity:               it.Quantity,
				BaseQuantity:           it.BaseQuantity,
				ConversionCoefficient:  it.ConversionCoefficient,
				UnitRate:               it.UnitRate,
				CurrencyType:           it.CurrencyType,
				DeliveryPriceType:      it.DeliveryPriceType,
				DeliveryAmount:         it.DeliveryAmount,
				ConsumptionCoefficient: it.ConsumptionCoefficient,
				DetailCostCategoryID:   it.DetailCostCategoryID,
				MaterialNameID:         it.MaterialNameID,
				WorkNameID:             it.WorkNameID,
				SortNumber:             it.SortNumber,
				QuoteLink:              it.QuoteLink,
				QuotePriceDate:         it.QuotePriceDate,
				QuoteValidUntil:        it.QuoteValidUntil,
			},
		})
	}
	return out, nil
}

// PostBulk handles POST /api/v1/autoprice-runs/{sid}/items:bulk.
func (h *AutopriceBulkHandler) PostBulk(w http.ResponseWriter, r *http.Request) {
	user := autopriceUser(w, r)
	if user == nil {
		return
	}
	ids, ok := autopriceIDs(w, r, "sid")
	if !ok {
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, maxAutopriceBulkBody)
	var req autopriceBulkReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		var tooBig *http.MaxBytesError
		if errors.As(err, &tooBig) {
			autopriceError(w, http.StatusRequestEntityTooLarge, "too_large",
				"Тело запроса больше 8 МБ: разбейте пакет (не больше 50 позиций и 2000 строк).", nil)
			return
		}
		autopriceBadRequest(w, "Некорректный JSON.")
		return
	}

	items := 0
	for _, p := range req.Positions {
		items += len(p.Items)
	}
	if len(req.Positions) == 0 {
		autopriceBadRequest(w, "positions: нужна хотя бы одна позиция.")
		return
	}
	if len(req.Positions) > maxAutopriceBulkPositions || items > maxAutopriceBulkItems {
		autopriceError(w, http.StatusRequestEntityTooLarge, "too_large", fmt.Sprintf(
			"не больше %d позиций и %d строк на запрос: получено %d позиций, %d строк",
			maxAutopriceBulkPositions, maxAutopriceBulkItems, len(req.Positions), items), nil)
		return
	}

	positions, inv := h.buildBulk(req)
	if inv != nil {
		if inv.Field == "review.volume_source" {
			autopriceInvalidVolumeSource(w, inv.Message,
				map[string]any{"position_id": inv.PositionID, "field": inv.Field})
			return
		}
		autopriceInvalidItem(w, *inv)
		return
	}

	res, err := h.store.BulkWrite(r.Context(), ids[0], user.ID, positions)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	autopriceJSON(w, http.StatusOK, map[string]any{"data": res.Positions})
}

// Поля, в которых DB-ограничения boq_items видны клиенту как поле запроса.
var (
	bulkConstraintFields = map[string]string{
		"boq_items_material_name_id_fkey":            "material_name_id",
		"boq_items_work_name_id_fkey":                "work_name_id",
		"boq_items_unit_code_fkey":                   "unit_code",
		"boq_items_detail_cost_category_id_fkey":     "detail_cost_category_id",
		"boq_items_material_check":                   "boq_item_type",
		"boq_items_parent_work_check":                "parent_ref",
		"boq_items_delivery_amount_check":            "delivery_price_type",
		"boq_items_quantity_positive":                "quantity",
		"boq_items_base_quantity_positive":           "base_quantity",
		"boq_items_consumption_coefficient_positive": "consumption_coefficient",
		"boq_items_conversion_coefficient_positive":  "conversion_coefficient",
	}
	bulkEnumFields = map[string]string{
		"boq_item_type": "boq_item_type", "material_type": "material_type",
		"currency_type": "currency_type", "delivery_price_type": "delivery_price_type",
	}
	bulkEnumRe = regexp.MustCompile(`enum (?:\w+\.)?(\w+)`)
)

// bulkPgInvalid переводит ошибку БД по значению поля в invalid_item: FK на
// справочники, CHECK-ограничения, неверные значения enum/чисел. Прочее — не
// ошибка клиента (ok=false).
func bulkPgInvalid(err error) (field, message string, ok bool) {
	var pg *pgconn.PgError
	if !errors.As(err, &pg) {
		return "", "", false
	}
	switch pg.Code {
	case "23503": // foreign_key_violation
		return bulkConstraintFields[pg.ConstraintName], "значение не найдено в справочнике: " + pg.Detail, true
	case "23514": // check_violation
		return bulkConstraintFields[pg.ConstraintName], "значения полей не согласованы (ограничение " + pg.ConstraintName + ")", true
	case "23502": // not_null_violation
		return pg.ColumnName, "обязательное поле не задано: " + pg.ColumnName, true
	case "22P02": // invalid_text_representation (enum, uuid, число)
		if m := bulkEnumRe.FindStringSubmatch(pg.Message); m != nil {
			return bulkEnumFields[m[1]], "недопустимое значение: " + pg.Message, true
		}
		return "", "недопустимое значение: " + pg.Message, true
	case "22003": // numeric_value_out_of_range
		return "", "число вне допустимого диапазона: " + pg.Message, true
	}
	return "", "", false
}

// writeError — соответствие ошибок пакетной записи кодам ответа: общие ошибки
// прогона/позиции — autopriceRepoError (с position_id/ref/field), ошибки
// значений строки — 422 invalid_item.
func (h *AutopriceBulkHandler) writeError(w http.ResponseWriter, r *http.Request, err error) {
	extras := autopriceBulkExtras(err)
	if extras == nil {
		extras = map[string]any{}
	}
	var fx *calc.MissingFXRateError
	var qd *repository.InvalidQuoteDatesError
	switch {
	case errors.As(err, &fx):
		p := apierr.MissingFXRate(fx.Currency)
		for k, v := range extras {
			p.Extras[k] = v
		}
		p.Render(w)
		return
	case errors.As(err, &qd):
		field := "quote_valid_until"
		if strings.Contains(strings.ToLower(qd.Reason), "цены") {
			field = "quote_price_date"
		}
		extras["field"] = field
		autopriceError(w, http.StatusUnprocessableEntity, "invalid_item", qd.Reason, extras)
		return
	case errors.Is(err, repository.ErrAutopriceForeignChildren):
		autopriceError(w, http.StatusConflict, "foreign_children",
			"У заменяемых строк есть дочерние строки не из этого прогона (ручные или другого прогона): удалите или отвяжите их.", extras)
		return
	}
	var be *repository.AutopriceBulkError
	if errors.As(err, &be) {
		if field, msg, ok := bulkPgInvalid(be.Err); ok {
			extras["field"] = field
			autopriceError(w, http.StatusUnprocessableEntity, "invalid_item", msg, extras)
			return
		}
		// parent_ref, не найденный/не работа, пойманный на уровне репозитория.
		if be.Field == "parent_ref" {
			autopriceError(w, http.StatusUnprocessableEntity, "invalid_item", be.Err.Error(), extras)
			return
		}
	}
	autopriceRepoError(w, r, err, "failed to bulk write autoprice items")
}

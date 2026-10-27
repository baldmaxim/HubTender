package handlers

import (
	"bytes"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/textproto"
	"strings"
	"testing"
)

var (
	testPDF   = append([]byte("%PDF-1.7\n"), make([]byte, 64)...)
	testTIFFL = append([]byte{'I', 'I', '*', 0x00, 0x08, 0x00, 0x00, 0x00}, make([]byte, 64)...)
	testTIFFB = append([]byte{'M', 'M', 0x00, '*', 0x00, 0x00, 0x00, 0x08}, make([]byte, 64)...)
)

type documentForm struct {
	file     []byte
	fileName string
	title    string
	docDate  string
	noFile   bool
}

func validDocumentForm() documentForm {
	return documentForm{file: testPDF, fileName: "Разрешение на ввод.pdf", title: "  Разрешение  ", docDate: "2024-05-17"}
}

func (f documentForm) request(t *testing.T) (*httptest.ResponseRecorder, *http.Request) {
	t.Helper()
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	if !f.noFile {
		// Content-Type части заведомо ложный: тип проверяется по байтам.
		h := make(textproto.MIMEHeader)
		h.Set("Content-Disposition", `form-data; name="file"; filename="`+f.fileName+`"`)
		h.Set("Content-Type", "text/plain")
		w, err := mw.CreatePart(h)
		if err != nil {
			t.Fatal(err)
		}
		_, _ = w.Write(f.file)
	}
	_ = mw.WriteField("title", f.title)
	_ = mw.WriteField("doc_date", f.docDate)
	_ = mw.Close()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/construction-objects/x/documents", &buf)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	return httptest.NewRecorder(), req
}

func TestParseObjectDocumentUpload(t *testing.T) {
	tests := []struct {
		name       string
		mutate     func(f *documentForm)
		wantStatus int    // 0 — без ошибки
		wantErr    string // подстрока detail
	}{
		{"valid pdf", func(f *documentForm) {}, 0, ""},
		{"valid jpeg", func(f *documentForm) { f.file = testJPEG }, 0, ""},
		{"valid png", func(f *documentForm) { f.file = testPNG }, 0, ""},
		{"valid webp", func(f *documentForm) { f.file = testWebP }, 0, ""},
		{"valid tiff little-endian", func(f *documentForm) { f.file = testTIFFL }, 0, ""},
		{"valid tiff big-endian", func(f *documentForm) { f.file = testTIFFB }, 0, ""},
		{"no file", func(f *documentForm) { f.noFile = true }, 400, "file"},
		{"empty file", func(f *documentForm) { f.file = nil }, 400, "file"},
		{"unsupported type", func(f *documentForm) { f.file = []byte("<html>not a document</html>") }, 400, "file"},
		{"gif rejected", func(f *documentForm) { f.file = []byte("GIF89a....") }, 400, "file"},
		{"file too large", func(f *documentForm) {
			f.file = append(append([]byte{}, testPDF...), make([]byte, maxObjectDocumentFileBytes)...)
		}, 413, "file"},
		{"body too large", func(f *documentForm) {
			f.file = append(append([]byte{}, testPDF...), make([]byte, maxObjectDocumentBodyBytes)...)
		}, 413, ""},
		{"title too long", func(f *documentForm) { f.title = strings.Repeat("я", maxObjectDocumentTitleLen+1) }, 400, "title"},
		{"title max length", func(f *documentForm) { f.title = strings.Repeat("я", maxObjectDocumentTitleLen) }, 0, ""},
		{"no title", func(f *documentForm) { f.title = "   " }, 0, ""},
		{"no date", func(f *documentForm) { f.docDate = "" }, 0, ""},
		{"date wrong format", func(f *documentForm) { f.docDate = "17.05.2024" }, 400, "doc_date"},
		{"date not a date", func(f *documentForm) { f.docDate = "2024-02-31" }, 400, "doc_date"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			f := validDocumentForm()
			tc.mutate(&f)
			w, req := f.request(t)
			in, prob := parseObjectDocumentUpload(w, req)
			if tc.wantStatus == 0 {
				if prob != nil {
					t.Fatalf("unexpected problem: %+v", prob)
				}
				if in.Mime == "" || in.FileName == "" || len(in.Content) == 0 {
					t.Fatalf("incomplete input: %+v", in)
				}
				return
			}
			if prob == nil {
				t.Fatalf("expected status %d, got success", tc.wantStatus)
			}
			if prob.Status != tc.wantStatus {
				t.Fatalf("status = %d (%s), want %d", prob.Status, prob.Detail, tc.wantStatus)
			}
			if !strings.Contains(prob.Detail, tc.wantErr) {
				t.Fatalf("detail %q does not contain %q", prob.Detail, tc.wantErr)
			}
		})
	}
}

func TestParseObjectDocumentUploadFields(t *testing.T) {
	w, req := validDocumentForm().request(t)
	in, prob := parseObjectDocumentUpload(w, req)
	if prob != nil {
		t.Fatalf("unexpected problem: %+v", prob)
	}
	if in.Mime != "application/pdf" {
		t.Fatalf("mime = %q", in.Mime)
	}
	if in.FileName != "Разрешение на ввод.pdf" {
		t.Fatalf("file name = %q", in.FileName)
	}
	if in.Title == nil || *in.Title != "Разрешение" {
		t.Fatalf("title = %v", in.Title)
	}
	if in.DocDate == nil || *in.DocDate != "2024-05-17" {
		t.Fatalf("doc_date = %v", in.DocDate)
	}
}

func TestObjectDocumentMimeDetectsByBytes(t *testing.T) {
	cases := map[string][]byte{
		"application/pdf": testPDF,
		"image/jpeg":      testJPEG,
		"image/png":       testPNG,
		"image/webp":      testWebP,
		"image/tiff":      testTIFFL,
	}
	for want, data := range cases {
		if got := objectDocumentMime(data); got != want {
			t.Errorf("mime = %q, want %q", got, want)
		}
	}
	if got := objectDocumentMime([]byte("plain text")); got != "" {
		t.Errorf("plain text must be rejected, got %q", got)
	}
}

func TestSanitizeObjectDocumentName(t *testing.T) {
	tests := []struct{ in, want string }{
		{"Разрешение.pdf", "Разрешение.pdf"},
		{`C:\Users\Иван\Скан 1.pdf`, "Скан 1.pdf"},
		{"../../etc/passwd", "passwd"},
		{"dir/sub/файл.tif", "файл.tif"},
		{"a\x00b\r\nc.pdf", "abc.pdf"},
		{"   ", objectDocumentFallbackName},
		{"", objectDocumentFallbackName},
		{"..", objectDocumentFallbackName},
		{strings.Repeat("я", 300) + ".pdf", strings.Repeat("я", maxObjectDocumentNameLen)},
	}
	for _, tc := range tests {
		if got := sanitizeObjectDocumentName(tc.in); got != tc.want {
			t.Errorf("sanitize(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}
}

func TestContentDispositionHeaderCyrillic(t *testing.T) {
	got := contentDispositionHeader("inline", "Разрешение №1.pdf")
	want := `inline; filename="__________ _1.pdf"; filename*=UTF-8''%D0%A0%D0%B0%D0%B7%D1%80%D0%B5%D1%88%D0%B5%D0%BD%D0%B8%D0%B5%20%E2%84%961.pdf`
	if got != want {
		t.Fatalf("got  %s\nwant %s", got, want)
	}
}

func TestContentDispositionHeaderEscapesQuotes(t *testing.T) {
	got := contentDispositionHeader("attachment", `a"b\c%d.pdf`)
	want := `attachment; filename="a_b_c_d.pdf"; filename*=UTF-8''a%22b%5Cc%25d.pdf`
	if got != want {
		t.Fatalf("got  %s\nwant %s", got, want)
	}
}

func TestNormalizeObjectDocumentTitleAndDate(t *testing.T) {
	if v, p := normalizeObjectDocumentTitle("   "); v != nil || p != nil {
		t.Fatalf("blank title must become nil, got %v %v", v, p)
	}
	if v, p := normalizeObjectDocumentTitle(" a "); p != nil || v == nil || *v != "a" {
		t.Fatalf("trim failed: %v %v", v, p)
	}
	if v, p := normalizeObjectDocumentDate(""); v != nil || p != nil {
		t.Fatalf("blank date must become nil, got %v %v", v, p)
	}
	if _, p := normalizeObjectDocumentDate("2024-5-1"); p == nil {
		t.Fatal("non-padded date must be rejected")
	}
}

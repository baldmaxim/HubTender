package handlers

import (
	"bytes"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

var (
	testJPEG = append([]byte{0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 'J', 'F', 'I', 'F', 0x00}, make([]byte, 64)...)
	testPNG  = append([]byte{0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A}, make([]byte, 64)...)
	testWebP = append([]byte("RIFF\x40\x00\x00\x00WEBPVP8 "), make([]byte, 64)...)
)

type photoForm struct {
	file, thumb   []byte
	width, height string
	caption       string
	noFile        bool
	noThumb       bool
}

func validPhotoForm() photoForm {
	return photoForm{file: testJPEG, thumb: testWebP, width: "1600", height: "1200", caption: "  Фасад  "}
}

func (f photoForm) request(t *testing.T) (*httptest.ResponseRecorder, *http.Request) {
	t.Helper()
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	addFile := func(field string, data []byte) {
		// Content-Type части заведомо ложный: тип проверяется по байтам.
		w, err := mw.CreateFormFile(field, field+".bin")
		if err != nil {
			t.Fatal(err)
		}
		_, _ = w.Write(data)
	}
	if !f.noFile {
		addFile("file", f.file)
	}
	if !f.noThumb {
		addFile("thumb", f.thumb)
	}
	_ = mw.WriteField("width", f.width)
	_ = mw.WriteField("height", f.height)
	_ = mw.WriteField("caption", f.caption)
	_ = mw.Close()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/construction-objects/x/photos", &buf)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	return httptest.NewRecorder(), req
}

func TestParseObjectPhotoUpload(t *testing.T) {
	tests := []struct {
		name       string
		mutate     func(f *photoForm)
		wantStatus int    // 0 — без ошибки
		wantErr    string // подстрока detail
	}{
		{"valid", func(f *photoForm) {}, 0, ""},
		{"valid png and webp", func(f *photoForm) { f.file, f.thumb = testPNG, testJPEG }, 0, ""},
		{"no file", func(f *photoForm) { f.noFile = true }, 400, "file"},
		{"no thumb", func(f *photoForm) { f.noThumb = true }, 400, "thumb"},
		{"empty file", func(f *photoForm) { f.file = nil }, 400, "file"},
		{"empty thumb", func(f *photoForm) { f.thumb = nil }, 400, "thumb"},
		{"file is not an image", func(f *photoForm) { f.file = []byte("<html>not an image</html>") }, 400, "file"},
		{"thumb is not an image", func(f *photoForm) { f.thumb = []byte("GIF89a....") }, 400, "thumb"},
		{"file too large", func(f *photoForm) {
			f.file = append(append([]byte{}, testJPEG...), make([]byte, maxObjectPhotoFileBytes)...)
		}, 413, "file"},
		{"thumb too large", func(f *photoForm) {
			f.thumb = append(append([]byte{}, testWebP...), make([]byte, maxObjectPhotoThumbBytes)...)
		}, 413, "thumb"},
		{"body too large", func(f *photoForm) {
			f.file = append(append([]byte{}, testJPEG...), make([]byte, maxObjectPhotoBodyBytes)...)
		}, 413, ""},
		{"width zero", func(f *photoForm) { f.width = "0" }, 400, "width"},
		{"width negative", func(f *photoForm) { f.width = "-5" }, 400, "width"},
		{"width too big", func(f *photoForm) { f.width = "10001" }, 400, "width"},
		{"width not a number", func(f *photoForm) { f.width = "abc" }, 400, "width"},
		{"width empty", func(f *photoForm) { f.width = "" }, 400, "width"},
		{"height zero", func(f *photoForm) { f.height = "0" }, 400, "height"},
		{"height too big", func(f *photoForm) { f.height = "10001" }, 400, "height"},
		{"height not a number", func(f *photoForm) { f.height = "1.5" }, 400, "height"},
		{"max dimensions", func(f *photoForm) { f.width, f.height = "10000", "1" }, 0, ""},
		{"caption too long", func(f *photoForm) { f.caption = strings.Repeat("я", maxObjectPhotoCaptionLen+1) }, 400, "caption"},
		{"no caption", func(f *photoForm) { f.caption = "   " }, 0, ""},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			f := validPhotoForm()
			tc.mutate(&f)
			w, req := f.request(t)
			in, prob := parseObjectPhotoUpload(w, req)
			if tc.wantStatus == 0 {
				if prob != nil {
					t.Fatalf("unexpected problem: %+v", prob)
				}
				if in.Mime == "" || in.ThumbMime == "" || in.Width < 1 || in.Height < 1 {
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

func TestParseObjectPhotoUploadDetectsMimeByBytes(t *testing.T) {
	f := validPhotoForm()
	f.file, f.thumb = testPNG, testWebP
	w, req := f.request(t)
	in, prob := parseObjectPhotoUpload(w, req)
	if prob != nil {
		t.Fatalf("unexpected problem: %+v", prob)
	}
	if in.Mime != "image/png" || in.ThumbMime != "image/webp" {
		t.Fatalf("mime = %q / %q", in.Mime, in.ThumbMime)
	}
	if in.Caption == nil || *in.Caption != "Фасад" {
		t.Fatalf("caption = %v", in.Caption)
	}
}

func TestNormalizeObjectPhotoCaption(t *testing.T) {
	if c, p := normalizeObjectPhotoCaption("   "); c != nil || p != nil {
		t.Fatalf("blank caption must become nil, got %v %v", c, p)
	}
	if c, p := normalizeObjectPhotoCaption(" a "); p != nil || c == nil || *c != "a" {
		t.Fatalf("trim failed: %v %v", c, p)
	}
}

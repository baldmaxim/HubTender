package apierr

import (
	"errors"
	"fmt"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
)

func TestProblemFromPgErr(t *testing.T) {
	tests := []struct {
		name       string
		err        error
		overrides  map[string]string
		wantNil    bool
		wantStatus int
		wantDetail string
	}{
		{
			name:       "unique violation -> 409 default",
			err:        &pgconn.PgError{Code: "23505"},
			wantStatus: 409,
			wantDetail: "Запись с такими данными уже существует",
		},
		{
			name:       "foreign key violation -> 409 default",
			err:        &pgconn.PgError{Code: "23503"},
			wantStatus: 409,
			wantDetail: "Операция невозможна: запись связана с другими данными",
		},
		{
			name:       "check violation -> 400 default",
			err:        &pgconn.PgError{Code: "23514"},
			wantStatus: 400,
			wantDetail: "Данные не прошли проверку ограничений базы данных",
		},
		{
			name:       "override by constraint name",
			err:        &pgconn.PgError{Code: "23505", ConstraintName: "tenders_tender_number_version_key"},
			overrides:  map[string]string{"tenders_tender_number_version_key": "Тендер уже существует"},
			wantStatus: 409,
			wantDetail: "Тендер уже существует",
		},
		{
			name:       "wrapped pg error still matched",
			err:        fmt.Errorf("repo: %w", &pgconn.PgError{Code: "23503"}),
			wantStatus: 409,
		},
		{
			name:    "non-pg error -> nil",
			err:     errors.New("boom"),
			wantNil: true,
		},
		{
			name:    "nil error -> nil",
			err:     nil,
			wantNil: true,
		},
		{
			name:    "unhandled sqlstate -> nil",
			err:     &pgconn.PgError{Code: "23502"}, // not_null_violation
			wantNil: true,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := ProblemFromPgErr(tt.err, tt.overrides)
			if tt.wantNil {
				if got != nil {
					t.Fatalf("expected nil, got %+v", got)
				}
				return
			}
			if got == nil {
				t.Fatal("expected non-nil Problem")
			}
			if got.Status != tt.wantStatus {
				t.Errorf("status = %d, want %d", got.Status, tt.wantStatus)
			}
			if tt.wantDetail != "" && got.Detail != tt.wantDetail {
				t.Errorf("detail = %q, want %q", got.Detail, tt.wantDetail)
			}
		})
	}
}

package services

// In-memory реализация aiRolloutStore для unit-тестов: те же гейты и
// CAS-семантика, что и SQL-репозиторий (advisory lock ≈ один mutex).

import (
	"context"
	"math/big"
	"time"

	"github.com/su10/hubtender/backend/internal/repository"
)

type fakeLedgerRow struct {
	id        string
	userID    string
	rows      int
	amount    string
	actual    string
	estimated string
	status    string
	outcome   string
	tokens    int
	createdAt time.Time
	expiresAt time.Time
}

type fakeFeedbackRow struct {
	requestID string
	userID    string
	hash      string
	conf      string
	detTop    *string
	aiSel     *string
	finalID   *string
	outcome   *string
	source    string
	imported  bool
}

type fakeRolloutState struct {
	pilots    map[string]repository.AIPilotUser
	circuit   repository.AICircuitState
	ledger    []fakeLedgerRow
	feedback  []fakeFeedbackRow
	evals     map[string]repository.AIEvaluationSummary
	evalSeq   int
	nowOffset time.Duration
}

func (f *fakeAIStore) rolloutState() *fakeRolloutState {
	if f.rs == nil {
		f.rs = &fakeRolloutState{
			pilots:  map[string]repository.AIPilotUser{},
			circuit: repository.AICircuitState{FeatureCode: repository.AIFeatureNomenclatureRerank, State: "closed"},
			evals:   map[string]repository.AIEvaluationSummary{},
		}
	}
	return f.rs
}

func (f *fakeAIStore) TransitionRolloutMode(_ context.Context, _, expectedFrom, target, updatedBy string) (*repository.AIFeatureSettings, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.row.RolloutMode != expectedFrom {
		return nil, repository.ErrAIRolloutConflict
	}
	f.row.RolloutMode = target
	f.row.RolloutConfigVersion++
	f.row.UpdatedBy = &updatedBy
	return f.snapshot(), nil
}

func (f *fakeAIStore) EmergencyOff(_ context.Context, _, updatedBy string) (string, *repository.AIFeatureSettings, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	prev := f.row.RolloutMode
	f.row.RolloutMode = repository.AIRolloutOff
	f.row.RolloutConfigVersion++
	f.row.UpdatedBy = &updatedBy
	return prev, f.snapshot(), nil
}

func (f *fakeAIStore) UpdateRolloutSettings(_ context.Context, _ string, p repository.AIRolloutSettingsPatch, updatedBy string) (*repository.AIFeatureSettings, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if p.DailyRequestLimit != nil {
		f.row.DailyRequestLimit = *p.DailyRequestLimit
	}
	if p.DailyRowLimit != nil {
		f.row.DailyRowLimit = *p.DailyRowLimit
	}
	if p.MonthlyBudgetUSD != nil {
		if *p.MonthlyBudgetUSD == "" {
			f.row.MonthlyBudgetUSD = nil
			f.row.MonthlyBudgetText = nil
		} else if r, ok := new(big.Rat).SetString(*p.MonthlyBudgetUSD); ok {
			v, _ := r.Float64()
			f.row.MonthlyBudgetUSD = &v
			txt := r.FloatString(2)
			f.row.MonthlyBudgetText = &txt
		}
	}
	if p.CircuitFailureThreshold != nil {
		f.row.CircuitFailureThreshold = *p.CircuitFailureThreshold
	}
	if p.CircuitCooldownSeconds != nil {
		f.row.CircuitCooldownSeconds = *p.CircuitCooldownSeconds
	}
	if p.ReservationTimeoutSeconds != nil {
		f.row.ReservationTimeoutSeconds = *p.ReservationTimeoutSeconds
	}
	f.row.RolloutConfigVersion++
	f.row.UpdatedBy = &updatedBy
	return f.snapshot(), nil
}

func (f *fakeAIStore) SetLastLiveEvaluation(_ context.Context, _, evalID string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	id := evalID
	f.row.LastLiveEvaluationID = &id
	return nil
}

func (f *fakeAIStore) ListPilotUsers(context.Context, string) ([]repository.AIPilotUser, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	rs := f.rolloutState()
	out := make([]repository.AIPilotUser, 0, len(rs.pilots))
	for _, p := range rs.pilots {
		out = append(out, p)
	}
	return out, nil
}

func (f *fakeAIStore) UpsertPilotUser(_ context.Context, feature, userID string, bulk bool, expiresAt *time.Time, addedBy string) (*repository.AIPilotUser, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	rs := f.rolloutState()
	if userID == "missing-user" {
		return nil, repository.ErrAIPilotUserNotFound
	}
	p := repository.AIPilotUser{
		FeatureCode: feature, UserID: userID, FullName: "U " + userID,
		Email: userID + "@t", IsActive: true,
		BulkConfirmationAllowed: bulk, ExpiresAt: expiresAt, AddedBy: &addedBy,
	}
	rs.pilots[userID] = p
	return &p, nil
}

func (f *fakeAIStore) PatchPilotUser(_ context.Context, _, userID string, patch repository.AIPilotPatch) (*repository.AIPilotUser, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	rs := f.rolloutState()
	p, ok := rs.pilots[userID]
	if !ok {
		return nil, repository.ErrAIPilotUserNotFound
	}
	if patch.IsActive != nil {
		p.IsActive = *patch.IsActive
	}
	if patch.DailyRequestLimitOverride != nil {
		if *patch.DailyRequestLimitOverride == 0 {
			p.DailyRequestLimitOverride = nil
		} else {
			p.DailyRequestLimitOverride = patch.DailyRequestLimitOverride
		}
	}
	if patch.DailyRowLimitOverride != nil {
		if *patch.DailyRowLimitOverride == 0 {
			p.DailyRowLimitOverride = nil
		} else {
			p.DailyRowLimitOverride = patch.DailyRowLimitOverride
		}
	}
	if patch.BulkConfirmationAllowed != nil {
		p.BulkConfirmationAllowed = *patch.BulkConfirmationAllowed
	}
	if patch.ClearExpiresAt {
		p.ExpiresAt = nil
	} else if patch.ExpiresAt != nil {
		p.ExpiresAt = patch.ExpiresAt
	}
	rs.pilots[userID] = p
	return &p, nil
}

func (f *fakeAIStore) RemovePilotUser(_ context.Context, _, userID string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	rs := f.rolloutState()
	if _, ok := rs.pilots[userID]; !ok {
		return repository.ErrAIPilotUserNotFound
	}
	delete(rs.pilots, userID)
	return nil
}

func (f *fakeAIStore) GetActivePilotMembership(_ context.Context, _, userID string) (*repository.AIPilotUser, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	rs := f.rolloutState()
	p, ok := rs.pilots[userID]
	if !ok || !p.IsActive {
		return nil, nil
	}
	if p.ExpiresAt != nil && !p.ExpiresAt.After(time.Now()) {
		return nil, nil
	}
	cp := p
	return &cp, nil
}

func (f *fakeAIStore) CountActivePilotUsers(ctx context.Context, feature string) (int, error) {
	list, _ := f.ListPilotUsers(ctx, feature)
	n := 0
	for _, p := range list {
		if p.IsActive && (p.ExpiresAt == nil || p.ExpiresAt.After(time.Now())) {
			n++
		}
	}
	return n, nil
}

func (f *fakeAIStore) GetCircuit(context.Context, string) (*repository.AICircuitState, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	c := f.rolloutState().circuit
	return &c, nil
}

func (f *fakeAIStore) CircuitAllowProbe(context.Context, string) (bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	rs := f.rolloutState()
	if rs.circuit.State == "open" && rs.circuit.OpenUntil != nil && !rs.circuit.OpenUntil.After(time.Now()) {
		rs.circuit.State = "half_open"
		return true, nil
	}
	return false, nil
}

func (f *fakeAIStore) CircuitRecordSuccess(context.Context, string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	rs := f.rolloutState()
	now := time.Now()
	rs.circuit.State = "closed"
	rs.circuit.ConsecutiveFailures = 0
	rs.circuit.OpenUntil = nil
	rs.circuit.LastSuccessAt = &now
	return nil
}

func (f *fakeAIStore) CircuitRecordFailure(_ context.Context, _, code string, threshold, cooldownSeconds int) (*repository.AICircuitState, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	rs := f.rolloutState()
	rs.circuit.ConsecutiveFailures++
	rs.circuit.LastFailureCode = &code
	if rs.circuit.State == "half_open" || rs.circuit.ConsecutiveFailures >= threshold {
		rs.circuit.State = "open"
		until := time.Now().Add(time.Duration(cooldownSeconds) * time.Second)
		rs.circuit.OpenUntil = &until
	}
	c := rs.circuit
	return &c, nil
}

func (f *fakeAIStore) CircuitReset(context.Context, string) (*repository.AICircuitState, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	rs := f.rolloutState()
	rs.circuit.State = "closed"
	rs.circuit.ConsecutiveFailures = 0
	rs.circuit.OpenUntil = nil
	c := rs.circuit
	return &c, nil
}

func (f *fakeAIStore) ReserveUsage(_ context.Context, in repository.AIReservationInput) (*repository.AIReservation, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	rs := f.rolloutState()
	dayStart := time.Now().UTC().Truncate(24 * time.Hour)
	reqToday, rowsToday := 0, 0
	spent := new(big.Rat)
	for _, l := range rs.ledger {
		if l.status != "released" && l.userID == in.UserID && !l.createdAt.Before(dayStart) {
			reqToday++
			rowsToday += l.rows
		}
		if l.status != "released" {
			amt := l.amount
			if l.status == "completed" {
				if l.actual != "" {
					amt = l.actual
				} else if l.estimated != "" {
					amt = l.estimated
				}
			}
			if r, ok := new(big.Rat).SetString(amt); ok {
				spent.Add(spent, r)
			}
		}
	}
	if reqToday >= in.DailyRequestLimit {
		return nil, repository.ErrAIUserQuotaExhausted
	}
	if rowsToday+in.RowsCount > in.DailyRowLimit {
		return nil, repository.ErrAIRowQuotaExhausted
	}
	if in.MonthlyBudget != "" {
		budget, _ := new(big.Rat).SetString(in.MonthlyBudget)
		amount, _ := new(big.Rat).SetString(in.Amount)
		if budget != nil && amount != nil && new(big.Rat).Add(spent, amount).Cmp(budget) > 0 {
			return nil, repository.ErrAIBudgetExhausted
		}
	}
	rs.evalSeq++
	id := "req-" + time.Now().Format("150405.000000000") + "-" + string(rune('a'+rs.evalSeq%26))
	row := fakeLedgerRow{
		id: id, userID: in.UserID, rows: in.RowsCount, amount: in.Amount,
		status: "reserved", createdAt: time.Now(),
		expiresAt: time.Now().Add(time.Duration(in.TimeoutSeconds) * time.Second),
	}
	rs.ledger = append(rs.ledger, row)
	return &repository.AIReservation{RequestID: id, ExpiresAt: row.expiresAt}, nil
}

func (f *fakeAIStore) ReconcileUsage(_ context.Context, o repository.AIUsageOutcome) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	rs := f.rolloutState()
	for i := range rs.ledger {
		if rs.ledger[i].id == o.RequestID && rs.ledger[i].status == "reserved" {
			rs.ledger[i].status = o.Status
			rs.ledger[i].outcome = o.ProviderOutcome
			rs.ledger[i].actual = o.ActualProviderCost
			rs.ledger[i].estimated = o.EstimatedCost
			rs.ledger[i].tokens = o.TotalTokens
		}
	}
	return nil
}

func (f *fakeAIStore) RecoverExpiredReservations(context.Context, string) (int64, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	rs := f.rolloutState()
	var n int64
	for i := range rs.ledger {
		if rs.ledger[i].status == "reserved" && rs.ledger[i].expiresAt.Before(time.Now()) {
			rs.ledger[i].status = "released"
			n++
		}
	}
	return n, nil
}

func (f *fakeAIStore) GetUserQuotaState(_ context.Context, _, userID string) (*repository.AIUserQuotaState, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	rs := f.rolloutState()
	dayStart := time.Now().UTC().Truncate(24 * time.Hour)
	q := &repository.AIUserQuotaState{}
	for _, l := range rs.ledger {
		if l.status != "released" && l.userID == userID && !l.createdAt.Before(dayStart) {
			q.RequestsUsedToday++
			q.RowsUsedToday += l.rows
		}
	}
	return q, nil
}

func (f *fakeAIStore) GetUsageSummary(context.Context, string) (*repository.AIUsageSummary, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	rs := f.rolloutState()
	s := &repository.AIUsageSummary{
		ProviderCostMonth:    "0",
		EstimatedCostMonth:   "0",
		ReservedActiveAmount: "0",
	}
	cost := new(big.Rat)
	est := new(big.Rat)
	for _, l := range rs.ledger {
		if l.status == "released" {
			continue
		}
		s.RequestsMonth++
		s.RowsMonth += l.rows
		if l.status == "reserved" {
			s.ActiveReservations++
		}
		if l.actual != "" {
			if r, ok := new(big.Rat).SetString(l.actual); ok {
				cost.Add(cost, r)
			}
		}
		if l.estimated != "" {
			if r, ok := new(big.Rat).SetString(l.estimated); ok {
				est.Add(est, r)
			}
		}
	}
	s.ProviderCostMonth = cost.FloatString(8)
	s.EstimatedCostMonth = est.FloatString(8)
	for _, fb := range rs.feedback {
		if fb.outcome == nil {
			continue
		}
		switch *fb.outcome {
		case "accepted":
			s.FeedbackAccepted++
		case "changed":
			s.FeedbackChanged++
			if fb.conf == "high" {
				s.HighConfChanged++
			}
		case "manual":
			s.FeedbackManual++
		case "abstained":
			s.FeedbackAbstained++
		case "unresolved":
			s.FeedbackUnresolved++
		}
		if fb.conf == "high" && (*fb.outcome == "accepted" || *fb.outcome == "changed") {
			s.HighConfTotal++
		}
		if fb.imported && (*fb.outcome == "accepted" || *fb.outcome == "changed" || *fb.outcome == "manual") {
			s.SuccessfulOutcomes++
		}
	}
	return s, nil
}

func (f *fakeAIStore) CleanupExpiredUsage(context.Context, string, time.Duration, int) (int64, error) {
	return 0, nil
}

func (f *fakeAIStore) InsertFeedbackSkeletons(_ context.Context, rows []repository.AIFeedbackSkeleton) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	rs := f.rolloutState()
	for _, r := range rows {
		exists := false
		for _, fb := range rs.feedback {
			if fb.requestID == r.RequestID && fb.hash == r.RowContextHash {
				exists = true
				break
			}
		}
		if exists {
			continue
		}
		rs.feedback = append(rs.feedback, fakeFeedbackRow{
			requestID: r.RequestID, userID: r.UserID, hash: r.RowContextHash,
			conf: r.Confidence, detTop: r.DeterministicTopID, aiSel: r.AISelectedCatalogID,
		})
	}
	return nil
}

func (f *fakeAIStore) ListFeedbackSkeletons(_ context.Context, requestID, userID string) ([]repository.AIFeedbackSkeletonRow, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	rs := f.rolloutState()
	out := []repository.AIFeedbackSkeletonRow{}
	for _, fb := range rs.feedback {
		if fb.requestID == requestID && fb.userID == userID {
			out = append(out, repository.AIFeedbackSkeletonRow{
				RowContextHash: fb.hash, AISelectedCatalogID: fb.aiSel, Outcome: fb.outcome,
			})
		}
	}
	return out, nil
}

func (f *fakeAIStore) FinalizeFeedbackOutcomes(_ context.Context, userID string, outcomes []repository.AIFeedbackOutcome) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	rs := f.rolloutState()
	for _, o := range outcomes {
		for i := range rs.feedback {
			fb := &rs.feedback[i]
			if fb.requestID == o.RequestID && fb.hash == o.RowContextHash &&
				fb.userID == userID && fb.outcome == nil {
				out := o.Outcome
				fb.outcome = &out
				fb.finalID = o.FinalCatalogID
				fb.source = o.SelectionSource
				fb.imported = true
			}
		}
	}
	return nil
}

func (f *fakeAIStore) InsertEvaluationSummary(_ context.Context, s *repository.AIEvaluationSummary) (string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	rs := f.rolloutState()
	rs.evalSeq++
	id := "eval-" + time.Now().Format("150405.000000000")
	cp := *s
	cp.ID = id
	cp.ExecutedAt = time.Now()
	rs.evals[id] = cp
	return id, nil
}

func (f *fakeAIStore) ListEvaluationSummaries(context.Context, string, int) ([]repository.AIEvaluationSummary, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	rs := f.rolloutState()
	out := make([]repository.AIEvaluationSummary, 0, len(rs.evals))
	for _, e := range rs.evals {
		out = append(out, e)
	}
	return out, nil
}

func (f *fakeAIStore) GetEvaluationSummary(_ context.Context, id string) (*repository.AIEvaluationSummary, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	rs := f.rolloutState()
	if e, ok := rs.evals[id]; ok {
		cp := e
		return &cp, nil
	}
	return nil, nil
}

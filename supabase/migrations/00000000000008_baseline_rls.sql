-- Baseline migration 8/10: RLS policies.
-- Target: pre-prod project ocauafggjrqvopxjihas (TenderHUB_SU10 Prod).
-- Source: snapshot of wkywhjljrhewfpedbjzx (live prod) as of 2026-04-20.
-- Fixes applied vs live prod:
--   1. auth.uid() → (SELECT auth.uid()) everywhere (eliminates auth_rls_initplan lint).
--   2. current_user_role() comparisons updated: returns text role_code now, not user_role_type enum.
--   3. Duplicate SELECT policies on `users` consolidated into one.
--   4. RLS enabled on 5 tables that had policies but RLS=false in live prod (boq_items, markup_tactics,
--      subcontract_growth_exclusions, tender_documents, users).
--   5. Tables without policies and without Go backend yet remain RLS-disabled (handled in Phase 3).

-- =============================================================================
-- boq_items  (had policies, RLS was disabled — fixing the bug)
-- =============================================================================

ALTER TABLE public.boq_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "boq_items_select" ON public.boq_items
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "boq_items_insert" ON public.boq_items
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "boq_items_update" ON public.boq_items
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "boq_items_delete" ON public.boq_items
  FOR DELETE TO authenticated USING (true);

-- =============================================================================
-- comparison_notes
-- =============================================================================

ALTER TABLE public.comparison_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "comparison_notes_all" ON public.comparison_notes
  FOR ALL USING (true) WITH CHECK (true);

-- =============================================================================
-- import_sessions
-- =============================================================================

ALTER TABLE public.import_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "import_sessions_select" ON public.import_sessions
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "import_sessions_insert" ON public.import_sessions
  FOR INSERT TO authenticated WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY "import_sessions_update" ON public.import_sessions
  FOR UPDATE TO authenticated USING (true);

-- =============================================================================
-- library_folders
-- =============================================================================

ALTER TABLE public.library_folders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "library_folders_select" ON public.library_folders
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "library_folders_insert" ON public.library_folders
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "library_folders_update" ON public.library_folders
  FOR UPDATE TO authenticated USING (true);

CREATE POLICY "library_folders_delete" ON public.library_folders
  FOR DELETE TO authenticated USING (true);

-- =============================================================================
-- markup_tactics  (had policies, RLS was disabled — fixing the bug)
-- =============================================================================

ALTER TABLE public.markup_tactics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own tactics and global tactics" ON public.markup_tactics
  FOR SELECT USING (((SELECT auth.uid()) = user_id) OR (is_global = true));

CREATE POLICY "Users can create their own tactics" ON public.markup_tactics
  FOR INSERT WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users can update their own tactics" ON public.markup_tactics
  FOR UPDATE USING ((SELECT auth.uid()) = user_id) WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users can delete their own tactics" ON public.markup_tactics
  FOR DELETE USING ((SELECT auth.uid()) = user_id);

-- =============================================================================
-- project_additional_agreements
-- =============================================================================

ALTER TABLE public.project_additional_agreements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow full access for authenticated users" ON public.project_additional_agreements
  FOR ALL USING ((SELECT auth.uid()) IS NOT NULL);

-- =============================================================================
-- project_monthly_completion
-- =============================================================================

ALTER TABLE public.project_monthly_completion ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow full access for authenticated users" ON public.project_monthly_completion
  FOR ALL USING ((SELECT auth.uid()) IS NOT NULL);

-- =============================================================================
-- projects
-- =============================================================================

ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow full access for authenticated users" ON public.projects
  FOR ALL USING ((SELECT auth.uid()) IS NOT NULL);

-- =============================================================================
-- subcontract_growth_exclusions  (had policy, RLS was disabled — fixing the bug)
-- =============================================================================

ALTER TABLE public.subcontract_growth_exclusions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all for authenticated" ON public.subcontract_growth_exclusions
  FOR ALL USING ((SELECT auth.uid()) IS NOT NULL) WITH CHECK ((SELECT auth.uid()) IS NOT NULL);

-- =============================================================================
-- tender_documents  (had policies, RLS was disabled — fixing the bug)
-- =============================================================================

ALTER TABLE public.tender_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view tender documents" ON public.tender_documents
  FOR SELECT USING ((SELECT auth.uid()) IS NOT NULL);

CREATE POLICY "Users can create tender documents" ON public.tender_documents
  FOR INSERT WITH CHECK (
    (SELECT auth.uid()) IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.tenders
      WHERE tenders.id = tender_documents.tender_id
        AND tenders.created_by = (SELECT auth.uid())
    )
  );

CREATE POLICY "Users can update their tender documents" ON public.tender_documents
  FOR UPDATE USING (
    (SELECT auth.uid()) IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.tenders
      WHERE tenders.id = tender_documents.tender_id
        AND tenders.created_by = (SELECT auth.uid())
    )
  );

CREATE POLICY "Users can delete their tender documents" ON public.tender_documents
  FOR DELETE USING (
    (SELECT auth.uid()) IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.tenders
      WHERE tenders.id = tender_documents.tender_id
        AND tenders.created_by = (SELECT auth.uid())
    )
  );

-- =============================================================================
-- tender_group_members
-- =============================================================================

ALTER TABLE public.tender_group_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tender_group_members_select_authenticated" ON public.tender_group_members
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = (SELECT auth.uid())));

CREATE POLICY "tender_group_members_manage_privileged" ON public.tender_group_members
  FOR ALL TO authenticated
  USING (public.is_tender_timeline_privileged())
  WITH CHECK (public.is_tender_timeline_privileged());

-- =============================================================================
-- tender_groups
-- =============================================================================

ALTER TABLE public.tender_groups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tender_groups_select_authenticated" ON public.tender_groups
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = (SELECT auth.uid())));

CREATE POLICY "tender_groups_manage_privileged" ON public.tender_groups
  FOR ALL TO authenticated
  USING (public.is_tender_timeline_privileged())
  WITH CHECK (public.is_tender_timeline_privileged());

-- =============================================================================
-- tender_insurance
-- =============================================================================

ALTER TABLE public.tender_insurance ENABLE ROW LEVEL SECURITY;

-- Consolidated: had both ALL + SELECT (multiple_permissive_policies). One ALL covers both.
CREATE POLICY "tender_insurance_authenticated" ON public.tender_insurance
  FOR ALL USING ((SELECT auth.uid()) IS NOT NULL);

-- =============================================================================
-- tender_iterations
-- =============================================================================

ALTER TABLE public.tender_iterations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tender_iterations_select_allowed_users" ON public.tender_iterations
  FOR SELECT TO authenticated
  USING (
    public.is_tender_timeline_privileged()
    OR user_id = (SELECT auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.tender_group_members gm
      WHERE gm.group_id = tender_iterations.group_id
        AND gm.user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "tender_iterations_insert_own_records" ON public.tender_iterations
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.tender_group_members gm
      WHERE gm.group_id = tender_iterations.group_id
        AND gm.user_id = (SELECT auth.uid())
    )
  );

-- =============================================================================
-- tender_notes
-- =============================================================================

ALTER TABLE public.tender_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tender_notes_select" ON public.tender_notes
  FOR SELECT USING (
    (SELECT auth.uid()) = user_id
    OR EXISTS (
      SELECT 1 FROM public.users
      WHERE users.id = (SELECT auth.uid())
        AND users.role_code = ANY (ARRAY['administrator','developer','director','senior_group','veduschiy_inzhener'])
    )
  );

CREATE POLICY "tender_notes_insert" ON public.tender_notes
  FOR INSERT WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "tender_notes_update" ON public.tender_notes
  FOR UPDATE USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "tender_notes_delete" ON public.tender_notes
  FOR DELETE USING ((SELECT auth.uid()) = user_id);

-- =============================================================================
-- users  (had 6 policies, RLS was disabled — fixing the bug)
-- =============================================================================

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

-- INSERT: only allow inserting own record (during registration).
CREATE POLICY "Allow registration inserts" ON public.users
  FOR INSERT WITH CHECK (id = (SELECT auth.uid()));

-- SELECT (consolidated): own profile OR privileged role OR approved viewing approved.
-- Replaces: "Users can read own profile", "Users can view own profile" (duplicate),
--           "Approved users can view approved profiles",
--           "Admins, Leaders and Developers can view all profiles".
CREATE POLICY "users_select_consolidated" ON public.users
  FOR SELECT USING (
    id = (SELECT auth.uid())
    OR current_user_role() = ANY (ARRAY['administrator','director','developer','general_director'])
    OR (access_status = 'approved' AND (SELECT current_user_status()) = 'approved')
  );

-- UPDATE: own profile OR privileged admin update.
CREATE POLICY "Users can update own profile" ON public.users
  FOR UPDATE USING ((SELECT auth.uid()) = id);

CREATE POLICY "Admins and Leaders can update users" ON public.users
  FOR UPDATE USING (
    current_user_role() = ANY (ARRAY['administrator','director','developer','general_director'])
    AND (SELECT current_user_status()) = 'approved'
  );

-- DELETE: privileged roles only.
CREATE POLICY "Admins and Leaders can delete users" ON public.users
  FOR DELETE USING (
    current_user_role() = ANY (ARRAY['administrator','director','developer','general_director'])
    AND (SELECT current_user_status()) = 'approved'
  );

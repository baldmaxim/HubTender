-- Enable RLS on cost_redistribution_results.
-- Previously RLS was disabled: any authenticated user could read/write any
-- tender's redistribution results via the anon-key SDK.
-- Pattern matches boq_items (B2B internal app: all authenticated users allowed,
-- anon blocked).

ALTER TABLE public.cost_redistribution_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cost_redistribution_results_select" ON public.cost_redistribution_results
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "cost_redistribution_results_insert" ON public.cost_redistribution_results
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "cost_redistribution_results_update" ON public.cost_redistribution_results
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "cost_redistribution_results_delete" ON public.cost_redistribution_results
  FOR DELETE TO authenticated USING (true);

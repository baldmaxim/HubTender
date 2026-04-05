-- Migration: Library folders for works and materials
-- Date: 2026-04-05

-- ============================================================
-- 1. library_folders table
-- ============================================================
CREATE TABLE IF NOT EXISTS public.library_folders (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name text NOT NULL,
  type text NOT NULL CHECK (type IN ('works', 'materials')),
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.library_folders IS 'Папки для группировки элементов библиотеки работ и материалов';
COMMENT ON COLUMN public.library_folders.type IS 'works | materials';

CREATE INDEX IF NOT EXISTS idx_library_folders_type ON public.library_folders(type);

ALTER TABLE public.library_folders ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'library_folders' AND policyname = 'library_folders_select') THEN
    CREATE POLICY "library_folders_select" ON public.library_folders FOR SELECT TO authenticated USING (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'library_folders' AND policyname = 'library_folders_insert') THEN
    CREATE POLICY "library_folders_insert" ON public.library_folders FOR INSERT TO authenticated WITH CHECK (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'library_folders' AND policyname = 'library_folders_update') THEN
    CREATE POLICY "library_folders_update" ON public.library_folders FOR UPDATE TO authenticated USING (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'library_folders' AND policyname = 'library_folders_delete') THEN
    CREATE POLICY "library_folders_delete" ON public.library_folders FOR DELETE TO authenticated USING (true);
  END IF;
END $$;

-- ============================================================
-- 2. Add folder_id to works_library and materials_library
-- ============================================================
ALTER TABLE public.works_library
  ADD COLUMN IF NOT EXISTS folder_id uuid REFERENCES public.library_folders(id) ON DELETE SET NULL;

ALTER TABLE public.materials_library
  ADD COLUMN IF NOT EXISTS folder_id uuid REFERENCES public.library_folders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_works_library_folder_id ON public.works_library(folder_id);
CREATE INDEX IF NOT EXISTS idx_materials_library_folder_id ON public.materials_library(folder_id);

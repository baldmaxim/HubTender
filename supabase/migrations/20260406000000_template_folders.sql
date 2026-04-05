-- Migration: Folder support for templates
-- Date: 2026-04-06

-- ============================================================
-- 1. Extend library_folders.type to include 'templates'
-- ============================================================
ALTER TABLE public.library_folders
  DROP CONSTRAINT IF EXISTS library_folders_type_check;

ALTER TABLE public.library_folders
  ADD CONSTRAINT library_folders_type_check
  CHECK (type IN ('works', 'materials', 'templates'));

-- ============================================================
-- 2. Add folder_id to templates
-- ============================================================
ALTER TABLE public.templates
  ADD COLUMN IF NOT EXISTS folder_id uuid REFERENCES public.library_folders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_templates_folder_id ON public.templates(folder_id);

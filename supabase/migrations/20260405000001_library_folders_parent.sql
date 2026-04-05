-- Migration: Add parent_id to library_folders for nested folder support
-- Date: 2026-04-05

ALTER TABLE public.library_folders
  ADD COLUMN IF NOT EXISTS parent_id uuid REFERENCES public.library_folders(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.library_folders.parent_id IS 'ID родительской папки (NULL = корневая папка)';

CREATE INDEX IF NOT EXISTS idx_library_folders_parent_id ON public.library_folders(parent_id);

import { fileURLToPath } from 'node:url';

/** Папка результатов прогонов (в .gitignore). */
export const DEFAULT_OUT_DIR = fileURLToPath(new URL('../out', import.meta.url));

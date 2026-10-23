/** Сжатие фото в браузере перед загрузкой: полное (≤1600 px) и миниатюра (480 px). */

const FULL_MAX_SIDE = 1600;
const FULL_MAX_BYTES = 850 * 1024;
const THUMB_MAX_SIDE = 480;
const THUMB_MAX_BYTES = 150 * 1024;
const QUALITY_START = 0.82;
const QUALITY_MIN = 0.5;
const QUALITY_STEP = 0.08;
// Если на минимальном качестве всё ещё не влезли — уменьшаем размер.
const SIZE_FALLBACK_SCALES = [1, 0.8, 0.64];

export interface ICompressedImage {
  file: Blob;
  thumb: Blob;
  /** Размеры полного изображения после сжатия. */
  width: number;
  height: number;
}

export class ImageCompressError extends Error {}

const UNSUPPORTED_MESSAGE =
  'Не удалось прочитать изображение. Поддерживаются JPEG, PNG и WebP (HEIC с iPhone — выберите формат «Наиболее совместимый» или снимок как JPEG).';

const canvasToBlob = (canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> =>
  new Promise((resolve) => canvas.toBlob(resolve, type, quality));

let encoderMime: string | null = null;

/** WebP, если браузер умеет его кодировать (иначе toBlob молча отдаёт PNG), иначе JPEG. */
const getEncoderMime = async (): Promise<string> => {
  if (encoderMime) return encoderMime;
  const probe = document.createElement('canvas');
  probe.width = 2;
  probe.height = 2;
  const blob = await canvasToBlob(probe, 'image/webp', 0.8);
  encoderMime = blob?.type === 'image/webp' ? 'image/webp' : 'image/jpeg';
  return encoderMime;
};

const decode = async (source: File): Promise<ImageBitmap> => {
  if (/hei[cf]/i.test(source.type) || /\.hei[cf]$/i.test(source.name)) {
    throw new ImageCompressError(UNSUPPORTED_MESSAGE);
  }
  try {
    return await createImageBitmap(source, { imageOrientation: 'from-image' });
  } catch {
    try {
      return await createImageBitmap(source);
    } catch {
      throw new ImageCompressError(UNSUPPORTED_MESSAGE);
    }
  }
};

const encode = async (
  bitmap: ImageBitmap,
  mime: string,
  maxSide: number,
  maxBytes: number,
): Promise<{ blob: Blob; width: number; height: number }> => {
  const baseScale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  let last: { blob: Blob; width: number; height: number } | null = null;

  for (const extra of SIZE_FALLBACK_SCALES) {
    const width = Math.max(1, Math.round(bitmap.width * baseScale * extra));
    const height = Math.max(1, Math.round(bitmap.height * baseScale * extra));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new ImageCompressError('Браузер не смог обработать изображение.');
    if (mime === 'image/jpeg') {
      // JPEG без прозрачности: иначе PNG с альфой станет чёрным.
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, width, height);
    }
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, width, height);

    for (let q = QUALITY_START; q >= QUALITY_MIN - 1e-6; q -= QUALITY_STEP) {
      const blob = await canvasToBlob(canvas, mime, q);
      if (!blob) throw new ImageCompressError('Браузер не смог сжать изображение.');
      last = { blob, width, height };
      if (blob.size <= maxBytes) return last;
    }
  }
  if (!last) throw new ImageCompressError('Браузер не смог сжать изображение.');
  return last;
};

export const compressImage = async (source: File): Promise<ICompressedImage> => {
  const bitmap = await decode(source);
  try {
    const mime = await getEncoderMime();
    const full = await encode(bitmap, mime, FULL_MAX_SIDE, FULL_MAX_BYTES);
    if (full.blob.size > FULL_MAX_BYTES) {
      throw new ImageCompressError('Не удалось сжать фото до допустимого размера.');
    }
    const thumb = await encode(bitmap, mime, THUMB_MAX_SIDE, THUMB_MAX_BYTES);
    return { file: full.blob, thumb: thumb.blob, width: full.width, height: full.height };
  } finally {
    bitmap.close();
  }
};

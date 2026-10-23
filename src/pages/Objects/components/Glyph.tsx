import type { FC } from 'react';
import { GLYPH_PATHS } from '../utils/glyphs';
import type { GlyphName } from '../utils/glyphs';

interface IGlyphProps {
  name: GlyphName;
  size?: number;
  className?: string;
}

/** Штриховой значок страницы «Объекты» (цвет — currentColor). */
export const Glyph: FC<IGlyphProps> = ({ name, size = 16, className }) => (
  <svg
    className={className}
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    {GLYPH_PATHS[name].map((d) => (
      <path key={d} d={d} />
    ))}
  </svg>
);

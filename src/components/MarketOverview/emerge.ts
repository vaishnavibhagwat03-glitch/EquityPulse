import type { CSSProperties } from 'react';

/**
 * Order in which a home-page block emerges as the boot sequence hands over
 * (see `[data-emerge]` in globals.css). Ignored on ordinary navigations.
 */
export const emergeStyle = (order: number): CSSProperties =>
  ({ '--emerge': order }) as CSSProperties;

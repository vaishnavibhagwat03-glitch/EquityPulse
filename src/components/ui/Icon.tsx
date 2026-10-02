import type { SVGProps } from 'react';

/**
 * Icon set. 16 px grid, 1.5 px strokes, round joins — drawn to sit on the same
 * optical weight as 12–13 px UI text. Decorative by default (aria-hidden);
 * the control that hosts an icon carries the accessible name.
 */

export type IconName =
  | 'search'
  | 'x'
  | 'chevron-down'
  | 'chevron-up'
  | 'chevron-left'
  | 'chevron-right'
  | 'star'
  | 'star-filled'
  | 'sun'
  | 'moon'
  | 'monitor'
  | 'sliders'
  | 'columns'
  | 'pin'
  | 'arrow-up-right'
  | 'arrow-up'
  | 'arrow-down'
  | 'arrow-right'
  | 'plus'
  | 'minus'
  | 'check'
  | 'command'
  | 'keyboard'
  | 'pulse'
  | 'grid'
  | 'list'
  | 'bolt'
  | 'refresh'
  | 'trash'
  | 'bookmark'
  | 'info'
  | 'wifi'
  | 'wifi-off'
  | 'layers'
  | 'gauge'
  | 'external'
  | 'sort'
  | 'sort-asc'
  | 'sort-desc'
  | 'dots'
  | 'eye'
  | 'eye-off'
  | 'candles'
  | 'reset'
  | 'panel-left'
  | 'panel-right'
  | 'alert'
  | 'branch'
  | 'chart'
  | 'menu'
  | 'home';

const PATHS: Record<IconName, string> = {
  search: 'M7.25 12.5a5.25 5.25 0 1 0 0-10.5 5.25 5.25 0 0 0 0 10.5ZM14 14l-3-3',
  x: 'M4 4l8 8M12 4l-8 8',
  'chevron-down': 'M4 6l4 4 4-4',
  'chevron-up': 'M4 10l4-4 4 4',
  'chevron-left': 'M10 4L6 8l4 4',
  'chevron-right': 'M6 4l4 4-4 4',
  star: 'M8 1.9l1.83 3.72 4.1.6-2.96 2.89.7 4.08L8 11.26l-3.67 1.93.7-4.08L2.07 6.22l4.1-.6L8 1.9Z',
  'star-filled':
    'M8 1.9l1.83 3.72 4.1.6-2.96 2.89.7 4.08L8 11.26l-3.67 1.93.7-4.08L2.07 6.22l4.1-.6L8 1.9Z',
  sun: 'M8 10.75a2.75 2.75 0 1 0 0-5.5 2.75 2.75 0 0 0 0 5.5ZM8 1.5v1.25M8 13.25v1.25M14.5 8h-1.25M2.75 8H1.5M12.6 3.4l-.88.88M4.28 11.72l-.88.88M12.6 12.6l-.88-.88M4.28 4.28l-.88-.88',
  moon: 'M13.5 9.6A5.75 5.75 0 0 1 6.4 2.5 5.75 5.75 0 1 0 13.5 9.6Z',
  monitor: 'M2 3.25h12v8H2zM6 14h4M8 11.25V14',
  sliders: 'M2.5 4.5h6M11.5 4.5h2M2.5 11.5h2M7.5 11.5h6M10 3v3M6 10v3',
  columns: 'M2.5 2.5h11v11h-11zM6.17 2.5v11M9.83 2.5v11',
  pin: 'M9.5 2.5l4 4-2.25.75-2 2 .25 2.75-1.5 1.5-2.25-2.25L3 14M5.75 9.25L3.5 7l1.5-1.5 2.75.25 2-2 .75-2.25',
  'arrow-up-right': 'M5 11l6-6M6 5h5v5',
  'arrow-up': 'M8 13V3M4 7l4-4 4 4',
  'arrow-down': 'M8 3v10M4 9l4 4 4-4',
  'arrow-right': 'M3 8h10M9 4l4 4-4 4',
  plus: 'M8 3v10M3 8h10',
  minus: 'M3 8h10',
  check: 'M3 8.5l3 3 7-7',
  command:
    'M5.5 5.5h5v5h-5zM5.5 5.5V4a1.5 1.5 0 1 0-1.5 1.5h1.5M10.5 5.5H12a1.5 1.5 0 1 0-1.5-1.5v1.5M10.5 10.5V12a1.5 1.5 0 1 0 1.5-1.5h-1.5M5.5 10.5H4a1.5 1.5 0 1 0 1.5 1.5v-1.5',
  keyboard: 'M1.75 4h12.5v8H1.75zM4 6.5h.5M6.5 6.5H7M9 6.5h.5M11.5 6.5h.5M5 9.5h6',
  pulse: 'M1.5 8h3l1.75-4.5 3.5 9L11.5 8h3',
  grid: 'M2.5 2.5h4.25v4.25H2.5zM9.25 2.5h4.25v4.25H9.25zM2.5 9.25h4.25v4.25H2.5zM9.25 9.25h4.25v4.25H9.25z',
  list: 'M5.5 4h8M5.5 8h8M5.5 12h8M2.5 4h.5M2.5 8h.5M2.5 12h.5',
  bolt: 'M9 1.5L3.5 9H8l-1 5.5L12.5 7H8l1-5.5Z',
  refresh: 'M13.25 8a5.25 5.25 0 1 1-1.54-3.71M13.5 2.5v3h-3',
  trash: 'M2.5 4h11M6.5 4V2.5h3V4M4 4l.7 9.5h6.6L12 4',
  bookmark: 'M4 2h8v12l-4-2.75L4 14V2Z',
  info: 'M8 14A6 6 0 1 0 8 2a6 6 0 0 0 0 12ZM8 7.25V11M8 5h.01',
  wifi: 'M1.5 6a9.5 9.5 0 0 1 13 0M3.75 8.6a6.25 6.25 0 0 1 8.5 0M6 11.1a3 3 0 0 1 4 0M8 13.25h.01',
  'wifi-off':
    'M2 2l12 12M6 11.1a3 3 0 0 1 4 0M3.75 8.6a6.2 6.2 0 0 1 2.9-1.55M9.6 7.2a6.2 6.2 0 0 1 2.65 1.4M1.5 6a9.5 9.5 0 0 1 3-1.85M7.4 3.53A9.5 9.5 0 0 1 14.5 6M8 13.25h.01',
  layers: 'M8 2l6 3.25L8 8.5 2 5.25 8 2ZM2 8l6 3.25L14 8M2 10.75L8 14l6-3.25',
  gauge: 'M2.5 11.5a5.5 5.5 0 1 1 11 0M8 11.5l2.75-3.75M8 11.5h.01',
  external:
    'M9.5 2.5h4v4M13.5 2.5L7.5 8.5M12 9.5v3.25a.75.75 0 0 1-.75.75H3.25a.75.75 0 0 1-.75-.75V4.75A.75.75 0 0 1 3.25 4H6.5',
  sort: 'M5 3v10M2.5 10.5L5 13l2.5-2.5M11 13V3M8.5 5.5L11 3l2.5 2.5',
  'sort-asc': 'M8 13V3M4.5 6.5L8 3l3.5 3.5',
  'sort-desc': 'M8 3v10M4.5 9.5L8 13l3.5-3.5',
  dots: 'M8 4h.01M8 8h.01M8 12h.01',
  eye: 'M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8ZM8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z',
  'eye-off':
    'M2 2l12 12M6.6 6.6a2 2 0 0 0 2.8 2.8M4.1 4.6C2.55 5.75 1.5 8 1.5 8S4 12.5 8 12.5c1.2 0 2.3-.4 3.2-1M6.75 3.62A5.8 5.8 0 0 1 8 3.5c4 0 6.5 4.5 6.5 4.5s-.55 1-1.55 2.1',
  candles: 'M4.5 2v2.5M4.5 10.5V14M11.5 2v3M11.5 11v3M3 4.5h3v6H3zM10 5h3v6h-3z',
  reset: 'M2.75 8a5.25 5.25 0 1 0 1.54-3.71M2.5 2.5v3h3',
  'panel-left': 'M2.5 2.5h11v11h-11zM6.5 2.5v11',
  'panel-right': 'M2.5 2.5h11v11h-11zM9.5 2.5v11',
  alert: 'M8 2l6.5 11.5h-13L8 2ZM8 6.5v3M8 11.75h.01',
  branch: 'M4.5 2.5v11M4.5 6c0 2 1.5 3 4 3h3M11.5 9v4.5M11.5 2.5V6',
  chart: 'M2.5 2.5v11h11M5 10l2.5-3 2 2L13 5',
  menu: 'M2.5 4.5h11M2.5 8h11M2.5 11.5h11',
  home: 'M2.5 7L8 2.5 13.5 7v6.5h-11V7ZM6.5 13.5v-4h3v4',
};

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: IconName;
  size?: number;
  title?: string;
}

export function Icon({ name, size = 16, title, strokeWidth = 1.5, ...rest }: IconProps) {
  const filled = name === 'star-filled';
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      focusable="false"
      {...rest}
    >
      {title ? <title>{title}</title> : null}
      <path d={PATHS[name]} />
    </svg>
  );
}

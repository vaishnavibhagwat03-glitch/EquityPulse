'use client';

import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type Column,
  type ColumnPinningState,
  type ColumnSizingState,
  type Header,
  type VisibilityState,
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from 'react';
import type { Stock } from '@/types/market';
import { cn } from '@/lib/cn';
import { formatInteger } from '@/lib/format';
import { setGauge } from '@/lib/performance';
import { noteScroll } from '@/lib/scrollActivity';
import type { SortSpec } from '@/lib/filters/sort';
import { Icon } from '@/components/ui/Icon';
import { Popover } from '@/components/ui/overlays';
import { COLUMNS, DEFAULT_VISIBILITY } from './columns';

/**
 * The screener grid.
 *
 * - TanStack Table owns the column model only: sizing, visibility, pinning,
 *   headers. It is given no rows. Building its row model for every match
 *   (an object and a set of closures per row) cost ~100 ms for 5,247 rows,
 *   and a live re-sort every 2 s paid it again; rows are instead rendered
 *   straight from the engine's result, and only for the window in view.
 * - TanStack Virtual renders only the rows in view (+ overscan): ~50 rows in
 *   the DOM regardless of whether 5 or 5,247 match.
 * - Column widths are CSS variables on the grid root, so resizing a column
 *   restyles cells without re-rendering a single row.
 * - Rows are memoised leaves; a price tick re-renders the one cell whose
 *   quote changed (see cells.tsx), never the row or the grid.
 */

export const ROW_HEIGHT = 34;
const HEADER_HEIGHT = 34;
/**
 * Rows kept beyond the viewport on each side. Scrolling is threaded: the
 * compositor moves the content every vsync while the main thread catches the
 * rendered window up, so overscan is the budget for main-thread lag before a
 * blank row could show — 8 rows (272 px) covers ~110 ms at 2,400 px/s. Every
 * extra row is repainted while scrolling, so it is no larger than that.
 */
const OVERSCAN = 8;
/** TanStack Table gets the columns only (see the note above). */
const NO_ROWS: Stock[] = [];

export interface DataGridProps {
  stocks: readonly Stock[];
  /** Matching universe positions, already sorted by the engine. */
  rows: Uint32Array;
  sort: SortSpec | null;
  onSort: (field: string) => void;
  activeSymbol: string | null;
  onActivate: (symbol: string) => void;
  onOpen: (symbol: string) => void;
  onToggleWatch: (symbol: string) => void;
  columnVisibility: VisibilityState;
  columnPinning: ColumnPinningState;
  columnSizing: ColumnSizingState;
  onLayoutChange: (layout: {
    visibility?: VisibilityState;
    pinning?: ColumnPinningState;
    sizing?: ColumnSizingState;
  }) => void;
  compact?: boolean;
  label: string;
  /** Visible columns override (e.g. phones). */
  forcedVisibility?: VisibilityState;
}

export function DataGrid(props: DataGridProps) {
  const {
    stocks,
    rows,
    sort,
    onSort,
    activeSymbol,
    onActivate,
    onOpen,
    onToggleWatch,
    columnVisibility,
    columnPinning,
    columnSizing,
    onLayoutChange,
    label,
    forcedVisibility,
  } = props;

  const scrollRef = useRef<HTMLDivElement>(null);

  const visibility = useMemo(
    () => forcedVisibility ?? { ...DEFAULT_VISIBILITY, ...columnVisibility },
    [columnVisibility, forcedVisibility],
  );

  // eslint-disable-next-line react-hooks/incompatible-library -- no React Compiler in this project
  const table = useReactTable({
    data: NO_ROWS,
    columns: COLUMNS,
    getCoreRowModel: getCoreRowModel(),
    manualSorting: true,
    enableColumnResizing: true,
    columnResizeMode: 'onChange',
    state: { columnVisibility: visibility, columnPinning, columnSizing },
    onColumnVisibilityChange: updater =>
      onLayoutChange({ visibility: typeof updater === 'function' ? updater(visibility) : updater }),
    onColumnPinningChange: updater =>
      onLayoutChange({ pinning: typeof updater === 'function' ? updater(columnPinning) : updater }),
    onColumnSizingChange: updater =>
      onLayoutChange({ sizing: typeof updater === 'function' ? updater(columnSizing) : updater }),
  });

  const count = rows.length;
  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: OVERSCAN,
    initialRect: { width: 1200, height: 700 },
  });
  const items = virtualizer.getVirtualItems();

  useEffect(() => {
    setGauge('gridRows', items.length);
    setGauge('gridTotal', count);
  }, [items.length, count]);

  // Column geometry as CSS variables: resizing re-renders the header only.
  const headerGroups = table.getHeaderGroups();
  const columnSizeVars = useMemo(() => {
    const vars: Record<string, string> = {};
    for (const header of headerGroups[0]!.headers) {
      vars[`--col-${header.column.id}`] = `${header.column.getSize()}px`;
      if (header.column.getIsPinned() === 'left')
        vars[`--pin-${header.column.id}`] = `${header.column.getStart('left')}px`;
    }
    return vars;
    // Sizes and pins are the inputs; the table instance is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columnSizing, columnPinning, visibility, table.getState().columnSizingInfo]);

  const totalWidth = table.getTotalSize();
  // Cells follow the header order: left-pinned, centre, right-pinned.
  const cellColumns = headerGroups[0]!.headers.map(h => h.column);
  const layoutKey = cellColumns.map(c => `${c.id}:${c.getIsPinned() || ''}`).join('|');

  /* ------------------------------------------------------- keyboard */
  const activeIndex = useMemo(() => {
    if (!activeSymbol) return -1;
    const id = stocks.findIndex(s => s.symbol === activeSymbol);
    return id < 0 ? -1 : rows.indexOf(id);
  }, [activeSymbol, rows, stocks]);

  const moveTo = useCallback(
    (index: number) => {
      if (!rows.length) return;
      const i = Math.max(0, Math.min(rows.length - 1, index));
      onActivate(stocks[rows[i]!]!.symbol);
      virtualizer.scrollToIndex(i, { align: 'auto' });
    },
    [rows, stocks, onActivate, virtualizer],
  );

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const page = Math.max(1, Math.floor((scrollRef.current?.clientHeight ?? 600) / ROW_HEIGHT) - 2);
    const current = activeIndex < 0 ? -1 : activeIndex;
    switch (event.key) {
      case 'ArrowDown':
        moveTo(current + 1);
        break;
      case 'ArrowUp':
        moveTo(current <= 0 ? 0 : current - 1);
        break;
      case 'PageDown':
        moveTo(current + page);
        break;
      case 'PageUp':
        moveTo(current - page);
        break;
      case 'Home':
        moveTo(0);
        break;
      case 'End':
        moveTo(rows.length - 1);
        break;
      case 'Enter':
        if (activeSymbol) onOpen(activeSymbol);
        break;
      case ' ':
        if (activeSymbol) onToggleWatch(activeSymbol);
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  // Keep a selected row in view when the result set changes under it.
  useEffect(() => {
    if (activeIndex >= 0) virtualizer.scrollToIndex(activeIndex, { align: 'auto' });
    // Only when the row set changes, not on every activation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

  const activeId = activeIndex >= 0 ? `row-${activeSymbol}` : undefined;

  return (
    <>
      <div
        ref={scrollRef}
        role="grid"
        aria-label={label}
        aria-rowcount={count + 1}
        aria-colcount={cellColumns.length}
        aria-activedescendant={activeId}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onScroll={noteScroll}
        className="relative h-full min-h-0 overflow-auto overscroll-contain bg-surface outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--accent-ring)]"
        style={{ ...(columnSizeVars as CSSProperties), contain: 'strict' }}
      >
        <div style={{ width: totalWidth, minWidth: '100%' }}>
          <div role="rowgroup" className="sticky top-0 z-20" style={{ height: HEADER_HEIGHT }}>
            <div
              role="row"
              aria-rowindex={1}
              className="flex h-full border-b border-line bg-surface"
            >
              {headerGroups[0]!.headers.map(header => (
                <HeaderCell key={header.id} header={header} sort={sort} onSort={onSort} />
              ))}
            </div>
          </div>
          <div
            data-grid-body=""
            className="relative"
            style={{ height: virtualizer.getTotalSize() }}
          >
            {/* One translated window instead of a transform per row: rows flow
              inside it, so scrolling adds and removes rows without creating
              a paint layer and a transform node for every row in view. The
              window itself is the row group, so rows are its direct children. */}
            <div
              role="rowgroup"
              className="absolute top-0 left-0 w-full"
              style={{ transform: `translateY(${items[0]?.start ?? 0}px)` }}
            >
              {items.map(item => {
                const stock = stocks[rows[item.index]!]!;
                return (
                  <GridRow
                    key={stock.symbol}
                    stock={stock}
                    columns={cellColumns}
                    index={item.index}
                    active={item.index === activeIndex}
                    layoutKey={layoutKey}
                    onActivate={onActivate}
                    onOpen={onOpen}
                  />
                );
              })}
            </div>
          </div>
        </div>
      </div>
      {/* Outside the grid: a grid may only own rows and row groups. */}
      {count === 0 ? null : (
        <span className="sr-only" aria-live="polite">
          {formatInteger(count)} rows
        </span>
      )}
    </>
  );
}

/* ------------------------------------------------------------- header */

function cellStyle(column: Column<Stock>): CSSProperties {
  const pinned = column.getIsPinned() === 'left';
  return {
    width: `var(--col-${column.id})`,
    minWidth: `var(--col-${column.id})`,
    maxWidth: `var(--col-${column.id})`,
    ...(pinned ? { position: 'sticky', left: `var(--pin-${column.id})`, zIndex: 2 } : null),
  };
}

const HeaderCell = memo(function HeaderCell({
  header,
  sort,
  onSort,
}: {
  header: Header<Stock, unknown>;
  sort: SortSpec | null;
  onSort: (field: string) => void;
}) {
  const column = header.column;
  const meta = column.columnDef.meta;
  const sortField = meta?.sortField;
  const sorted = sortField && sort?.field === sortField ? sort.direction : null;
  const pinned = column.getIsPinned() === 'left';
  const lastPinned = pinned && column.getIsLastColumn('left');
  const [menuOpen, setMenuOpen] = useState(false);
  const menuAnchor = useRef<HTMLButtonElement>(null);
  const label = flexRender(column.columnDef.header, header.getContext());

  return (
    <div
      role="columnheader"
      aria-sort={
        sorted === 'asc'
          ? 'ascending'
          : sorted === 'desc'
            ? 'descending'
            : sortField
              ? 'none'
              : undefined
      }
      className={cn(
        'group relative flex h-full shrink-0 items-center bg-surface',
        meta?.align === 'right' ? 'justify-end' : 'justify-start',
        lastPinned && 'shadow-[1px_0_0_var(--border)]',
      )}
      style={{ ...cellStyle(column), '--col-i': header.index } as CSSProperties}
      title={meta?.description}
    >
      {sortField ? (
        <button
          type="button"
          onClick={() => onSort(sortField)}
          className={cn(
            'flex h-full min-w-0 flex-1 items-center gap-1 px-2.5 text-[10.5px] font-medium tracking-[0.07em] uppercase transition-colors duration-150',
            meta?.align === 'right' ? 'justify-end text-right' : 'justify-start text-left',
            sorted ? 'text-ink' : 'text-muted hover:text-ink',
          )}
        >
          {meta?.align === 'right' ? <SortGlyph dir={sorted} /> : null}
          <span className="truncate">{label}</span>
          {meta?.align !== 'right' ? <SortGlyph dir={sorted} /> : null}
        </button>
      ) : (
        <span className="truncate px-2.5 text-[10.5px] font-medium tracking-[0.07em] text-muted uppercase">
          {label}
        </span>
      )}

      <button
        ref={menuAnchor}
        type="button"
        aria-label={`Column options: ${typeof column.columnDef.header === 'string' ? column.columnDef.header : column.id}`}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen(o => !o)}
        className={cn(
          'absolute top-1/2 h-5 w-4 -translate-y-1/2 items-center justify-center rounded-sm text-muted hover:bg-surface-active hover:text-ink',
          meta?.align === 'right' ? 'left-0.5' : 'right-1.5',
          menuOpen ? 'flex' : 'hidden group-hover:flex focus-visible:flex',
        )}
      >
        <Icon name="dots" size={12} strokeWidth={2.2} />
      </button>
      <ColumnMenu
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        anchor={menuAnchor}
        column={column}
        sortField={sortField}
        onSort={onSort}
      />

      {column.getCanResize() ? (
        <span
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize column"
          onMouseDown={header.getResizeHandler()}
          onTouchStart={header.getResizeHandler()}
          onDoubleClick={() => column.resetSize()}
          className={cn(
            'absolute top-1.5 right-0 bottom-1.5 w-[5px] cursor-col-resize touch-none select-none',
            'after:absolute after:inset-y-0 after:right-[2px] after:w-px after:bg-line after:transition-colors',
            column.getIsResizing() ? 'after:bg-accent' : 'hover:after:bg-line-strong',
          )}
        />
      ) : null}
    </div>
  );
});

function SortGlyph({ dir }: { dir: 'asc' | 'desc' | null }) {
  if (!dir) return null;
  return (
    <Icon
      name={dir === 'asc' ? 'sort-asc' : 'sort-desc'}
      size={11}
      strokeWidth={1.8}
      className="shrink-0 text-ink"
    />
  );
}

function ColumnMenu({
  open,
  onClose,
  anchor,
  column,
  sortField,
  onSort,
}: {
  open: boolean;
  onClose: () => void;
  anchor: React.RefObject<HTMLButtonElement | null>;
  column: Column<Stock>;
  sortField?: string;
  onSort: (field: string) => void;
}) {
  const pinned = column.getIsPinned();
  const item = (
    label: string,
    icon: Parameters<typeof Icon>[0]['name'],
    run: () => void,
    disabled = false,
  ) => (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={() => {
        run();
        onClose();
      }}
      className="flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-[12.5px] text-ink-2 hover:bg-surface-hover hover:text-ink disabled:opacity-40"
    >
      <Icon name={icon} size={13} className="text-muted" />
      {label}
    </button>
  );
  return (
    <Popover open={open} onClose={onClose} anchor={anchor} width={196} label="Column options">
      <div role="menu">
        {sortField ? item('Sort by this column', 'sort', () => onSort(sortField)) : null}
        {item(
          pinned ? 'Unpin column' : 'Pin to left',
          'pin',
          () => column.pin(pinned ? false : 'left'),
          column.id === 'symbol' && pinned === 'left',
        )}
        {item(
          'Hide column',
          'eye-off',
          () => column.toggleVisibility(false),
          column.id === 'symbol',
        )}
        {item('Reset width', 'reset', () => column.resetSize())}
      </div>
    </Popover>
  );
}

/* ---------------------------------------------------------------- row */

interface GridRowProps {
  stock: Stock;
  /** Visible columns in display order; changes are signalled by layoutKey. */
  columns: Column<Stock>[];
  index: number;
  active: boolean;
  layoutKey: string;
  onActivate: (symbol: string) => void;
  onOpen: (symbol: string) => void;
}

const GridRow = memo(
  function GridRow({ stock, columns, index, active, onActivate, onOpen }: GridRowProps) {
    const symbol = stock.symbol;
    return (
      <div
        id={`row-${symbol}`}
        role="row"
        aria-rowindex={index + 2}
        aria-selected={active}
        onClick={() => onActivate(symbol)}
        onDoubleClick={() => onOpen(symbol)}
        className={cn(
          'group/row relative flex w-full cursor-default border-b border-line-subtle',
          active ? 'bg-surface-active' : 'bg-surface hover:bg-surface-hover',
        )}
        // --row-i staggers the entrance from the market grid (globals.css, [data-entering]).
        style={{ height: ROW_HEIGHT, '--row-i': Math.min(index, 24) } as CSSProperties}
      >
        {columns.map(column => {
          const meta = column.columnDef.meta;
          const pinned = column.getIsPinned() === 'left';
          return (
            <div
              key={column.id}
              role="gridcell"
              className={cn(
                'flex h-full shrink-0 items-center overflow-hidden px-2.5',
                meta?.align === 'right' ? 'justify-end text-right' : 'justify-start',
                pinned &&
                  (active ? 'bg-surface-active' : 'bg-surface group-hover/row:bg-surface-hover'),
                pinned && column.getIsLastColumn('left') && 'shadow-[1px_0_0_var(--border)]',
              )}
              style={cellStyle(column)}
            >
              {meta?.render?.(stock)}
            </div>
          );
        })}
        {active ? (
          <span aria-hidden className="absolute top-0 bottom-0 left-0 w-[2px] bg-ink" />
        ) : null}
      </div>
    );
  },
  (a, b) =>
    a.stock === b.stock &&
    a.active === b.active &&
    a.index === b.index &&
    a.layoutKey === b.layoutKey &&
    a.onActivate === b.onActivate &&
    a.onOpen === b.onOpen,
);

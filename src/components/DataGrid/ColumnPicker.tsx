'use client';

import { useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/controls';
import { Popover } from '@/components/ui/overlays';
import { useUiStore } from '@/stores/uiStore';
import { COLUMNS, DEFAULT_VISIBILITY, type ColumnGroup } from './columns';

const GROUPS: ColumnGroup[] = ['Price', 'Fundamentals', 'Technical', 'Classification'];

/** Show / hide grid columns, grouped; persisted with the rest of the layout. */
export function ColumnPicker() {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const columns = useUiStore(s => s.columns);
  const setColumns = useUiStore(s => s.setColumns);
  const resetColumns = useUiStore(s => s.resetColumns);
  const visibility = { ...DEFAULT_VISIBILITY, ...columns.visibility };
  const visibleCount = COLUMNS.filter(c => visibility[c.id!]).length;

  return (
    <>
      <Button
        ref={anchor}
        size="sm"
        variant="secondary"
        icon="columns"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
      >
        <span className="hidden sm:inline">Columns</span>
        <span className="num text-[10.5px] text-muted">{visibleCount}</span>
      </Button>
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        anchor={anchor}
        align="end"
        width={420}
        label="Choose columns"
      >
        <div className="grid max-h-[60vh] grid-cols-2 gap-x-3 overflow-y-auto p-2">
          {GROUPS.map(group => (
            <div key={group} className="mb-2">
              <p className="px-1.5 pt-1 pb-1 label-caps">{group}</p>
              {COLUMNS.filter(c => c.meta?.group === group).map(c => (
                <Checkbox
                  key={c.id}
                  checked={Boolean(visibility[c.id!])}
                  onChange={on =>
                    c.id !== 'symbol' &&
                    setColumns(layout => ({
                      ...layout,
                      visibility: { ...layout.visibility, [c.id!]: on },
                    }))
                  }
                >
                  {typeof c.header === 'string' ? c.header : c.id}
                </Checkbox>
              ))}
            </div>
          ))}
        </div>
        <div className="flex justify-end border-t border-line p-2">
          <Button size="xs" variant="ghost" icon="reset" onClick={resetColumns}>
            Reset layout
          </Button>
        </div>
      </Popover>
    </>
  );
}

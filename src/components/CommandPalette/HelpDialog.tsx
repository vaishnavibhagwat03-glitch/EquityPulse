'use client';

import { useModKey } from '@/hooks/useHotkeys';
import { useUiStore } from '@/stores/uiStore';
import { Dialog } from '@/components/ui/overlays';
import { Kbd } from '@/components/ui/primitives';
import { IconButton } from '@/components/ui/Button';

const GROUPS = (mod: string) =>
  [
    {
      title: 'Anywhere',
      keys: [
        [[mod, 'K'], 'Command palette'],
        [['/'], 'Command palette'],
        [['?'], 'Keyboard shortcuts'],
        [['G', 'M'], 'Go to Markets'],
        [['G', 'S'], 'Go to Screener'],
        [['G', 'W'], 'Go to Watchlist'],
        [['G', 'H'], 'Go to Heatmap'],
        [['Esc'], 'Close overlay'],
      ],
    },
    {
      title: 'Screener grid',
      keys: [
        [['↑', '↓'], 'Move between rows'],
        [['PgUp', 'PgDn'], 'Page through results'],
        [['Home', 'End'], 'First / last row'],
        [['↵'], 'Open stock detail'],
        [['Space'], 'Add / remove from watchlist'],
        [['F'], 'Collapse or expand filters'],
        [['S'], 'Focus screener search'],
      ],
    },
    {
      title: 'Command palette',
      keys: [
        [['↵'], 'Open chart'],
        [[mod, '↵'], 'Add to watchlist'],
        [['⇧', '↵'], 'Screen similar stocks'],
      ],
    },
    {
      title: 'Chart',
      keys: [
        [['Scroll'], 'Zoom'],
        [['Drag'], 'Pan'],
        [['Dbl-click'], 'Reset view'],
        [['1', '…', '6'], '1D · 1W · 1M · 3M · 1Y · 5Y'],
      ],
    },
  ] as const;

export default function HelpDialog() {
  const setHelp = useUiStore(s => s.setHelp);
  const mod = useModKey();

  return (
    <Dialog open onClose={() => setHelp(false)} labelledBy="help-title" className="max-w-[720px]">
      <div className="flex items-center justify-between border-b border-line px-5 py-3">
        <h2 id="help-title" className="text-[13.5px] font-semibold text-ink">
          Keyboard shortcuts
        </h2>
        <IconButton icon="x" label="Close" onClick={() => setHelp(false)} />
      </div>
      <div className="grid gap-x-8 gap-y-6 px-5 py-5 sm:grid-cols-2">
        {GROUPS(mod).map(group => (
          <section key={group.title}>
            <h3 className="mb-2 label-caps">{group.title}</h3>
            <dl className="space-y-1.5">
              {group.keys.map(([keys, label]) => (
                <div key={label} className="flex items-center justify-between gap-4">
                  <dt className="text-[12.5px] text-ink-2">{label}</dt>
                  <dd className="flex shrink-0 gap-0.5">
                    {keys.map(k => (
                      <Kbd key={k}>{k}</Kbd>
                    ))}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Dialog>
  );
}

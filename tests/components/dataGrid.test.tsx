import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DataGrid, ROW_HEIGHT } from '@/components/DataGrid/DataGrid';
import { market } from '../fixtures/market';
import { loadUniverse, renderWithProviders } from '../helpers/render';

const model = market(120);
const rows = Uint32Array.from(model.stocks.keys());

// jsdom has no layout: give the virtualiser a desktop-sized viewport.
const offsets = {
  offsetWidth: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth'),
  offsetHeight: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight'),
};
beforeAll(() => {
  loadUniverse(model);
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get: () => 1200,
  });
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get: () => 700,
  });
});
afterAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', offsets.offsetWidth!);
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', offsets.offsetHeight!);
});

function Harness({ onOpen = vi.fn(), onToggleWatch = vi.fn() }) {
  const [active, setActive] = useState<string | null>(null);
  return (
    <DataGrid
      stocks={model.stocks}
      rows={rows}
      sort={null}
      onSort={vi.fn()}
      activeSymbol={active}
      onActivate={setActive}
      onOpen={onOpen}
      onToggleWatch={onToggleWatch}
      columnVisibility={{}}
      columnPinning={{ left: ['symbol'], right: [] }}
      columnSizing={{}}
      onLayoutChange={vi.fn()}
      label="Test grid"
    />
  );
}

describe('data grid', () => {
  it('exposes ARIA grid semantics with fixed 36px rows', () => {
    renderWithProviders(<Harness />);
    const grid = screen.getByRole('grid', { name: 'Test grid' });
    expect(ROW_HEIGHT).toBe(36);
    expect(grid).toHaveAttribute('aria-rowcount', String(model.stocks.length + 1));
    const bodyRows = within(grid)
      .getAllByRole('row')
      .filter(r => r.getAttribute('aria-rowindex') !== '1');
    expect(bodyRows.length).toBeGreaterThan(5);
    expect(bodyRows.length).toBeLessThan(model.stocks.length);
    for (const row of bodyRows) expect(row.style.height).toBe('36px');
    expect(bodyRows[0]).toHaveAttribute('aria-rowindex', '2');
    expect(within(grid).getAllByRole('columnheader')[0]).toHaveTextContent('Symbol');
  });

  it('navigates with Home/End/arrows, opens with Enter and watches with Space', async () => {
    const onOpen = vi.fn();
    const onToggleWatch = vi.fn();
    renderWithProviders(<Harness onOpen={onOpen} onToggleWatch={onToggleWatch} />);
    const grid = screen.getByRole('grid');
    const first = model.stocks[0]!.symbol;
    const second = model.stocks[1]!.symbol;

    fireEvent.keyDown(grid, { key: 'Home' });
    await waitFor(() => expect(grid).toHaveAttribute('aria-activedescendant', `row-${first}`));
    fireEvent.keyDown(grid, { key: 'ArrowDown' });
    await waitFor(() => expect(grid).toHaveAttribute('aria-activedescendant', `row-${second}`));
    fireEvent.keyDown(grid, { key: 'ArrowUp' });
    await waitFor(() => expect(grid).toHaveAttribute('aria-activedescendant', `row-${first}`));

    fireEvent.keyDown(grid, { key: 'Enter' });
    expect(onOpen).toHaveBeenCalledWith(first);
    fireEvent.keyDown(grid, { key: ' ' });
    expect(onToggleWatch).toHaveBeenCalledWith(first);

    fireEvent.keyDown(grid, { key: 'End' });
    const last = model.stocks.at(-1)!.symbol;
    await waitFor(() => expect(grid).toHaveAttribute('aria-activedescendant', `row-${last}`));
  });
});

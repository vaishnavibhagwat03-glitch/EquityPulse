import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Group } from '@/types/filters';
import { useFilterStore } from '@/stores/filterStore';
import { useUiStore } from '@/stores/uiStore';
import { ScreenerWorkspace } from '@/components/Screener/ScreenerWorkspace';
import { market } from '../fixtures/market';
import { historyFetch, loadUniverse, renderWithProviders } from '../helpers/render';

const model = market(300);

beforeEach(() => {
  loadUniverse(model);
  useFilterStore.setState({ savedPresets: [] });
  useFilterStore.getState().clearAll();
  useUiStore.setState({
    filtersCollapsed: false,
    contextOpen: false,
    columns: { visibility: {}, pinning: { left: ['symbol'], right: [] }, sizing: {} },
  });
  vi.stubGlobal('fetch', historyFetch(model));
});

const panel = () => screen.getByRole('region', { name: 'Filters' });
const footerCount = () => within(panel()).getByText(/^Showing/).textContent ?? '';

async function openFilter(
  user: ReturnType<typeof userEvent.setup>,
  label: string,
  group?: string,
): Promise<HTMLElement> {
  // Market and Classification start collapsed; Fundamentals and Technical open.
  if (group) {
    const header = within(panel()).getByRole('button', { name: new RegExp(`^${group}`, 'i') });
    if (header.getAttribute('aria-expanded') !== 'true') await user.click(header);
  }
  const toggle = within(panel()).getByRole('button', { name: new RegExp(`^${label}`) });
  if (toggle.getAttribute('aria-expanded') !== 'true') await user.click(toggle);
  return document.getElementById(toggle.getAttribute('aria-controls')!)!;
}

describe('filter panel', () => {
  it('reports "Showing X of Y stocks" live', () => {
    renderWithProviders(<ScreenerWorkspace />);
    expect(footerCount()).toMatch(/Showing\s*300\s*of\s*300\s*stocks/);
  });

  it('filters a numeric range from typed bounds', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ScreenerWorkspace />);
    const body = await openFilter(user, 'P/E Ratio');
    await user.type(
      within(body).getByRole('textbox', { name: 'P/E Ratio maximum value' }),
      '15{Enter}',
    );
    expect(useFilterStore.getState().panel.values.pe).toMatchObject({ type: 'range', max: 15 });
    const expected = model.stocks.filter(s => s.pe !== null && s.pe <= 15).length;
    await waitFor(() => expect(footerCount()).toMatch(new RegExp(`Showing\\s*${expected}\\s*of`)));
    expect(
      within(screen.getByRole('list', { name: 'Applied filters' })).getByText('P/E ≤ 15'),
    ).toBeInTheDocument();

    await user.click(within(panel()).getByRole('button', { name: 'Clear P/E Ratio' }));
    expect(useFilterStore.getState().panel.values.pe).toBeUndefined();
  });

  it('ignores input that is not a number', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ScreenerWorkspace />);
    const body = await openFilter(user, 'ROE');
    const min = within(body).getByRole('textbox', { name: 'ROE minimum value' });
    await user.type(min, 'abc{Enter}');
    expect(useFilterStore.getState().panel.values.roe).toBeUndefined();
    expect(min).toHaveValue('');
  });

  it('selects categories in a multi-select, and can exclude them', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ScreenerWorkspace />);
    const body = await openFilter(user, 'Sector', 'Classification');
    await user.type(within(body).getByLabelText('Find sector'), 'bank');
    await user.click(within(body).getByRole('checkbox', { name: /Banking/ }));
    expect(useFilterStore.getState().panel.values.sector).toEqual({
      type: 'multiselect',
      values: ['Banking'],
    });
    await user.click(
      within(
        within(body).getByRole('radiogroup', { name: 'Sector: include or exclude' }),
      ).getByRole('radio', { name: /exclude/i }),
    );
    expect(useFilterStore.getState().panel.values.sector).toMatchObject({ exclude: true });
    const outside = model.stocks.filter(s => s.sector !== 'Banking').length;
    await waitFor(() => expect(footerCount()).toMatch(new RegExp(`Showing\\s*${outside}\\s*of`)));
  });

  it('toggles boolean criteria and technical relations', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ScreenerWorkspace />);
    const profitable = await openFilter(user, 'Profitable');
    await user.click(within(profitable).getByRole('radio', { name: 'Yes' }));
    expect(useFilterStore.getState().panel.values.isProfitable).toEqual({
      type: 'boolean',
      value: true,
    });

    const sma = await openFilter(user, 'Price vs SMA 50');
    await user.click(within(sma).getByRole('radio', { name: 'Above SMA 50' }));
    expect(useFilterStore.getState().panel.values.priceSma50).toMatchObject({
      type: 'relation',
      relation: 'above',
    });
  });

  it('switches how conditions combine (AND / OR)', async () => {
    const user = userEvent.setup();
    useFilterStore.getState().setValue('pe', { type: 'range', max: 10 });
    useFilterStore.getState().setValue('roe', { type: 'range', min: 25 });
    renderWithProviders(<ScreenerWorkspace />);
    const and = model.stocks.filter(s => s.pe !== null && s.pe <= 10 && s.roe >= 25).length;
    const or = model.stocks.filter(s => (s.pe !== null && s.pe <= 10) || s.roe >= 25).length;
    await waitFor(() => expect(footerCount()).toMatch(new RegExp(`Showing\\s*${and}\\s*of`)));
    const modes = within(panel()).getByRole('radiogroup', {
      name: 'Combine Fundamentals conditions with',
    });
    await user.click(within(modes).getByRole('radio', { name: 'OR' }));
    await waitFor(() => expect(footerCount()).toMatch(new RegExp(`Showing\\s*${or}\\s*of`)));
  });

  it('finds a filter by name or keyword', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ScreenerWorkspace />);
    await user.type(within(panel()).getByRole('searchbox', { name: 'Find a filter' }), 'leverage');
    expect(within(panel()).getByRole('button', { name: /^Debt \/ Equity/ })).toBeInTheDocument();
    expect(within(panel()).queryByRole('button', { name: /^P\/E Ratio/ })).not.toBeInTheDocument();
  });

  it('builds a nested custom expression', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ScreenerWorkspace />);
    await user.click(within(panel()).getByRole('button', { name: /Custom/ }));
    await user.click(within(panel()).getByRole('button', { name: 'Build custom screen' }));
    let custom = useFilterStore.getState().panel.custom!;
    expect(custom.children).toHaveLength(1);

    // Edit the default condition: ROE > 15 → ROCE > 15.
    await user.selectOptions(
      within(panel()).getAllByRole('combobox', { name: 'Field' })[0]!,
      'roce',
    );
    custom = useFilterStore.getState().panel.custom!;
    expect(custom.children[0]).toMatchObject({ field: 'roce' });

    // Add a nested OR group and negate the root.
    await user.click(within(panel()).getByRole('button', { name: 'Group' }));
    await user.click(within(panel()).getAllByRole('button', { name: 'NOT' })[0]!);
    custom = useFilterStore.getState().panel.custom!;
    expect(custom.negate).toBe(true);
    expect((custom.children[1] as Group).combinator).toBe('OR');
    expect(screen.getByRole('list', { name: 'Applied filters' })).toHaveTextContent(
      /Custom · \d+ conditions/,
    );

    await user.click(within(panel()).getByRole('button', { name: 'Remove group' }));
    expect(useFilterStore.getState().panel.custom!.children).toHaveLength(1);
    await user.click(within(panel()).getByRole('button', { name: 'Remove custom screen' }));
    expect(useFilterStore.getState().panel.custom).toBeNull();
  });

  it('shows the compiled expression and clears everything', async () => {
    const user = userEvent.setup();
    useFilterStore.getState().setValue('pe', { type: 'range', max: 15, maxOp: 'lt' });
    renderWithProviders(<ScreenerWorkspace />);
    await user.click(within(panel()).getByRole('button', { name: 'Show compiled expression' }));
    expect(panel()).toHaveTextContent('P/E < 15');
    await user.click(within(panel()).getByRole('button', { name: 'CLEAR ALL FILTERS' }));
    expect(useFilterStore.getState().panel.values).toEqual({});
  });

  it('collapses to an icon rail and back', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ScreenerWorkspace />);
    await user.click(within(panel()).getByRole('button', { name: 'Collapse filters (F)' }));
    expect(useUiStore.getState().filtersCollapsed).toBe(true);
    await user.click(screen.getAllByRole('button', { name: 'Expand filters (F)' })[0]!);
    expect(useUiStore.getState().filtersCollapsed).toBe(false);
  });

  it('saves the current screen and re-applies it later', async () => {
    const user = userEvent.setup();
    useFilterStore.getState().setValue('roe', { type: 'range', min: 20 });
    renderWithProviders(<ScreenerWorkspace />);
    await user.click(screen.getByRole('button', { name: 'Save current screen' }));
    const dialog = screen.getByRole('dialog', { name: 'Save screen' });
    await user.type(within(dialog).getByRole('textbox'), 'High ROE');
    await user.click(within(dialog).getByRole('button', { name: /save/i }));
    expect(useFilterStore.getState().savedPresets.map(p => p.name)).toEqual(['High ROE']);

    useFilterStore.getState().clearAll();
    await user.click(screen.getByRole('button', { name: /More/ }));
    const more = await screen.findByRole('dialog', { name: 'More screens' });
    await user.click(within(more).getAllByRole('button', { name: /High ROE/ })[0]!);
    expect(useFilterStore.getState().panel.values.roe).toEqual({ type: 'range', min: 20 });
  });

  it('chooses grid columns', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ScreenerWorkspace />);
    await user.click(screen.getByRole('button', { name: /Columns/ }));
    const picker = await screen.findByRole('dialog', { name: 'Choose columns' });
    // Symbol is always shown; take the next visible column.
    const box = within(picker)
      .getAllByRole('checkbox')
      .filter(b => (b as HTMLInputElement).checked)[1]!;
    await user.click(box);
    expect(Object.values(useUiStore.getState().columns.visibility)).toContain(false);
  });
});

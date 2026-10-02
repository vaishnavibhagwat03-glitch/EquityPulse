import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { useFilterStore } from '@/stores/filterStore';
import { useUiStore } from '@/stores/uiStore';
import { useWatchlistStore } from '@/stores/watchlistStore';
import CommandPalette from '@/components/CommandPalette/CommandPalette';
import HelpDialog from '@/components/CommandPalette/HelpDialog';
import { GlobalOverlays } from '@/components/Layout/GlobalOverlays';
import { market } from '../fixtures/market';
import { loadUniverse, renderWithProviders } from '../helpers/render';
import { navigation, router } from '../helpers/router';

beforeEach(() => {
  loadUniverse(market(300));
  useUiStore.setState({ paletteOpen: true, helpOpen: false, recent: ['TCS'], theme: 'light' });
  useFilterStore.getState().clearAll();
  useWatchlistStore.getState().clear();
});

const input = () => screen.getByRole('combobox');
const options = () =>
  within(screen.getByRole('listbox', { name: 'Results' })).getAllByRole('option');

describe('command palette', () => {
  it('opens on recent securities, screeners and actions', () => {
    renderWithProviders(<CommandPalette />);
    expect(input()).toHaveFocus();
    expect(input()).toHaveAttribute('placeholder', 'Search securities, actions, or screeners…');
    const list = screen.getByRole('listbox', { name: 'Results' });
    expect(list).toHaveTextContent('TCS');
    expect(list).toHaveTextContent('Value Stocks');
    expect(list).toHaveTextContent('Go to Screener');
  });

  it('finds a security and opens its page with Enter', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CommandPalette />);
    await user.type(input(), 'reliance');
    expect(options()[0]).toHaveTextContent(/Reliance Industries/);
    expect(options()[0]).toHaveTextContent(/NSE|BSE/);
    await user.keyboard('{Enter}');
    expect(router.push).toHaveBeenCalledWith('/RELIANCE');
    expect(useUiStore.getState().paletteOpen).toBe(false);
  });

  it('adds to the watchlist with Ctrl+Enter and screens similar with Shift+Enter', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CommandPalette />);
    await user.type(input(), 'infy');
    await user.keyboard('{Control>}{Enter}{/Control}');
    expect(useWatchlistStore.getState().items.map(i => i.symbol)).toContain('INFY');
    await user.keyboard('{Shift>}{Enter}{/Shift}');
    expect(useFilterStore.getState().panel.values.sector).toBeDefined();
    expect(router.push).toHaveBeenCalledWith('/screener');
  });

  it('applies a preset screener', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CommandPalette />);
    await user.type(input(), 'growth momentum');
    const preset = options().find(o => /Growth Momentum/.test(o.textContent ?? ''))!;
    await user.click(preset);
    expect(useFilterStore.getState().activePresetId).toBe('growth-momentum');
    expect(router.push).toHaveBeenCalledWith('/screener');
  });

  it('runs actions, e.g. switching theme', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CommandPalette />);
    await user.type(input(), 'theme dark');
    await user.keyboard('{Enter}');
    expect(useUiStore.getState().theme).toBe('dark');
  });

  it('moves the selection with the arrow keys', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CommandPalette />);
    const first = input().getAttribute('aria-activedescendant');
    await user.keyboard('{ArrowDown}');
    expect(input().getAttribute('aria-activedescendant')).not.toBe(first);
    await user.keyboard('{ArrowUp}');
    expect(input().getAttribute('aria-activedescendant')).toBe(first);
  });

  it('says so when nothing matches', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CommandPalette />);
    await user.type(input(), 'qqqqzzzz');
    expect(screen.getByText('No results for “qqqqzzzz”.')).toBeInTheDocument();
  });

  it('closes on Escape', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CommandPalette />);
    await user.keyboard('{Escape}');
    expect(useUiStore.getState().paletteOpen).toBe(false);
  });
});

describe('global shortcuts', () => {
  it('Ctrl+K and / open the palette; ? opens help; g s navigates', async () => {
    const user = userEvent.setup();
    useUiStore.setState({ paletteOpen: false });
    navigation.pathname = '/watchlist';
    renderWithProviders(<GlobalOverlays />);
    await user.keyboard('{Control>}k{/Control}');
    expect(useUiStore.getState().paletteOpen).toBe(true);
    expect(await screen.findByRole('combobox')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(useUiStore.getState().paletteOpen).toBe(false);

    await user.keyboard('/');
    expect(useUiStore.getState().paletteOpen).toBe(true);
    useUiStore.setState({ paletteOpen: false });

    await user.keyboard('?');
    await waitFor(() => expect(useUiStore.getState().helpOpen).toBe(true));
    useUiStore.setState({ helpOpen: false });

    await user.keyboard('gs');
    expect(router.push).toHaveBeenCalledWith('/screener');
  });

  it('lists the keyboard shortcuts in the help dialog', async () => {
    const user = userEvent.setup();
    useUiStore.setState({ helpOpen: true });
    renderWithProviders(<HelpDialog />);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent(/Ctrl/);
    expect(dialog).toHaveTextContent(/K/);
    await user.keyboard('{Escape}');
    expect(useUiStore.getState().helpOpen).toBe(false);
  });
});

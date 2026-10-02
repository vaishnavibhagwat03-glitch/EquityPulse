# Day 4 — Grid keyboard navigation and ARIA

**Date:** 2026-09-21
**Hours worked:** 2

## Completed

- ARIA grid semantics (role=grid, row/column indices, aria-sort)
- Arrow keys, Home/End, Page Up/Down, Enter to open, Space to watch
- Live price cells subscribed per symbol so a tick re-renders only that cell

## Next

- Filter engine

## Blockers

- Giving TanStack Table all 5,247 rows cost ~100 ms per re-sort and ~90 MB of heap. Changed it to manage columns only (heap 113 MB -> 24 MB)

## AI tool usage

- Tool: Claude (used frequently)
- Used for: Profiling the row-model cost and refactoring the grid to manage columns only
- My part: reviewed and tested the output, and made the final decisions

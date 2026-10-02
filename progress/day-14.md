# Day 14 — Performance, Lighthouse and accessibility

**Date:** 2026-10-01
**Hours worked:** 2

## Completed

- Measured LCP, CLS, scroll FPS (59 fps presented) and filter timings; wrote PERFORMANCE_REPORT.md
- Gzipped the universe response (1.85 MB -> 0.69 MB) and deferred it until after first paint
- Fixed contrast, label and landmark issues: 0 axe-core violations on every route

## Next

- Bonus features and submission

## Blockers

- Screener layout shift of 0.57 on phones (layout chosen in script); moved to CSS breakpoints
- Lighthouse mobile performance is still below 90 (heavy data download on throttled phones)

## AI tool usage

- Tool: Claude (used frequently)
- Used for: Analysing Lighthouse output and fixing the accessibility findings
- My part: reviewed and tested the output, and made the final decisions

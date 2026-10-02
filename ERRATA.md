# Errata — deliberate errors in the project specification

Section A11.3 of the specification states that its code examples contain three deliberate technical errors: one in an indicator calculation, one in the WebSocket reconnection logic and one in the TypeScript type definitions. Each is listed below with what is wrong, why it matters, the correction, and where this codebase does it correctly.

## 1. Indicator calculation: RSI uses a simple average instead of Wilder smoothing

**Where:** Section A3.2, item 4 (Relative Strength Index).

**As written:**

> RSI = 100 − (100 / (1 + RS)) where RS = average gain over n periods / average loss over n periods.

**What is wrong:** this defines RS from a plain n-period average of gains and losses (Cutler's RSI). RSI as defined by Wilder, and as the specification itself requires in Appendix B4, seeds the averages with a simple mean of the first 14 changes and then **smooths** them:

```
AvgGain(t) = (AvgGain(t−1) × (n − 1) + Gain(t)) / n
AvgLoss(t) = (AvgLoss(t−1) × (n − 1) + Loss(t)) / n
```

**Why it matters:** the two methods diverge after the first value. A simple rolling average forgets every change older than 14 bars, so it is noisier and does not match the RSI shown by trading platforms. An implementation that follows A3.2 fails the 0.01 tolerance the specification sets against Appendix B4.

**Correction:**

```ts
// Seed with the simple mean of the first `period` changes, then smooth (Wilder).
gain = (gain * (period - 1) + Math.max(d, 0)) / period;
loss = (loss * (period - 1) + Math.max(-d, 0)) / period;
const rsi = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
```

**In this codebase:** `rsi()` in [src/lib/technicalIndicators.ts](src/lib/technicalIndicators.ts) uses Wilder smoothing. The tests in [tests/unit/indicators.test.ts](tests/unit/indicators.test.ts) pin it to Wilder's published worked example.

## 2. WebSocket reconnection: the hook reconnects forever after unmount

**Where:** Section A4.2, `useRealtimeUpdates()` in `hooks/useWebSocket.ts`.

**As written:**

```ts
ws.onclose = () => {
  const delay = RECONNECT_DELAYS[Math.min(reconnectAttempt.current, RECONNECT_DELAYS.length - 1)];
  reconnectAttempt.current++;
  setTimeout(connect, delay);
};
// …
useEffect(() => {
  connect();
  return () => wsRef.current?.close();
}, [connect]);
```

**What is wrong:** `onclose` fires for **every** close, including the intentional one in the effect's cleanup. When the component unmounts, the cleanup closes the socket, `onclose` schedules a reconnect, and a new socket opens for a component that no longer exists. That socket's own close schedules another reconnect, so the loop never ends. The reconnect timer is never cleared, and the pending `requestAnimationFrame` is never cancelled.

**Why it matters:**

- **Leaked connections:** sockets and timers keep running after the user leaves the page.
- **Duplicate updates:** in React Strict Mode, effects mount, unmount and mount again in development. This immediately leaves two live sockets, so every update is applied twice.
- **Updates after unmount:** `batchUpdate` keeps receiving updates for a component that is gone.

**Correction:** distinguish an intentional close from a dropped connection, and clean up timers.

```ts
const closedByUs = useRef(false);
const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

ws.onclose = () => {
  if (closedByUs.current) return; // intentional close: do not reconnect
  const delay = RECONNECT_DELAYS[Math.min(reconnectAttempt.current, RECONNECT_DELAYS.length - 1)];
  reconnectAttempt.current++;
  retryTimer.current = setTimeout(connect, delay);
};

useEffect(() => {
  closedByUs.current = false;
  connect();
  return () => {
    closedByUs.current = true;
    if (retryTimer.current) clearTimeout(retryTimer.current);
    if (rafId.current) cancelAnimationFrame(rafId.current);
    wsRef.current?.close();
  };
}, [connect]);
```

**In this codebase:** `FeedClient` in [src/lib/feed/client.ts](src/lib/feed/client.ts) has a `stopped` flag. `stop()` sets it, clears the retry and watchdog timers, and closes the transport, and every reconnect path checks `stopped` first. The backoff is exponential and capped, with jitter so that many clients do not reconnect at the same moment. The lifecycle tests cover reconnecting after a drop and not reconnecting after `stop()`.

## 3. TypeScript types: the simulator reads a field the `Stock` type does not define

**Where:** Section A4.1, `simulateSectorMovement()` in `lib/priceSimulator.ts`, read against the `Stock` interface in Task 1.2 (`types/stock.ts`).

**As written:**

```ts
const newPrice = simulateNextPrice(stock.lastPrice, stock.volatility);
```

**What is wrong:** the `Stock` interface has no `volatility` property. Its technical fields are `rsi14`, `sma50`, `sma200`, `beta`, `atr`, `macdSignal`, `bollingerPosition` and `volumeVsAvg`. Under the strict TypeScript the specification requires, this does not compile (`Property 'volatility' does not exist on type 'Stock'`). Worked around with a cast, it passes `undefined`. `simulateNextPrice` then falls back to its default of 0.02, so every stock moves with the same volatility.

**Why it matters:** the type definition and the code that uses it disagree, so either the build fails or the simulation silently ignores each stock's own risk.

**Correction:** add the field to the type and generate it, then use it:

```ts
export interface Stock {
  // …
  /** Annualised volatility of daily returns, as a fraction (0.25 = 25%). */
  volatility: number;
}
```

**In this codebase:** `Stock` in [src/types/market.ts](src/types/market.ts) defines `volatility` (annualised, from 60 sessions of daily log returns), and the price simulator uses each security's own volatility.

**A related bug in the same function:** `combinedShock` (the sector-correlated shock) is computed but never used, because `simulateNextPrice` draws its own independent random number. As written, the sector correlation therefore has no effect. The simulator should take the shock as a parameter and be called with `combinedShock`.

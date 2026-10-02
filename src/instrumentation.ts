/**
 * Runs once when the Next.js server starts. Generating the universe here
 * (~1 s) means the first visitor's request is served from a warm cache instead
 * of paying for generation in their time-to-first-byte.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { getMarketModel } = await import('@/lib/server/marketData');
  const started = Date.now();
  const model = getMarketModel();
  console.info(`[equitypulse] universe ${model.meta.version} ready in ${Date.now() - started} ms`);
}

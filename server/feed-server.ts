/**
 * Entry point: `npm run feed` (also started by `npm run dev`).
 * Serves the market feed protocol on ws://localhost:${FEED_PORT:-4001}.
 */
import { createFeedServer } from './feedServer';

const port = Number(process.env.FEED_PORT ?? 4001);
const stamp = (): string => new Date().toISOString().slice(11, 19);

createFeedServer({ port, log: message => console.log(`[feed ${stamp()}] ${message}`) })
  .then(server => {
    console.log(`[feed ${stamp()}] streaming on ws://localhost:${server.port}`);
    const shutdown = (): void => {
      console.log(`[feed ${stamp()}] shutting down`);
      void server.close().then(() => process.exit(0));
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  })
  .catch((error: unknown) => {
    console.error(
      `[feed] failed to start: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  });

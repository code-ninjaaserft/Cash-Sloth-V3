import { resolveDefaultBaseDirectory, resolveChannel } from '@cash-sloth/platform';
import { createPiHost, resolvePort } from './index';

try {
  const channel = resolveChannel(process.env.CASH_SLOTH_CHANNEL);
  if (process.env.CASH_SLOTH_DATA_ROOT !== undefined && channel !== 'development') {
    throw new Error('Custom data roots are only allowed in development.');
  }
  const host = await createPiHost({
    baseDirectory: process.env.CASH_SLOTH_DATA_ROOT ?? resolveDefaultBaseDirectory(),
    channel,
    port: resolvePort(process.env.CASH_SLOTH_PORT),
  });
  console.info(`Cash Sloth foundation host listening at ${host.address}`);
  let closing = false;
  const shutdown = (): void => {
    if (closing) return;
    closing = true;
    host.close().catch((error: unknown) => {
      console.error('Host shutdown failed:', error instanceof Error ? error.message : 'Unknown error.');
      process.exitCode = 1;
    });
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
} catch (error: unknown) {
  console.error('Host startup failed:', error instanceof Error ? error.message : 'Unknown error.');
  process.exitCode = 1;
}

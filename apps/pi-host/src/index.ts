import { createServer, type Server } from 'node:http';
import { createSystemService } from '@cash-sloth/application';
import { SystemInfoSchema, type Channel } from '@cash-sloth/contracts';
import { openDatabase } from '@cash-sloth/infrastructure-sqlite';
import { deriveDataPaths, ensureDataDirectories, resolveChannel } from '@cash-sloth/platform';

export const LOOPBACK_HOST = '127.0.0.1';

export function resolvePort(value: string | undefined): number {
  if (value === undefined) return 3210;
  if (!/^\d{1,5}$/.test(value)) throw new Error('CASH_SLOTH_PORT must be an integer from 0 to 65535.');
  const port = Number(value);
  if (port > 65535) throw new Error('CASH_SLOTH_PORT must be an integer from 0 to 65535.');
  return port;
}

export interface PiHostOptions {
  readonly baseDirectory: string;
  readonly channel?: Channel;
  readonly port?: number;
}

export interface PiHost {
  readonly server: Server;
  readonly address: string;
  close(): Promise<void>;
}

export async function createPiHost(options: PiHostOptions): Promise<PiHost> {
  const channel = resolveChannel(options.channel);
  const port = options.port ?? 3210;
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error('The host port must be an integer from 0 to 65535.');
  }
  const paths = deriveDataPaths(options.baseDirectory, channel);
  ensureDataDirectories(paths);
  const database = openDatabase(paths.databaseFile);
  let server: Server | undefined;
  try {
    const version = database.sqlite.prepare('SELECT sqlite_version() AS version').get()?.version;
    if (typeof version !== 'string') throw new Error('Cannot determine SQLite version.');
    const service = createSystemService({
      getInfo: () => ({
        appVersion: '0.0.0',
        channel,
        host: 'pi',
        versions: { node: process.versions.node },
        platform: process.platform,
        arch: process.arch,
        sqliteVersion: version,
      }),
    });
    server = createServer((request, response) => {
      response.setHeader('Content-Type', 'application/json; charset=utf-8');
      response.setHeader('Cache-Control', 'no-store');
      response.setHeader('X-Content-Type-Options', 'nosniff');
      const boundAddress = server?.address();
      const expectedHost = typeof boundAddress === 'object' && boundAddress !== null
        ? `${LOOPBACK_HOST}:${boundAddress.port}`
        : '';
      if (request.headers.host !== expectedHost ||
          (request.headers.origin !== undefined && request.headers.origin !== `http://${expectedHost}`)) {
        response.writeHead(403).end(JSON.stringify({ error: 'Forbidden request origin.' }));
      } else if (request.url !== '/api/system/info') {
        response.writeHead(404).end(JSON.stringify({ error: 'Not found.' }));
      } else if (request.method !== 'GET') {
        response.setHeader('Allow', 'GET');
        response.writeHead(405).end(JSON.stringify({ error: 'Method not allowed.' }));
      } else if (request.headers['transfer-encoding'] !== undefined ||
          (request.headers['content-length'] !== undefined && request.headers['content-length'] !== '0')) {
        response.writeHead(400).end(JSON.stringify({ error: 'This operation does not accept a body.' }));
      } else {
        try {
          const info = SystemInfoSchema.parse(service.getInfo());
          response.writeHead(200).end(JSON.stringify(info));
        } catch {
          response.writeHead(500).end(JSON.stringify({ error: 'System information unavailable.' }));
        }
      }
    });
    server.requestTimeout = 5000;
    server.headersTimeout = 5000;
    server.maxHeadersCount = 50;
    const activeServer = server;
    await new Promise<void>((resolve, reject) => {
      activeServer.once('error', reject);
      activeServer.listen(port, LOOPBACK_HOST, () => {
        activeServer.removeListener('error', reject);
        resolve();
      });
    });
    const address = activeServer.address();
    if (address === null || typeof address === 'string') throw new Error('Cannot determine host address.');
    let closing: Promise<void> | undefined;
    return {
      server: activeServer,
      address: `http://${LOOPBACK_HOST}:${address.port}`,
      close: () => {
        closing ??= new Promise<void>((resolve, reject) => {
          activeServer.close((error) => {
            try {
              database.close();
              if (error) reject(error);
              else resolve();
            } catch (closeError) {
              reject(closeError);
            }
          });
          activeServer.closeAllConnections();
        });
        return closing;
      },
    };
  } catch (error) {
    server?.closeAllConnections();
    server?.close();
    database.close();
    throw error;
  }
}

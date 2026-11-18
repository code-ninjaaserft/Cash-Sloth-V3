import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { ChannelSchema, type Channel } from '@cash-sloth/contracts';

export function resolveChannel(value: unknown): Channel {
  const result = ChannelSchema.safeParse(value === undefined ? 'development' : value);
  if (!result.success) throw new Error('CASH_SLOTH_CHANNEL must be development, beta or stable.');
  return result.data;
}

export interface DataPaths {
  readonly root: string;
  readonly databaseDirectory: string;
  readonly databaseFile: string;
  readonly configDirectory: string;
  readonly logsDirectory: string;
}

export function deriveDataPaths(baseDirectory: string, channel: Channel): DataPaths {
  if (!isAbsolute(baseDirectory)) throw new Error('The data base directory must be absolute.');
  const root = join(baseDirectory, resolveChannel(channel));
  const databaseDirectory = join(root, 'database');
  return {
    root,
    databaseDirectory,
    databaseFile: join(databaseDirectory, 'cash-sloth.sqlite'),
    configDirectory: join(root, 'config'),
    logsDirectory: join(root, 'logs'),
  };
}

export function ensureDataDirectories(paths: DataPaths): void {
  for (const directory of [paths.databaseDirectory, paths.configDirectory, paths.logsDirectory]) {
    mkdirSync(directory, { recursive: true });
  }
}

export function resolveDefaultBaseDirectory(
  environment: Readonly<Record<string, string | undefined>> = process.env,
  platform: string = process.platform,
  home: string = homedir(),
): string {
  const parent = platform === 'win32'
    ? (environment.LOCALAPPDATA ?? join(home, 'AppData', 'Local'))
    : (environment.XDG_DATA_HOME ?? join(home, '.local', 'share'));
  if (!isAbsolute(parent)) throw new Error('The platform data directory must be absolute.');
  return join(parent, 'CashSlothV3');
}

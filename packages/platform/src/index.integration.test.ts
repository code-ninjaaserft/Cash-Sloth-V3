import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  deriveDataPaths,
  ensureDataDirectories,
  resolveChannel,
  resolveDefaultBaseDirectory,
} from './index';

const temporaryDirectories: string[] = [];
afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('environment separation', () => {
  it('keeps database, configuration and log files isolated between all channels', () => {
    const base = mkdtempSync(join(tmpdir(), 'cash-sloth-paths-'));
    temporaryDirectories.push(base);
    const channels = ['development', 'beta', 'stable'] as const;
    const allPaths = channels.map((channel) => deriveDataPaths(base, channel));
    for (const [index, paths] of allPaths.entries()) {
      ensureDataDirectories(paths);
      writeFileSync(paths.databaseFile, `database-${index}`);
      writeFileSync(join(paths.configDirectory, 'settings.json'), `config-${index}`);
      writeFileSync(join(paths.logsDirectory, 'session.log'), `log-${index}`);
    }
    for (const [index, paths] of allPaths.entries()) {
      expect(readFileSync(paths.databaseFile, 'utf8')).toBe(`database-${index}`);
      expect(readFileSync(join(paths.configDirectory, 'settings.json'), 'utf8')).toBe(`config-${index}`);
      expect(readFileSync(join(paths.logsDirectory, 'session.log'), 'utf8')).toBe(`log-${index}`);
    }
    expect(new Set(allPaths.flatMap((paths) => Object.values(paths))).size).toBe(15);
  });

  it('defaults to development and fails closed on invalid channel or relative paths', () => {
    expect(resolveChannel(undefined)).toBe('development');
    expect(resolveChannel('beta')).toBe('beta');
    for (const value of ['../stable', '', 'production', null, 1]) {
      expect(() => resolveChannel(value)).toThrow();
    }
    expect(() => deriveDataPaths('relative', 'development')).toThrow();
    expect(() => deriveDataPaths(tmpdir(), '../stable' as 'stable')).toThrow();
  });

  it('uses explicit OS data roots without depending on the working directory', () => {
    const base = tmpdir();
    expect(resolveDefaultBaseDirectory({ LOCALAPPDATA: base }, 'win32', base))
      .toBe(join(base, 'CashSlothV3'));
    expect(resolveDefaultBaseDirectory({}, 'win32', base))
      .toBe(join(base, 'AppData', 'Local', 'CashSlothV3'));
    expect(resolveDefaultBaseDirectory({ XDG_DATA_HOME: base }, 'linux', base))
      .toBe(join(base, 'CashSlothV3'));
    expect(resolveDefaultBaseDirectory({}, 'linux', base))
      .toBe(join(base, '.local', 'share', 'CashSlothV3'));
    expect(() => resolveDefaultBaseDirectory({ XDG_DATA_HOME: 'relative' }, 'linux', base))
      .toThrow();
  });
});

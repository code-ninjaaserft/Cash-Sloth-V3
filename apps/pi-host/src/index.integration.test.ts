import { mkdtempSync, rmSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SystemInfoSchema } from '@cash-sloth/contracts';
import { createPiHost, LOOPBACK_HOST, resolvePort, type PiHost } from './index';

const hosts: PiHost[] = [];
const directories: string[] = [];
afterEach(async () => {
  for (const host of hosts.splice(0)) await host.close();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

async function startHost(): Promise<PiHost> {
  const baseDirectory = mkdtempSync(join(tmpdir(), 'cash-sloth-host-'));
  directories.push(baseDirectory);
  const host = await createPiHost({ baseDirectory, port: 0 });
  hosts.push(host);
  return host;
}

async function rawRequestStatus(
  address: string,
  headers: Readonly<Record<string, string>>,
  body?: string,
): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const outgoing = request(`${address}/api/system/info`, { method: 'GET', headers }, (response) => {
      response.resume();
      response.once('end', () => resolve(response.statusCode ?? 0));
      response.once('error', reject);
    });
    outgoing.once('error', reject);
    outgoing.end(body);
  });
}

describe('standalone Node host', () => {
  it('serves runtime-validated information over a real loopback-only listener', async () => {
    const host = await startHost();
    const address = host.server.address();
    expect(typeof address === 'object' && address !== null && address.address).toBe(LOOPBACK_HOST);
    const response = await fetch(`${host.address}/api/system/info`);
    expect(response.status).toBe(200);
    const info = SystemInfoSchema.parse(await response.json());
    expect(info.host).toBe('pi');
    expect(info.channel).toBe('development');
    expect(info.versions.node).toBe(process.versions.node);
    expect(info.versions.electron).toBeUndefined();
    expect(info.sqliteVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('rejects unknown paths, methods and browser origins', async () => {
    const host = await startHost();
    expect((await fetch(`${host.address}/missing`)).status).toBe(404);
    expect((await fetch(`${host.address}/api/system/info?unexpected=true`)).status).toBe(404);
    const post = await fetch(`${host.address}/api/system/info`, { method: 'POST' });
    expect(post.status).toBe(405);
    expect(post.headers.get('allow')).toBe('GET');
    expect((await fetch(`${host.address}/api/system/info`, {
      headers: { Origin: 'https://untrusted.invalid' },
    })).status).toBe(403);
    // fetch replaces Host; use the HTTP transport to exercise a forged header.
    expect(await rawRequestStatus(host.address, { Host: 'untrusted.invalid' })).toBe(403);
    expect(await rawRequestStatus(host.address, { 'Content-Length': '1' }, 'x')).toBe(400);
  });

  it('validates configured ports before opening any listener', async () => {
    expect(resolvePort(undefined)).toBe(3210);
    expect(resolvePort('0')).toBe(0);
    expect(resolvePort('65535')).toBe(65535);
    for (const value of ['', '-1', '65536', '3.5', '3210abc', ' 3210']) {
      expect(() => resolvePort(value)).toThrow();
    }
    await expect(createPiHost({ baseDirectory: tmpdir(), port: -1 })).rejects.toThrow();
    await expect(createPiHost({ baseDirectory: tmpdir(), port: 1.5 })).rejects.toThrow();
  });
});

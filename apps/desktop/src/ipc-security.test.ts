import { describe, expect, it, vi } from 'vitest';
import type { SystemInfo } from '@cash-sloth/contracts';
import { handleSystemGetInfo, type SenderIdentity } from './ipc-security.js';

const expected: SenderIdentity = {
  webContentsId: 4,
  frameProcessId: 8,
  frameRoutingId: 12,
  url: 'file:///application/pos-ui/dist/index.html',
};
const info: SystemInfo = {
  appVersion: '0.0.0', channel: 'development', host: 'desktop',
  versions: { node: '24.22.1', electron: '45.3.0' },
  platform: 'win32', arch: 'x64', sqliteVersion: '3.50.0',
};

describe('system.getInfo IPC boundary', () => {
  it('accepts the expected top-level frame and a strict empty request', () => {
    expect(handleSystemGetInfo(expected, expected, [{}], () => info)).toEqual(info);
  });

  it.each([
    null,
    { ...expected, webContentsId: 99 },
    { ...expected, frameProcessId: 99 },
    { ...expected, frameRoutingId: 99 },
    { ...expected, url: 'https://untrusted.invalid/' },
    { ...expected, url: `${expected.url}?untrusted=1` },
    { ...expected, url: 'file:///application/pos-ui/dist/other.html' },
  ])('rejects unauthorized windows, subframes and URLs before invoking the service', (sender) => {
    const getInfo = vi.fn(() => info);
    expect(() => handleSystemGetInfo(sender, expected, [{}], getInfo)).toThrow();
    expect(getInfo).not.toHaveBeenCalled();
  });

  it.each([[], [undefined], [null], [''], [[]], [{ extra: true }], [{}, {}]])(
    'rejects malformed request arguments %# before invoking the service',
    (...args: unknown[]) => {
      const getInfo = vi.fn(() => info);
      expect(() => handleSystemGetInfo(expected, expected, args, getInfo)).toThrow();
      expect(getInfo).not.toHaveBeenCalled();
    },
  );

  it('runtime-validates the service response', () => {
    expect(() => handleSystemGetInfo(expected, expected, [{}], () => ({ ...info, appVersion: '' })))
      .toThrow();
  });
});

import { describe, expect, it } from 'vitest';
import { SystemGetInfoRequestSchema, SystemInfoSchema } from './index';

describe('system contracts', () => {
  it.each([null, undefined, [], 'system:getInfo', { extra: true }])('rejects unexpected request: %j', (input) => {
    expect(SystemGetInfoRequestSchema.safeParse(input).success).toBe(false);
  });

  it('accepts an empty request and rejects untrusted response fields', () => {
    expect(SystemGetInfoRequestSchema.parse({})).toEqual({});
    const info = {
      appVersion: '0.0.0', channel: 'development', host: 'pi',
      versions: { node: '24.22.1' }, platform: 'linux', arch: 'arm64', sqliteVersion: '3.50.0',
    };
    expect(SystemInfoSchema.parse(info)).toEqual(info);
    expect(SystemInfoSchema.safeParse({ ...info, channel: '../stable' }).success).toBe(false);
    expect(SystemInfoSchema.safeParse({ ...info, versions: { node: '24', secret: 'redacted' } }).success).toBe(false);
    expect(SystemInfoSchema.safeParse({ ...info, databasePath: '/private' }).success).toBe(false);
  });
});

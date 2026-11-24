import { z } from 'zod';
const state = z.strictObject({ enabled: z.boolean(), sessionId: z.string().nullable() });
export const DEMO_CONTRACTS = {
  getState: { channel: 'demo:getState', request: z.strictObject({}), response: state },
  setMode: { channel: 'demo:setMode', request: z.strictObject({ enabled: z.boolean() }), response: z.discriminatedUnion('ok', [z.strictObject({ ok: z.literal(true), value: state }), z.strictObject({ ok: z.literal(false), error: z.string() })]) },
} as const;
export interface DemoApi {
  getState(input: Record<string, never>): Promise<z.infer<typeof state>>;
  setMode(input: { enabled: boolean }): Promise<z.infer<typeof DEMO_CONTRACTS.setMode.response>>;
}

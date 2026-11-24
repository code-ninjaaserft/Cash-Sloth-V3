import { z } from 'zod';
import { PosErrorSchema } from './pos.js';
import type { TicketsApi } from './tickets.js';
export const TICKETDESK_CONTRACTS = {
 open: { channel: 'ticketdesk:open', request: z.strictObject({}), response: z.discriminatedUnion('ok', [z.strictObject({ ok: z.literal(true), value: z.strictObject({ opened: z.literal(true) }) }), z.strictObject({ ok: z.literal(false), error: PosErrorSchema })]) },
 getState: { channel: 'ticketdesk:getState', request: z.strictObject({}), response: z.strictObject({ enabled: z.boolean(), sessionId: z.string().nullable() }) },
} as const;
export interface TicketdeskControlApi { open(input: Record<string, never>): Promise<z.infer<typeof TICKETDESK_CONTRACTS.open.response>> }
export interface TicketdeskApi extends Pick<TicketsApi, 'lookup' | 'redeem'> { getState(input: Record<string, never>): Promise<z.infer<typeof TICKETDESK_CONTRACTS.getState.response>> }

import type { Ticket, TicketMode } from '@cash-sloth/domain';
export interface TicketRedemption { readonly operationId: string; readonly code: string; readonly expectedUses: number; readonly redeemedAt: string }
export interface TicketStore {
 controls?(code:string):{expiresAt:string|null;revokedAt:string|null};
 invalidate?(code:string,at:string):void;
 setExpiry?(code:string,at:string|null):void;
 readonly mode: TicketMode;
 transaction<T>(operation: () => T): T;
 get(code: string): Ticket | null;
 list(saleId: string): readonly Ticket[];
 redemptions(code: string): readonly TicketRedemption[];
 getOperation(operationId: string): TicketRedemption | null;
 refundedQuantity(saleId: string, saleItemId: string): number;
 redeem(entry: TicketRedemption): void;
}

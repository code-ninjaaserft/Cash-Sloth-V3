# Local tickets and vouchers

Cash Sloth V3 · Faultir Softworks · OP Faultir Chrysos

In **Catalog → New product** or an existing product, enable **Generate a ticket for each unit sold** and choose **Allowed redemptions per ticket** (1–1000). This is a product-level setting shared by its variants. Two units create two independently identifiable tickets, not one ticket with quantity two. The default when enabled is one redemption. Presets save/copy/load this setting with the catalog. No calendar expiration is configured.

Ticket policy is snapshotted when adding a cart line, alongside its price/name. Adding the same variant after changing the policy creates a separate line; existing items retain their original entitlement. A cart may contain at most 1000 ticket-bearing units. Disabled products/settings do not invalidate already issued tickets.

## Issuance and preview

Tickets are inserted in the same SQLite transaction as completion of a financial sale (including legacy cash completion). They are not issued on a draft, payment preparation, partial payment or cancellation. A failed insert rolls back the sale completion, while durable payment evidence remains available for recovery. Retrying an already completed checkout returns its original tickets and never creates additional codes.

Each ticket stores its own unique local random code, sale/item reference, unit ordinal, snapshotted product/variant, event title, issue timestamp and redemption allowance. The receipt preview includes an additional **Tickets / vouchers** section with a selector for the individual 80 mm ticket previews. Reopen **Sales history → sale → View / print receipt** for the same codes. Current status is checked on screen in the ticketdesk, not printed on paper. Reopening a preview does not issue or redeem tickets.

**Print tickets** is an intentionally disabled placeholder, matching the current receipt printer placeholder. No printer dialog, device connection, paper delivery or print acknowledgement is implemented. The preview uses Code 39 barcodes with start/stop symbols, narrow/wide bars and quiet zones; the [ZXing reference character table](https://github.com/zxing/zxing/blob/master/core/src/main/java/com/google/zxing/oned/Code39Reader.java) was used to check the encoding. Codes are also printed as text. Physical readability and printer dimensions must be checked with the actual 80 mm printer/scanner once available.

## Redemption

Open **Redeem tickets**. Type the code or scan with a keyboard-style barcode scanner configured to send Enter. Enter only checks the ticket; **Redeem once** is an explicit second action. The screen shows event/product, issue time, remaining allowance, status and dated redemption history. Looking up or scanning again does not consume a use automatically. Codes are checked against this device's local database, without network access or cross-device validity.

A redemption is transactional, uses an expected redemption count and has a unique operation reference. Double-clicks, repeated delivery and retries after a lost acknowledgement cannot consume an additional use. Stale counts and exhausted tickets are rejected. An outstanding reference is retained locally for **Check / retry same redemption** after a reload. Do not create a fresh operation blindly after an uncertain outcome.

Confirmed item refunds invalidate the first unit ordinals corresponding to the accumulated refunded quantity; prior redemption timestamps remain visible. This follows the existing refund allocation order and does not select a particular physical customer's ticket. Explicit deletion of a sale/event/device history also deletes linked tickets and their redemption records. Product/category deletion alone does not delete issued tickets.

Demo mode routes ticket issuance and redemption to the isolated demo database. Each new ticket stores its immutable origin mode: normal codes start with CS, demo codes with DS. Lookup and redemption reject the opposite mode before reading or replaying an operation. This also blocks normal tickets copied into the demo snapshot; they cannot be redeemed there. Demo tickets carry a fixed DEMO TICKET label in their preview and are rejected in normal mode. Existing tickets without an origin field remain normal tickets. No existing ticket codes or financial snapshots are rewritten.

## Storage and verification

Migration 0014 adds product/cart/legacy-item ticket settings, immutable ticket snapshots and redemption records as separate tables. Existing financial rows and their JSON snapshots are not rewritten. Ticket issuance uses the original transaction; deletion cleanup runs through sale-delete triggers inside the authorized purge. Legacy pre-ticket migration fixtures continue to operate without ticket tables.

Integration checks cover policy snapshots and changes, unique per-unit issuance, no tickets for cancelled drafts or disabled products, quantity bounds, rollback, lost commit acknowledgements, idempotent/stale redemption, exhaustion, restart, refunds, deletion, preset roundtrips and legacy cash. The desktop workflow exercises product configuration, individual previews, keyboard/Enter lookup, repeated redemption, restart, history preview, German labels and demo isolation. Customer display access remains read-only and does not expose the ticket API.

## Separate ticketdesk window

Open **Settings → Ticketdesk → Open ticketdesk**, or use **Redeem tickets → Open ticketdesk**. The separate, movable window has only ticket-code input, validity checking, explicit redemption and redemption history. The register can continue taking sales at the same time. Opening it again focuses the existing window; closing and reopening does not reset stored redemptions.

The ticketdesk has its own sandboxed preload with only getState, lookup and redeem. It has no cashier/customer bridge, catalog/sales controls, sale listing or direct Node/filesystem access. The existing sender/frame/URL checks accept its exact window only for the permitted ticket operations. Its recovery pointer is separate from the register's ticket-redemption pointer. Both windows use the same transactional ticket ledger, expected-use check and operation-reference deduplication.

A mode change closes the ticketdesk so staff cannot continue checking a different ledger unnoticed. Reopen it for the new mode; in demo mode it displays the same red demonstration banner. Closing the main register also closes the ticketdesk.

Printed ticket previews now contain only fixed issuance information: event, product/variant, issue time, original allowed redemptions and barcode/text code. Ticket status and remaining uses are excluded from the paper component. They remain prominent in the checking screen, where they can reflect actual redemption/refund history. The paper component accepts the immutable Ticket shape rather than TicketInfo.

The ticketdesk desktop check covers a separate limited window, live lookup without redemption, explicit redemption visible in the register, simultaneous cart use, duplicate-open/reopen behavior, window movement, demo transitions and absence of changing state on the printed ticket.

Mode-isolation checks create a real ticket, copy it into a demo database, and reject it there without recording a redemption. They also create/redeem a DS demo ticket only in demo mode, reject it in normal mode, confirm that genuine tickets still redeem normally and verify legacy snapshots without the new origin field. The ticketdesk workflow checks the same mode rejection through its restricted bridge.

## Unlimited tickets, expiry and manual invalidation

Enable **Unbegrenzt einlösbar** in the product editor after enabling ticket issuance. The original product setting is preserved in presets and snapshotted into cart lines. Unlimited tickets do not exhaust after a fixed number of redemptions; the screen shows infinity and the actual dated redemption count. Finite allowances remain 1–1000.

In the main register's **Tickets einlösen**, look up a ticket to set **Gültig bis (optional)**. The entered local date/time is stored as an absolute timestamp. **Kein Ablaufdatum** clears this deadline. The deadline is configured per issued ticket. It is enforced on lookup and every redemption; changing a display does not bypass the server-side check.

**Ticket wertlos machen** asks for confirmation and permanently invalidates that ticket. Clearing or changing an expiry cannot reactivate an invalidated ticket. Original issue information and past redemption dates remain available for statistics. Current status/remaining uses are still excluded from the paper preview. Ticketdesk staff can check/redeem but cannot change expiry or invalidate tickets; those administrative endpoints are authorized only for the main register. Both real/demo mode restrictions remain in force.

Migration 0015 adds team-consumption and ticket-control tables, preserves existing finite policies/redemptions while expanding their storage for unlimited policy/counters, and leaves earlier migration checksums untouched. The implementation uses 2147483647 as the persisted unlimited-policy sentinel; it is treated as unlimited, not as an exhaustion threshold. Counter increments remain transactional and idempotent.

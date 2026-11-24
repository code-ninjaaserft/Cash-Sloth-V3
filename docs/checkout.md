# Guided checkout

Cash Sloth V3 · Faultir Softworks · OP Faultir Chrysos

Select **Checkout** to open the compact payment dialog.

- **Cash** opens additive Swiss coin/note buttons, using the artwork supplied by the project owner. Every tap adds the displayed denomination. **Undo last entry** removes the most recent tap; **Reset** clears the entered tender. The summary shows either the amount still required or change. **Complete transaction** confirms receipt of the entered cash and return of the displayed change. The server retains the existing CHF 0.05 rounding rules.
- **Card / TWINT** opens an external-payment confirmation. Select Card or TWINT so the ledger records the actual method. Only select **Your transaction was completed successfully** after independently verifying the external payment. This app does not initiate a provider payment or verify settlement.
- A successful quick checkout opens an 80 mm receipt preview of the committed sale. **Do not print** closes the preview and unlocks the empty register for the next customer. **Print receipt** is a disabled positioning placeholder until a printer is configured. Completed sales and receipts remain available through Sales history, where **View / print receipt** reopens the same original receipt even if catalog prices have changed.
- **More payment options** retains the existing detailed interface for partial/mixed payments. Recovered sessions also use the detailed interface. Its completion retains the receipt review screen.
- A failed or uncertain reply blocks the quick confirmation button. **Check stored result** reads the authoritative checkout before entering recovery. It never repeats a payment automatically. Closing or cancelling a fresh dialog cancels the unused checkout and returns its cart to editing.

The cash art is stored at `apps/pos-ui/src/assets/cash-denominations.png` and shown through SVG viewports. CHF 50 and CHF 200 use the updated, separately supplied `cash-note-50.png` and `cash-note-200.png` images. The supplied images are preserved. Values and accessible button labels are defined independently from the decorative image in integer Rappen. Available denominations range from CHF 0.05 to CHF 1000.00.

Validation: `pnpm exec playwright test tests/electron/quick-checkout.spec.ts` tests entry/undo/reset, Swiss rounding/change, duplicate clicks, Card/TWINT method retention, direct return to the register, cancellation and an interrupted confirmation requiring investigation.

## Round-up tips

Before payment, **Round up to next CHF 5** and **Round up to next CHF 10** show the resulting total and the separate gratuity. An exact multiple advances to the following interval. The buttons always use the original amount, so changing the option does not compound tips. **Remove tip** restores the original amount. Cash options use the CHF 0.05 rounded base and are disabled when entered cash is positive but insufficient for that option; the returned change includes the selected tip. Card/TWINT options use the exact base and the operator must collect the increased amount externally before confirming it. Changing the quick checkout payment type clears the choice.

The detailed payment screen supports the same options before any live payment attempt. `setTip` updates an open session using the expected previous amount; a prepared, reported, uncertain or confirmed transfer prevents changing the tip. Checkout recovery retains its stored tip. Completed sales store immutable `tipRappen`; receipt preview, sale details, history and the `tip_rappen` CSV column display it separately. Product refunds exclude gratuities and continue to allocate only the merchandise payment and its cash rounding.

**Custom tip** accepts an additional amount, while **Round up to amount** accepts a desired final total. Both show the final total and gratuity before **Apply tip**. Entries replace the previous choice instead of adding to it. Decimal commas and points are accepted. Targets below the original base, overflowing amounts and positive cash tenders below the target are rejected. Cash uses CHF 0.05 increments; Card/TWINT supports individual Rappen. Cancelling the custom editor leaves the currently applied tip unchanged.

Migration 0011 extends the financial ledger's tip constraints. It transactionally copies historical sale payloads unchanged into the extended table and reinstates its indexes, immutable-record triggers and settlement/refund guards. Earlier migrations and their checksums remain unchanged. Domain and SQLite checks retain integer-Rappen arithmetic, bounded totals, payment confirmation integrity and idempotent sale completion.

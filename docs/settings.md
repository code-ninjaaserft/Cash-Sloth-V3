# Appearance and language

Cash Sloth V3 · Faultir Softworks · OP Faultir Chrysos

Open the application menu and select **Settings** (**Einstellungen**).

- Light and Dark override the operating system. System follows the operating system's preferred color scheme, including changes while the app is open.
- English and Deutsch switch the interface immediately. Catalog names, imported data, historical sale descriptions and external diagnostic messages retain their original content.
- Preferences are saved locally in the current desktop channel's browser storage (`cash-sloth.preferences.v1`), independently from financial records. The initial selection is System and English. Invalid saved values fall back to these defaults. A storage failure is shown in Settings; changes then apply only for the current session.
- Dates use the selected Swiss locale. Payment calculations and stored financial values do not depend on language or appearance.

Run `pnpm exec playwright test tests/electron/preferences.spec.ts` after building for the real Electron language, theme, operating-system change and restart checks.

Theme color can be selected independently from appearance using Green, Yellow, Red, Blue or Purple presets, or the custom color picker. The selected RGB color gives surfaces a visible tint and highlights primary actions. Body text follows the Light/Dark palette; primary button text uses black or white according to the selected color. Neutral custom colors use a neutral palette. Existing saved preferences without a color retain the default green. Receipts use the same surface palette as the rest of the application.

The accent also styles navigation surfaces, product and variant tiles, category controls, quantity badges and payment controls. Sidebar, menu, product and selected surfaces use distinct tones of the same hue. Selected navigation/category entries additionally have a leading accent marker. Warning and error colors retain their meanings. The appearance tests check that changing the accent updates these controls in both modes and preserves readable text contrast.

Presets use exact RGB values: Yellow `#ffff00` (255,255,0), Red `#ff0000` (255,0,0) and Blue `#0000ff` (0,0,255). Interactive surfaces mix the selected color with their light/dark base. Primary button text switches between black and white to maintain contrast.

Theme surfaces and appearance previews use perceptual OKLab mixing with white or neutral dark bases. This keeps light blue menu/sidebar/control tints visibly blue rather than the lavender appearance of direct RGB mixing. The selected preset RGB value remains unchanged. The appearance check samples rendered sRGB pixels for text contrast and verifies blue surfaces retain a blue-dominant tint in both modes.

To save a custom theme color, choose **Custom color**, enter a **Color name** and select **Save color**. Saved colors appear as reusable named buttons and persist with the current channel's local preferences. Names must be unique (ignoring case), with up to 48 characters; up to 100 colors can be saved.

Each saved color has **Edit** and **Delete color** controls. Editing changes its name and RGB value; saving also updates the active theme when that saved RGB value was selected. Cancel leaves the saved entry intact. Deleting removes the saved entry while retaining the current theme RGB value. Changes persist across restart. Duplicate names remain blocked.

**Customer display → Open customer display** opens a separate movable window for a second screen. Repeated presses restore/focus the same window; closing it permits a fresh one to be opened. It shows the active event title, current products/variants, quantities and prices, subtotal, tip, cash rounding, amount due, received cash and change. It automatically clears for the next customer when checkout completes. Language and theme follow the register. It opens only on request and closes when the register window closes.

The customer window has its own sandboxed preload exposing only `customerDisplay:getState`, authorized for that exact window and URL. It has no cashier, catalog, history or payment mutation API. The host produces a minimal snapshot without sale/cart/customer identifiers, refund history or operator notes, refreshed every 300 ms. The cashier may send a validated, ephemeral payment preview tied to the active checkout so uncommitted tip/tender choices can be shown without recording a payment. Actual amounts are calculated in the shared application/domain logic; financial records remain unchanged by display updates. A failed read clears the displayed cart until a fresh snapshot arrives.

`tests/electron/customer-display.spec.ts` covers color editing/deletion, duplicate names, persistence, read-only window capabilities, opening/reopening, live cart/checkout/tip/change updates, customer turnover and cross-window language changes.

The customer view uses the full window width, independently of the register's default content-width limit. Item quantities have a large contrasting badge beside each product. The total panel reserves space for currency and amount on one line; narrower windows stack the panels. The app check exercises both 1920-pixel Full HD and a 960-pixel effective window width.

**Presets → Edit preset → Preset logo** configures each event logo. The creation form also accepts a logo. Loading a preset loads its image into the register event heading and customer header. The application/sidebar branding is unchanged. Editing an inactive preset preserves the active event and current catalog; copying a preset copies its logo. Older device-level logos can be imported explicitly using **Use previously selected logo**. General Settings contains the customer-window control, while logo controls belong to Presets.

PNG, JPEG and WebP images up to 10 MiB are accepted after signature checking and successful raster decoding. Oversized pixel dimensions are rejected. A proportionally resized PNG copy (at most 512 pixels on its longest edge) is stored in the preset data, so moving or deleting the original file does not break the logo. Older presets without a logo use the normal display. SVG and external URLs are not accepted. The image-only CSP permits embedded data images; script/network permissions remain unchanged. The preset-logo app test covers image selection, independent per-event images, metadata editing, copying/loading, both screens, restart, invalid replacement and removal.

In **Catalog → New category** or **Edit category**, enable **Use category color**, pick **Category color**, then **Save category**. Category colors are catalog data, stored by additive migration 0006 without changing existing financial records. Categories without a color retain the theme styling. Products display a colored surface, top border and category label, including in **All products**. A colored active primary category takes precedence; otherwise the active assigned colored category with the first stable ID is used. Multiple assignments never produce a changing color based on the current category filter. Disabling **Use category color** clears that category's custom color.

## Demo mode

Cash Sloth V3 · Faultir Softworks · OP Faultir Chrysos

**Settings → Demo mode → Activate demo mode** starts an isolated demonstration with the current catalog, presets and logo. A permanent red banner appears above the register, including checkout/receipt dialogs, and above the customer display. Finish pending payments/refunds and empty the cart before changing mode.

The desktop host makes a consistent SQLite snapshot into a newly created temporary demo directory using a bound `VACUUM INTO` destination. All catalog, preset, cart and payment services then use that separate connection. The live database remains authoritative for history searches, recent-sale lists and exports; demo sales never enter that ledger or its revenue totals. History deletion and consequential refund/reconciliation commands are blocked in demo mode. Customer payment previews follow the selected connection. Recovery pointers for demonstration operations use a session-specific sessionStorage namespace instead of live localStorage pointers.

**End demo mode** restores the live services and discards the temporary database, including demonstration product/preset changes. Normal shutdown also cleans up the temporary copy. An abnormal process termination may leave an unused temporary directory, but startup always selects the live database and never resumes a demo. Demo mode is session-only and must be activated explicitly after a restart. Preferences such as language and appearance remain shared device preferences.

`tests/electron/demo-mode.spec.ts` verifies a real sale before and after a demonstration, unchanged live sales history during the demo, independent catalog changes, both red banners, idle guards, blocked history removal, reload and restart behavior.

**Settings → Ticketdesk → Open ticketdesk** opens a separate movable ticket-service window. It can check and confirm ticket redemptions while the cashier continues selling. Its permissions and recovery pointer are independent of the register UI; see [Local tickets and vouchers](tickets.md). Switching demo mode closes it, after which it can be reopened for the selected mode.

## Complimentary helper/team consumption

**Helfer / Team** is the third quick-checkout choice beside cash and card/TWINT. Confirming it records the cart's product/variant names, quantities, historical nominal prices, event title and time, consumes the draft and closes the unpaid checkout. It creates no payment attempt and no financial sale, so it cannot increase cash, card/TWINT income, tips or financial revenue. Preparing any payment or tip blocks conversion to a team booking. Repeating the operation for the same session returns the same stored result. A recovery pointer is saved before submission.

The menu entry **Helfer / Team Statistik** displays complimentary consumption quantities, nominal goods value and event-labelled booking records (the most recent 10000 bookings). These goods values are reference values, never received money. This is a separate consumption record, rather than a zero-priced rewrite of a normal paid sale. Existing financial history deletion does not remove team consumption records. Products configured to issue tickets also issue them atomically for team consumption; the statistics entry provides their ticket previews. Demo mode keeps team bookings and tickets inside its working copy.

**Settings → Cash drawer → Open drawer** is a disabled placeholder. No hardware command is sent and no payment is required to display the control. A physical opening action will be connected when the drawer interface is available.

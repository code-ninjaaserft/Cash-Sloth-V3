# Two-level navigation and animated overlay

Internal operation: **OP Faultir Chrysos**. Public product: **Cash Sloth V3**,
developed by **Faultir Softworks**.

## Application views

`ApplicationNavigation` switches between POS, Catalog, Import, Sales history,
Reconciliation, System status and Development tools. Development tools remain
subject to the existing host capability check. Settings is a disabled future
entry; no settings workflow is implemented.

The application menu starts closed. A compact hamburger and the official logo
share the top of the fixed category sidebar, following the two approved sketches.
`ApplicationNavigation` is an absolutely positioned sibling of the category layer,
not a replacement for it. Opening or closing the menu changes no grid columns,
content dimensions or normal-flow spacing.

Its opaque background transforms from the hamburger's container into a panel
over the categories in 260ms. Three CSS lines morph into an X. A matching clip
reveals unscaled entries only over the expanding background. Closing hides the
entries first and reverses the same background/icon transition. A ResizeObserver
measures the compact origin on size changes; frame animation uses transforms,
opacity and a clip mask rather than width/height layout animation. No animation
library or network access is involved.

The toggle exposes `aria-expanded` and `aria-controls`. Entries remain inert and
hidden from accessibility navigation until opening finishes; Escape closes the
menu and returns focus to its trigger. Selecting an application view closes the
menu as well. This is a non-modal navigation disclosure: the obscured category
layer is inert/ARIA-hidden during opening, open and closing states. The full
panel hit shield remains active until closing completes, preventing clicks
through the shrinking surface. Generation checks reject stale animation
completions after rapid reversals; a timer covers missing transition events.
Reduced-motion preference removes the animation and its entry delay.

## POS categories

`PosCategoryBrowser` loads the category list for `PosCategoryNavigation` in the
POS sidebar; `ProductBrowser` continues to load the filtered product results.
Categories stay mounted underneath the menu, retaining the same DOM node,
selection, expanded branches and scroll position when it opens and closes.
They are absent in other application views. Existing receipt and checkout flows
retain their own content.

- **All products** explicitly clears the category filter and restricted search.
- Each category name selects its subtree directly. A separate disclosure button
  expands or collapses child categories without selecting a different category.
- Native nested lists and buttons provide Tab, Enter and Space interaction,
  selected-category indication and named expansion controls. Accessible category
  names include the full path, distinguishing repeated names in different branches.
- Iterative traversal has no fixed depth limit. Only visual indentation is capped
  to preserve usable targets in deep trees.
- The existing validated catalog API includes descendants and deduplicates products.
  Presentation does not reproduce product-filtering business rules.

`PosApp` keeps the global disclosure flag separate from `ProductBrowserState`.
Category selection, expanded branches, query and the restricted-search option
survive tab changes and catalog refreshes within the running app. State is not
written to the financial database or persisted across application restarts.
After a successful category reload, unavailable categories/expansions are pruned;
a removed or inactive selection falls back to All products while retaining the
query. A failed category read does not discard the saved selection.

Search remains global by default, even with a category selected. The existing
**Restrict search to selected category** checkbox limits it to that subtree.
Cart mutations, historical price snapshots, settlement and refund behavior use
their unchanged application contracts.

## Responsive layout and future touch mode

The desktop register fills the viewport. The product grid, cart lines and
category list each scroll independently. Search, the selected category path
and filters sit above the grid. The cart header stays above its lines, with
the subtotal, payable total and actions below. Focus the product or cart region
and use the arrow or Page Down keys to browse it. Receipts and management views
retain their usual document scrolling.

At 900px wide and below, **Open cart** brings up the cart drawer. At 650px and
below the category sidebar moves above the products. Windows under 480px high,
and stacked layouts under 820px high, allow page scrolling so controls remain
reachable. The menu continues to overlay the category area at all sizes.

Input mode is separate from viewport width. `PosApp` accepts an explicit
`inputMode` presentation option, defaulting to `standard`. The prepared `touch`
variant increases navigation targets to at least 56px high. The category list
uses the available space below the branding in both input modes.
No user-facing touch-mode setting, device detection or new platform preference
storage is introduced by this correction.

## Regression checks

`tests/electron/pos-scroll.spec.ts` fills the catalog, category list and cart.
It checks each scroll position and the bounds of the surrounding controls
after wheel input, keyboard paging and a Chromium touch gesture. It also
checks cart actions, drawer focus and variant quantities across window sizes.

`tests/electron/navigation.spec.ts` exercises actual sandboxed Electron with a
temporary Development data root: nested selection/expansion, descendant
deduplication, search scope, cart preservation, tab restoration, original category
DOM/scroll preservation, keyboard focus, transition click shielding, rapid
reversal, reduced motion and 1280/800/390/320px viewports. Product, search, category
and cart rectangles are sampled during animation to catch layout movement.
The explicit touch
styles are tested separately from viewport selection. Pure presentation tests in
`pos-category-state.test.ts` include a 1,000-level forest and unavailable-state
reconciliation. The component controller in `application-navigation-state.test.ts`
covers transition generations, delayed keyboard availability, rapid reversals,
resize retargeting and CSS/reduced-motion timing. Existing Electron sale/refund/import tests remain regression
coverage for the preserved workflows.

### Initial two-level correction — 18 November 2026

`pnpm check` passed on Windows x64 using Node 24.22.3 and the pinned Electron
45.3.0 runtime:

- TypeScript strict checking, ESLint and architecture boundaries passed.
- All 687 Vitest unit/integration tests passed across 41 files, including eight
  new category-navigation state cases.
- All 12 Electron cases passed, including the two new navigation regressions
  and the existing sale, snapshot, payment, refund, import and recovery flows.
- The built standalone Node-host smoke test passed on Windows x64.
- Desktop/narrow screenshots were inspected and local documentation links checked.

Tests used temporary Development data roots. No dependencies, financial rules,
IPC contracts, database migrations or official branding assets were changed.
Touch presentation was exercised through the explicit presentation hook at both
wide and narrow widths; physical touchscreen interaction and a manual screen-reader
audit were not performed. New browser state is intentionally session-local.

The initial correction's check log is retained at the ignored
`test-results/navigation-check.log`.

### Animated overlay validation — 18 November 2026

The final `pnpm check` passed on Windows x64 with Node 24.22.3 and pinned
Electron 45.3.0: strict typecheck, lint/boundaries, all **698** unit/integration
tests across **42** files, build, all **12** Electron cases and the standalone
Node-host smoke test. The 11 new component-controller cases and both expanded
Electron navigation cases passed. The independent review's resize/closing race
was fixed and covered by a real mid-transition resize regression.

Desktop open/closed and narrow screenshots were visually inspected. Product,
search, category and cart rectangles stayed identical across sampled opening and
closing frames at 1280, 800, 390 and 320px. Category DOM identity, scroll position,
selection, expanded branches and search/cart state remained intact after toggling.
Keyboard, reduced-motion and explicit touch presentation were tested in Electron;
a physical touchscreen and manual screen-reader audit were not used.

Evidence is generated under ignored `test-results/`: `navigation-overlay-check.log`,
`electron-results.json`, `navigation-overlay-open.png`,
`navigation-overlay-closed.png` and `navigation-overlay-narrow.png`.
No new dependencies, financial rules, IPC contracts, database migrations or
official branding assets were introduced or changed. No Git commits or pushes
were made.

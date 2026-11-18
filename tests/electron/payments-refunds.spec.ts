import { navigateTo } from './navigation-helpers.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';

async function confirmDigital(page: Page, method: 'Card' | 'TWINT', amount: string): Promise<void> {
  await page.getByRole('button', { name: method, exact: true }).click();
  await page.getByRole('textbox', { name: 'Payment amount (CHF)', exact: true }).fill(amount);
  await page.getByRole('button', { name: 'Review payment', exact: true }).click();
  await page.getByRole('checkbox', { name: 'I confirm the external payment succeeded', exact: true }).check();
  await page.getByRole('button', { name: 'Confirm payment', exact: true }).click();
}

async function refund(page: Page, quantity: number, product: string, method: 'Cash' | 'Card' | 'TWINT', rejectCashFirst = false): Promise<void> {
  await page.getByRole('button', { name: 'Refund sale', exact: true }).click();
  await page.getByRole('spinbutton', { name: `Refund quantity for ${product} — Default`, exact: true }).fill(String(quantity));
  if (rejectCashFirst) {
    await page.getByRole('combobox', { name: 'Refund method', exact: true }).selectOption('cash');
    await page.getByRole('button', { name: 'Prepare refund', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('cannot be paid in CHF 0.05 coins');
  }
  await page.getByRole('combobox', { name: 'Refund method', exact: true }).selectOption({ label: method });
  await page.getByRole('button', { name: 'Prepare refund', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'I confirm the refund was paid', exact: true })).toBeEnabled();
  const outcomeSummary = page.getByText('Refund failed or uncertain?', { exact: true });
  await outcomeSummary.focus(); await outcomeSummary.press('Tab');
  await expect(page.getByRole('button', { name: 'Close Refund sale', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Close Refund sale', exact: true }).press('Shift+Tab');
  await expect(outcomeSummary).toBeFocused();
  await page.getByRole('checkbox', { name: 'I confirm the refund was paid', exact: true }).check();
  await page.getByRole('button', { name: 'Confirm refund', exact: true }).click();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Refund sale', exact: true })).toHaveCount(0);
}

function environment(directory: string): Record<string, string> {
  const variables: NodeJS.ProcessEnv = { ...process.env, CASH_SLOTH_CHANNEL: 'development', CASH_SLOTH_DATA_ROOT: directory };
  delete variables.ELECTRON_RUN_AS_NODE;
  return Object.fromEntries(Object.entries(variables).filter((entry): entry is [string, string] => entry[1] !== undefined));
}

test('Card and TWINT sales use explicit confirmations and support a full cash refund', async () => {
  test.setTimeout(120_000);
  const directory = await mkdtemp(join(tmpdir(), 'cash-sloth-digital-'));
  let application: ElectronApplication | undefined;
  try {
    application = await electron.launch({ args: [resolve('apps/desktop')], env: environment(directory) });
    const page = await application.firstWindow();
    for (const method of ['Card', 'TWINT'] as const) {
      await page.getByRole('button', { name: 'Add Coffee', exact: true }).click();
      await page.getByRole('button', { name: 'Checkout', exact: true }).click();
      await confirmDigital(page, method, '4.50');
      await page.getByRole('button', { name: 'Complete sale', exact: true }).click();
      const receipt = page.getByRole('region', { name: 'Sale receipt', exact: true });
      await expect(receipt).toBeVisible();
      await expect(receipt).toContainText(method);
      await expect(receipt).toContainText('CHF 4.50');
      if (method === 'Card') {
        await refund(page, 1, 'Coffee', 'Cash');
        await expect(receipt).toContainText('CHF 0.00');
        await expect(page.getByRole('button', { name: 'Refund sale', exact: true })).toBeDisabled();
      }
      await page.getByRole('button', { name: 'Start new sale', exact: true }).click();
    }
  } finally {
    try { await application?.close(); }
    finally { await rm(directory, { recursive: true, force: true, maxRetries: 5 }); }
  }
});

test('mixed allocations and successive partial refunds preserve the exact paid total after restart', async () => {
  test.setTimeout(150_000);
  const directory = await mkdtemp(join(tmpdir(), 'cash-sloth-mixed-refunds-'));
  let application: ElectronApplication | undefined;
  const launch = () => electron.launch({ args: [resolve('apps/desktop')], env: environment(directory) });
  try {
    application = await launch();
    let page = await application.firstWindow();
    const created = await page.evaluate(async () => window.cashSloth?.catalog.createProduct({
      name: 'Settlement sample', description: null, active: true, imageReference: null,
      categoryIds: [], primaryCategoryId: null,
      firstVariant: { name: 'Default', unitPriceRappen: 842, active: true, sku: null, barcode: null, position: 0 },
    }));
    if (!created?.ok) throw new Error('Could not create isolated financial fixture');
    // Reopen the browser so its catalog query includes the committed fixture.
    await navigateTo(page, 'Catalog');
    await navigateTo(page, 'POS');
    await page.getByRole('button', { name: 'Add Settlement sample', exact: true }).click();
    const quantity = page.getByRole('spinbutton', { name: 'Quantity for Settlement sample', exact: true });
    await quantity.fill('2'); await quantity.press('Tab');
    await expect(page.getByTestId('cart-subtotal')).toHaveText('CHF 16.84');
    await expect(page.getByTestId('cart-payable')).toHaveText('CHF 16.84');
    await page.getByRole('button', { name: 'Checkout', exact: true }).click();
    await confirmDigital(page, 'TWINT', '5.00');
    await confirmDigital(page, 'Card', '5.00');
    await expect(page.getByTestId('outstanding-balance')).toHaveText('CHF 6.84');
    await expect(page.getByTestId('cart-payable')).toHaveText('CHF 16.84');
    await page.getByRole('button', { name: 'Cash', exact: true }).click();
    await page.getByRole('dialog', { name: 'Checkout', exact: true }).evaluate((dialog) => { dialog.scrollTop = 0; });
    await page.screenshot({ path: 'test-results/mvp-0.3-checkout.png', fullPage: true, animations: 'disabled' });
    await page.getByRole('textbox', { name: 'Cash received (CHF)', exact: true }).fill('10.00');
    await expect(page.getByTestId('cash-change')).toHaveText('CHF 3.15');
    await page.getByRole('checkbox', { name: 'I confirm that the cash was received', exact: true }).check();
    await page.getByRole('button', { name: 'Complete sale', exact: true }).click();
    const receipt = page.getByRole('region', { name: 'Sale receipt', exact: true });
    await expect(receipt).toBeVisible();
    for (const amount of ['CHF 16.84', 'CHF 16.85', 'CHF 6.85', 'CHF 3.15']) await expect(receipt).toContainText(amount);
    const saleId = (await page.getByTestId('receipt-sale-id').textContent())?.trim();
    if (!saleId) throw new Error('Missing committed mixed sale identifier');
    await page.screenshot({ path: 'test-results/mvp-0.3-mixed-sale.png', fullPage: true, animations: 'disabled' });
    await refund(page, 1, 'Settlement sample', 'Card', true);
    await expect(receipt).toContainText('CHF 8.42');
    await expect(receipt).toContainText('CHF 8.43');
    await application.close(); application = undefined;
    application = await launch(); page = await application.firstWindow();
    await navigateTo(page, 'Sales history');
    await page.getByRole('button', { name: `Open sale ${saleId}`, exact: true }).click();
    await expect(page.getByTestId('receipt-sale-id')).toHaveText(saleId);
    await page.setViewportSize({ width: 800, height: 850 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await refund(page, 1, 'Settlement sample', 'TWINT');
    await expect(page.getByRole('button', { name: 'Refund sale', exact: true })).toBeDisabled();
    await page.screenshot({ path: 'test-results/mvp-0.3-refunds.png', fullPage: true, animations: 'disabled' });
    await application.close(); application = undefined;
    application = await launch(); page = await application.firstWindow();
    await navigateTo(page, 'Sales history');
    await page.getByRole('button', { name: `Open sale ${saleId}`, exact: true }).click();
    await expect(page.getByRole('region', { name: 'Sale receipt', exact: true })).toContainText('CHF 16.85');
    await expect(page.getByRole('button', { name: 'Refund sale', exact: true })).toBeDisabled();
  } finally {
    try { await application?.close(); }
    finally { await rm(directory, { recursive: true, force: true, maxRetries: 5 }); }
  }
});

test('uncertain checkout survives restart and requires investigated reconciliation before settlement', async () => {
  test.setTimeout(150_000);
  const directory = await mkdtemp(join(tmpdir(), 'cash-sloth-investigation-'));
  let application: ElectronApplication | undefined;
  const launch = () => electron.launch({ args: [resolve('apps/desktop')], env: environment(directory) });
  const reason = 'Operator checked the original Card receipt and confirmed the CHF 1.00 transfer.';
  try {
    application = await launch();
    let page = await application.firstWindow();
    await page.getByRole('button', { name: 'Add Coffee', exact: true }).click();
    await page.getByRole('button', { name: 'Checkout', exact: true }).click();
    await page.getByRole('button', { name: 'Card', exact: true }).click();
    await page.getByRole('textbox', { name: 'Payment amount (CHF)', exact: true }).fill('1.00');
    await page.getByRole('button', { name: 'Review payment', exact: true }).click();
    await page.getByText('Payment failed or result unknown?', { exact: true }).click();
    await page.getByRole('textbox', { name: 'Payment outcome reason', exact: true }).fill('The original terminal receipt needs investigation.');
    await page.getByRole('checkbox', { name: 'I verified the recorded outcome', exact: true }).check();
    await page.getByRole('button', { name: 'Report uncertain outcome', exact: true }).click();
    await expect(page.getByText('Payment outcome needs review', { exact: true })).toBeVisible();
    const before = await page.evaluate(async () => window.cashSloth?.payments.getActiveCheckout({}));
    if (!before?.ok || !before.value) throw new Error('Uncertain checkout must remain durable');
    const sessionId = before.value.session.id;
    expect(before.value.attempts.map((attempt) => attempt.status)).toEqual(['uncertain']);
    expect(before.value.balance.confirmedAppliedRappen).toBe(0);
    await application.close(); application = undefined;

    application = await launch(); page = await application.firstWindow();
    await expect(page.getByRole('dialog', { name: 'Recover checkout', exact: true })).toBeVisible();
    const after = await page.evaluate(async () => window.cashSloth?.payments.getActiveCheckout({}));
    if (!after?.ok || !after.value) throw new Error('Cannot inspect recovery state');
    expect(after.value.session.id).toBe(sessionId);
    expect(after.value.attempts.map((attempt) => attempt.status)).toEqual(['uncertain']);
    expect(after.value.balance.confirmedAppliedRappen).toBe(0);
    await page.getByRole('button', { name: 'Open reconciliation', exact: true }).click();
    await page.getByRole('button', { name: 'Confirm recorded transfer', exact: true }).click();
    const decision = page.getByRole('dialog', { name: 'Confirm reconciliation decision', exact: true });
    await decision.press('Escape');
    await expect(page.getByRole('button', { name: 'Confirm recorded transfer', exact: true })).toBeFocused();
    await page.getByRole('button', { name: 'Confirm recorded transfer', exact: true }).click();
    await page.getByRole('textbox', { name: 'Reconciliation reason', exact: true }).fill(reason);
    await page.getByRole('checkbox', { name: 'I deliberately confirm this investigated resolution', exact: true }).check();
    await page.getByRole('button', { name: 'Record reconciliation decision', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Immutable reconciliation audit', exact: true })).toContainText(reason);
    await navigateTo(page, 'POS');
    await page.getByRole('button', { name: 'Resume checkout', exact: true }).click();
    await page.getByRole('button', { name: 'Check stored result', exact: true }).click();
    await page.getByRole('button', { name: 'Cash', exact: true }).click();
    await page.getByRole('textbox', { name: 'Cash received (CHF)', exact: true }).fill('5.00');
    await expect(page.getByTestId('cash-change')).toHaveText('CHF 1.50');
    await page.getByRole('checkbox', { name: 'I confirm that the cash was received', exact: true }).check();
    await page.getByRole('button', { name: 'Complete sale', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Recorded sale payments', exact: true })).toContainText('Card');
    await expect(page.getByRole('region', { name: 'Recorded sale payments', exact: true })).toContainText('Cash');
    const sale = await page.evaluate(async (id) => window.cashSloth?.payments.getCheckout({ sessionId: id }), sessionId);
    if (!sale?.ok) throw new Error('Cannot inspect settled recovered checkout');
    expect(sale.value.attempts).toHaveLength(2);
    expect(sale.value.sale?.payments.map((allocation) => allocation.amountRappen)).toEqual([100, 350]);
    await page.getByRole('button', { name: 'Start new sale', exact: true }).click();
    await application.close(); application = undefined;
    application = await launch(); page = await application.firstWindow();
    await navigateTo(page, 'Reconciliation');
    await expect(page.getByRole('region', { name: 'Immutable reconciliation audit', exact: true })).toContainText(reason);
    await expect(page.getByText('No unresolved reconciliation cases.', { exact: true })).toBeVisible();
  } finally {
    try { await application?.close(); }
    finally { await rm(directory, { recursive: true, force: true, maxRetries: 5 }); }
  }
});

test('conflicting historical cash confirmations can be audited and released without erasing either record', async () => {
  test.setTimeout(120_000);
  const directory = await mkdtemp(join(tmpdir(), 'cash-sloth-legacy-reconcile-'));
  let application: ElectronApplication | undefined;
  const launch = () => electron.launch({ args: [resolve('apps/desktop')], env: environment(directory) });
  try {
    application = await launch();
    let page = await application.firstWindow();
    await expect(page.getByRole('button', { name: 'Add Chocolate', exact: true })).toBeEnabled();
    const keys = await page.evaluate(async () => {
      const pos = window.cashSloth?.pos;
      if (!pos) throw new Error('No local POS bridge');
      const draft = await pos.getCart({}); if (!draft.ok) throw new Error(draft.error.message);
      const firstCart = await pos.addItem({ cartId: draft.value.cart.id, expectedRevision: draft.value.cart.revision, variantId: 'variant-chocolate-default' });
      if (!firstCart.ok) throw new Error(firstCart.error.message);
      const first = await pos.prepareCheckout({ cartId: firstCart.value.id, expectedRevision: firstCart.value.revision });
      if (!first.ok) throw new Error(first.error.message);
      const nextCart = await pos.addItem({ cartId: firstCart.value.id, expectedRevision: firstCart.value.revision, variantId: 'variant-coffee-default' });
      if (!nextCart.ok) throw new Error(nextCart.error.message);
      const second = await pos.prepareCheckout({ cartId: nextCart.value.id, expectedRevision: nextCart.value.revision });
      if (!second.ok) throw new Error(second.error.message);
      const stale = await pos.completeSale({ idempotencyKey: first.value.idempotencyKey, cashReceivedRappen: 500, operatorConfirmed: true });
      const competing = await pos.completeSale({ idempotencyKey: second.value.idempotencyKey, cashReceivedRappen: 1000, operatorConfirmed: true });
      if (stale.ok || competing.ok) throw new Error('Conflicting historical confirmations must not create a sale');
      return [first.value.idempotencyKey, second.value.idempotencyKey];
    });
    await application.close(); application = undefined;
    application = await launch(); page = await application.firstWindow();
    await page.getByRole('button', { name: 'Open reconciliation', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Historical cash confirmation', exact: true })).toHaveCount(2);
    for (let index = 1; index <= 2; index++) {
      await page.getByRole('button', { name: 'Transfer compensated externally', exact: true }).first().click();
      await page.getByRole('textbox', { name: 'Reconciliation reason', exact: true }).fill(`Operator investigated and already returned the original cash for historical case ${index}.`);
      await page.getByRole('checkbox', { name: 'I deliberately confirm this investigated resolution', exact: true }).check();
      await page.getByRole('button', { name: 'Record reconciliation decision', exact: true }).click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await page.getByRole('button', { name: 'Reload cases and audit', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Historical cash confirmation', exact: true })).toHaveCount(2 - index);
      await expect(page.getByRole('dialog')).toHaveCount(0);
    }
    await expect(page.getByRole('region', { name: 'Immutable reconciliation audit', exact: true })).toContainText('historical case 1');
    await application.close(); application = undefined;
    application = await launch(); page = await application.firstWindow();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Add Chocolate', exact: true })).toBeEnabled();
    const checked = await page.evaluate(async (attemptKeys) => {
      const api = window.cashSloth; if (!api) throw new Error('No register API');
      return { cart: await api.pos.getCart({}), attempts: await Promise.all(attemptKeys.map((idempotencyKey) => api.pos.reconcileCheckout({ idempotencyKey }))), history: await api.payments.listReconciliationHistory({}) };
    }, keys);
    if (!checked.cart.ok || !checked.history.ok) throw new Error('Cannot inspect historical resolution');
    expect(checked.cart.value.pendingCheckout).toBeNull();
    expect(checked.cart.value.cart.subtotalRappen).toBe(697);
    for (const result of checked.attempts) {
      if (!result.ok) throw new Error(result.error.message);
      expect(result.value.attempt.status).toBe('confirmed');
      expect(result.value.sale).toBeNull();
    }
    expect(checked.history.value).toHaveLength(2);
  } finally {
    try { await application?.close(); }
    finally { await rm(directory, { recursive: true, force: true, maxRetries: 5 }); }
  }
});

test('failed audit lookup keeps a submitted legacy recovery reference locked and never confirms automatically', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'cash-sloth-recovery-read-fault-'));
  let application: ElectronApplication | undefined;
  try {
    application = await electron.launch({ args: [resolve('apps/desktop')], env: environment(directory) });
    const page = await application.firstWindow();
    await expect(page.getByRole('button', { name: 'Add Chocolate', exact: true })).toBeEnabled();
    const idempotencyKey = await page.evaluate(async () => {
      const pos = window.cashSloth?.pos; if (!pos) throw new Error('No POS bridge');
      const draft = await pos.getCart({}); if (!draft.ok) throw new Error(draft.error.message);
      const cart = await pos.addItem({ cartId: draft.value.cart.id, expectedRevision: draft.value.cart.revision, variantId: 'variant-chocolate-default' });
      if (!cart.ok) throw new Error(cart.error.message);
      const prepared = await pos.prepareCheckout({ cartId: cart.value.id, expectedRevision: cart.value.revision });
      if (!prepared.ok) throw new Error(prepared.error.message);
      // Represents a crash after UI submission intent but before its first
      // confirmation transaction committed. It is a reference, not a saved payment.
      window.localStorage.setItem('cash-sloth.pending-cash-confirmation.v1', JSON.stringify({ idempotencyKey: prepared.value.idempotencyKey, cashReceivedRappen: 500 }));
      return prepared.value.idempotencyKey;
    });
    // Fault injection belongs only to the privileged test harness, never IPC/UI.
    await application.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('payments:listReconciliationHistory');
      ipcMain.handle('payments:listReconciliationHistory', () => { throw new Error('Injected read failure'); });
    });
    await page.reload();
    await expect(page.getByRole('alert')).toContainText('pending checkout could not be reconciled');
    await expect(page.getByRole('button', { name: 'Add Coffee', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Checkout', exact: true })).toBeDisabled();
    const stored = await page.evaluate(async (key) => ({ reference: window.localStorage.getItem('cash-sloth.pending-cash-confirmation.v1'), state: await window.cashSloth?.pos.reconcileCheckout({ idempotencyKey: key }) }), idempotencyKey);
    expect(stored.reference).toContain(idempotencyKey);
    if (!stored.state?.ok) throw new Error('Cannot inspect original prepared state');
    expect(stored.state.value.attempt.status).toBe('prepared');
    expect(stored.state.value.attempt.cashReceivedRappen).toBeNull();
    expect(stored.state.value.sale).toBeNull();
  } finally {
    try { await application?.close(); }
    finally { await rm(directory, { recursive: true, force: true, maxRetries: 5 }); }
  }
});

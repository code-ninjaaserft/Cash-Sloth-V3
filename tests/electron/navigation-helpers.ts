import { expect, type Page } from '@playwright/test';

export async function openApplicationNavigation(page: Page): Promise<void> {
  const toggle = page.locator('.application-nav-toggle');
  if (await toggle.getAttribute('aria-expanded') !== 'true') {
    await expect(page.locator('.application-navigation')).toHaveAttribute('data-phase', 'closed');
    await toggle.click();
  }
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('navigation', { name: 'Application navigation', exact: true })).toHaveCSS('opacity', '1');
}

export async function navigateTo(page: Page, view: string): Promise<void> {
  await openApplicationNavigation(page);
  await page.getByRole('navigation', { name: 'Application navigation', exact: true }).getByRole('button', { name: view, exact: true }).click();
  await expect(page.locator('.application-navigation')).toHaveAttribute('data-phase', 'closed');
}

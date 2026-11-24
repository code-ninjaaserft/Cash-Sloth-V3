import type { CategorySummary, ManagedProduct } from '@cash-sloth/contracts';
/** A primary category wins; fallback order is stable across search and filtering. */
export function productCategory(product: Pick<ManagedProduct, 'categoryIds' | 'primaryCategoryId'>, categories: readonly CategorySummary[]): CategorySummary | null {
  const colored = categories.filter((category) => category.active && category.color && product.categoryIds.includes(category.id));
  return colored.find((category) => category.id === product.primaryCategoryId) ?? colored.sort((a, b) => a.id.localeCompare(b.id, 'en'))[0] ?? null;
}

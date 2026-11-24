import { t } from './preferences.js';
import { compareCatalogOrder, type CartItem } from '@cash-sloth/domain';

export interface CategoryNode { id: string; name: string; parentId: string | null; position: number }

/** Iterative traversal supports deep trees without recursive rendering or mutation. */
export function categoryRows<T extends CategoryNode>(categories: readonly T[]): { category: T; depth: number; path: string }[] {
  const known = new Set(categories.map((category) => category.id));
  const children = new Map<string | null, T[]>();
  for (const category of categories) {
    const parent = category.parentId !== null && known.has(category.parentId) ? category.parentId : null;
    const siblings = children.get(parent) ?? [];
    siblings.push(category); children.set(parent, siblings);
  }
  for (const siblings of children.values()) siblings.sort(compareCatalogOrder);
  const stack = (children.get(null) ?? []).toReversed().map((category) => ({ category, depth: 0, path: category.name }));
  const rows: { category: T; depth: number; path: string }[] = [];
  const visited = new Set<string>();
  while (stack.length) {
    const row = stack.pop();
    if (!row || visited.has(row.category.id)) continue;
    visited.add(row.category.id); rows.push(row);
    for (const category of (children.get(row.category.id) ?? []).toReversed()) stack.push({ category, depth: row.depth + 1, path: `${row.path} / ${category.name}` });
  }
  return rows;
}

export function variantLabel(name: string): string { return name === 'Default' ? t('Default') : name; }

export function cartLineLabel(item: Pick<CartItem, 'productName' | 'variantName'>): string {
  return item.variantName === 'Default' ? item.productName : `${item.productName} — ${item.variantName}`;
}

export function groupCartLines(items: readonly CartItem[]): { productId: string; name: string; items: CartItem[] }[] {
  const groups = new Map<string, { productId: string; name: string; items: CartItem[] }>();
  for (const item of items) {
    let group = groups.get(item.productId);
    if (!group) { group = { productId: item.productId, name: item.productName, items: [] }; groups.set(item.productId, group); }
    group.items.push(item);
  }
  return [...groups.values()];
}

export class CatalogRequestError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}
export function unwrapCatalog<T>(result: { ok: true; value: T } | { ok: false; error: { code: string; message: string } }): T {
  if (!result.ok) throw new CatalogRequestError(result.error.code, result.error.message);
  return result.value;
}
export function catalogError(error: unknown): string {
  if (error instanceof CatalogRequestError) return error.message;
  return 'The change could not be confirmed. Reload the saved details before retrying.';
}

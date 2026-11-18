import { categoryRows, type CategoryNode } from './catalog-ui.js';

export interface ProductBrowserState {
  query: string;
  categoryId: string | null;
  categoryPath: string | null;
  restricted: boolean;
  expandedCategoryIds: readonly string[];
}

export function initialProductBrowserState(): ProductBrowserState {
  return { query: '', categoryId: null, categoryPath: null, restricted: false, expandedCategoryIds: [] };
}

/** Only reconcile against a successfully loaded category list. */
export function reconcileProductBrowserState(state: ProductBrowserState, categories: readonly CategoryNode[]): ProductBrowserState {
  const paths = new Map(categoryRows(categories).map(({ category, path }) => [category.id, path]));
  const categoryPath = state.categoryId === null ? null : paths.get(state.categoryId) ?? null;
  const categoryId = categoryPath === null ? null : state.categoryId;
  const expandedCategoryIds = [...new Set(state.expandedCategoryIds)].filter((id) => paths.has(id));
  const restricted = categoryId !== null && state.restricted;
  if (categoryId === state.categoryId && categoryPath === state.categoryPath && restricted === state.restricted && expandedCategoryIds.length === state.expandedCategoryIds.length && expandedCategoryIds.every((id, index) => id === state.expandedCategoryIds[index])) return state;
  return { ...state, categoryId, categoryPath, restricted, expandedCategoryIds };
}

/** Native list/disclosure navigation; no recursion or fixed category-depth limit. */
export function visibleCategoryRows<T extends CategoryNode>(categories: readonly T[], expandedCategoryIds: readonly string[]): {
  category: T; depth: number; path: string; parentId: string | null; hasChildren: boolean; expanded: boolean;
}[] {
  const ordered = categoryRows(categories);
  const known = new Set(ordered.map(({ category }) => category.id));
  const parents = new Set(ordered.map(({ category }) => category.parentId).filter((id) => id !== null && known.has(id)));
  const expanded = new Set(expandedCategoryIds);
  const visibleAtDepth: boolean[] = [];
  const rows: ReturnType<typeof visibleCategoryRows<T>> = [];
  for (const row of ordered) {
    const visible = row.depth === 0 || visibleAtDepth[row.depth - 1] === true;
    visibleAtDepth[row.depth] = visible && expanded.has(row.category.id);
    visibleAtDepth.length = row.depth + 1;
    if (visible) rows.push({ ...row, parentId: row.category.parentId !== null && known.has(row.category.parentId) ? row.category.parentId : null, hasChildren: parents.has(row.category.id), expanded: expanded.has(row.category.id) });
  }
  return rows;
}

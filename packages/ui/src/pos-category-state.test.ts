import { describe, expect, it } from 'vitest';
import { initialProductBrowserState, reconcileProductBrowserState, visibleCategoryRows, type ProductBrowserState } from './pos-category-state.js';

const categories = [
  { id: 'drinks', name: 'Drinks', parentId: null, position: 1 },
  { id: 'tea', name: 'Tea', parentId: 'drinks', position: 0 },
  { id: 'herbal', name: 'Herbal', parentId: 'tea', position: 0 },
  { id: 'food', name: 'Food', parentId: null, position: 0 },
];

describe('POS category navigation state', () => {
  it('starts with All products and independent, empty expansion state', () => {
    expect(initialProductBrowserState()).toEqual({ query: '', categoryId: null, categoryPath: null, restricted: false, expandedCategoryIds: [] });
    expect(initialProductBrowserState()).not.toBe(initialProductBrowserState());
  });

  it('shows roots directly and reveals only children of expanded ancestors', () => {
    expect(visibleCategoryRows(categories, []).map((row) => row.category.id)).toEqual(['food', 'drinks']);
    expect(visibleCategoryRows(categories, ['tea']).map((row) => row.category.id)).toEqual(['food', 'drinks']);
    const rows = visibleCategoryRows(categories, ['drinks']);
    expect(rows.map((row) => row.category.id)).toEqual(['food', 'drinks', 'tea']);
    expect(rows.at(-1)).toMatchObject({ depth: 1, path: 'Drinks / Tea', parentId: 'drinks', hasChildren: true, expanded: false });
  });

  it('retains a nested expansion when its ancestor is collapsed and reopened', () => {
    expect(visibleCategoryRows(categories, ['drinks', 'tea']).at(-1)).toMatchObject({ path: 'Drinks / Tea / Herbal', hasChildren: false });
    expect(visibleCategoryRows(categories, ['tea']).map((row) => row.category.id)).toEqual(['food', 'drinks']);
    expect(visibleCategoryRows(categories, ['tea', 'drinks']).map((row) => row.category.id)).toEqual(['food', 'drinks', 'tea', 'herbal']);
  });

  it('handles deep category forests without recursion or a navigation depth limit', () => {
    const deep = Array.from({ length: 1000 }, (_, index) => ({ id: `level-${index}`, name: `Level ${index}`, parentId: index === 0 ? null : `level-${index - 1}`, position: 0 }));
    const rows = visibleCategoryRows(deep.toReversed(), deep.map((category) => category.id));
    expect(rows).toHaveLength(1000);
    expect(rows.at(-1)?.depth).toBe(999);
    expect(rows.at(-1)?.path).toMatch(/Level 998 \/ Level 999$/u);
    expect(new Set(rows.map((row) => row.category.id)).size).toBe(1000);
  });

  it('does not loop on malformed cyclic presentation input', () => {
    expect(visibleCategoryRows([{ id: 'a', name: 'A', parentId: 'b', position: 0 }, { id: 'b', name: 'B', parentId: 'a', position: 0 }], ['a', 'b'])).toEqual([]);
    expect(visibleCategoryRows([{ id: 'orphan', name: 'Orphan', parentId: 'missing', position: 0 }], [])).toMatchObject([{ parentId: null, depth: 0 }]);
  });

  it('preserves selected category, query and expansion identity when still available', () => {
    const saved: ProductBrowserState = { query: 'tea', categoryId: 'herbal', categoryPath: 'Drinks / Tea / Herbal', restricted: true, expandedCategoryIds: ['drinks', 'tea'] };
    expect(reconcileProductBrowserState(saved, categories)).toBe(saved);
  });

  it('updates the visible context when a selected subtree is renamed and moved', () => {
    const saved: ProductBrowserState = {
      query: 'mint', categoryId: 'herbal', categoryPath: 'Drinks / Tea / Herbal',
      restricted: true, expandedCategoryIds: [],
    };
    const moved = categories.map((category) => category.id === 'tea'
      ? { ...category, parentId: 'food', name: 'Infusions' }
      : category);
    expect(reconcileProductBrowserState(saved, moved)).toEqual({ ...saved, categoryPath: 'Food / Infusions / Herbal' });
  });

  it('falls back to All products after selected category removal, retaining search and valid expansions', () => {
    const saved: ProductBrowserState = { query: 'tea', categoryId: 'herbal', categoryPath: 'Drinks / Tea / Herbal', restricted: true, expandedCategoryIds: ['drinks', 'tea', 'herbal'] };
    expect(reconcileProductBrowserState(saved, categories.filter((category) => category.id !== 'herbal'))).toEqual({ query: 'tea', categoryId: null, categoryPath: null, restricted: false, expandedCategoryIds: ['drinks', 'tea'] });
    expect(saved.categoryId).toBe('herbal');
  });

  it('reconciles a cleared catalog and duplicate or unavailable expansions without mutating saved state', () => {
    const saved: ProductBrowserState = { query: '761', categoryId: 'tea', categoryPath: 'Drinks / Tea', restricted: true, expandedCategoryIds: ['drinks', 'drinks', 'unknown'] };
    expect(reconcileProductBrowserState(saved, categories)).toEqual({ ...saved, expandedCategoryIds: ['drinks'] });
    expect(reconcileProductBrowserState(saved, [])).toEqual({ query: '761', categoryId: null, categoryPath: null, restricted: false, expandedCategoryIds: [] });
    expect(saved.expandedCategoryIds).toEqual(['drinks', 'drinks', 'unknown']);
  });
});

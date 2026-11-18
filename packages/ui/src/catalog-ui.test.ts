import { describe, expect, it } from 'vitest';
import { cartLineLabel, categoryRows, groupCartLines } from './catalog-ui.js';
import type { CartItem } from '@cash-sloth/domain';

describe('catalog presentation helpers', () => {
  it('orders deep category rows without recursion and retains their full path', () => {
    const categories = Array.from({ length: 500 }, (_, index) => ({ id: `category-${index}`, parentId: index === 0 ? null : `category-${index - 1}`, name: `Level ${index}`, position: 0 }));
    const rows = categoryRows(categories.toReversed());
    expect(rows).toHaveLength(500);
    expect(rows.at(-1)?.depth).toBe(499);
    expect(rows.at(-1)?.path).toContain('Level 0 / Level 1');
  });
  it('uses stable ordering and avoids loops in malformed presentation data', () => {
    expect(categoryRows([{ id: 'b', name: 'B', parentId: null, position: 0 }, { id: 'a', name: 'A', parentId: null, position: 0 }]).map((row) => row.category.id)).toEqual(['a', 'b']);
    expect(categoryRows([{ id: 'a', name: 'A', parentId: 'b', position: 0 }, { id: 'b', name: 'B', parentId: 'a', position: 0 }])).toEqual([]);
  });
  it('groups a product without merging its financial snapshot lines', () => {
    const first: CartItem = { id: 'old', productId: 'product', variantId: 'variant', productName: 'Water', variantName: 'Small', unitPriceRappen: 300, quantity: 2, lineTotalRappen: 600 };
    const second = { ...first, id: 'new', unitPriceRappen: 350, quantity: 1, lineTotalRappen: 350 };
    const groups = groupCartLines([first, second]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.items).toEqual([first, second]);
    expect(first.unitPriceRappen).toBe(300);
    expect(cartLineLabel(first)).toBe('Water — Small');
    expect(cartLineLabel({ productName: 'Water', variantName: 'Default' })).toBe('Water');
  });
});

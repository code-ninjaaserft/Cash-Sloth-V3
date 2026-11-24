import { expect, it } from 'vitest';
import { productCategory } from './category-color.js';
import type { CategorySummary } from '@cash-sloth/contracts';
const a: CategorySummary = { id: 'a', name: 'A', color: '#ffff00', parentId: null, active: true, position: 0, revision: 0, productCount: 1, browseable: true };
const b: CategorySummary = { ...a, id: 'b', name: 'B', color: '#ff0000' };
it('prefers the assigned primary color and otherwise picks a stable assigned active color', () => {
  expect(productCategory({ categoryIds: ['a', 'b'], primaryCategoryId: 'b' }, [a, b])).toBe(b);
  expect(productCategory({ categoryIds: ['b', 'a'], primaryCategoryId: null }, [b, a])).toBe(a);
  expect(productCategory({ categoryIds: ['a'], primaryCategoryId: 'a' }, [{ ...a, active: false }, b])).toBeNull();
  expect(productCategory({ categoryIds: ['a'], primaryCategoryId: 'a' }, [{ ...a, color: null }])).toBeNull();
  expect(productCategory({ categoryIds: [], primaryCategoryId: null }, [a, b])).toBeNull();
});

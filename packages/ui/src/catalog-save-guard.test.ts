import { describe, expect, it, vi } from 'vitest';
import { CatalogRequestError } from './catalog-ui.js';
import { CatalogSaveGuard, catalogSaveNeedsReview, submitCatalogMutation } from './catalog-save-guard.js';
import type { CatalogApi } from '@cash-sloth/contracts';

describe('catalog save acknowledgement guard', () => {
  it.each(['COMMIT_UNCERTAIN', 'STORAGE_ERROR'])('requires review for %s without automatically repeating a mutation', async (code) => {
    const onChange = vi.fn();
    const guard = new CatalogSaveGuard(false, onChange);
    const create = vi.fn(async () => { throw new CatalogRequestError(code, 'Reply unavailable.'); });
    await expect(guard.mutate(create)).rejects.toThrow('Reply unavailable.');
    await expect(guard.mutate(create)).rejects.toThrow('Reload the full catalog');
    expect(create).toHaveBeenCalledTimes(1);
    expect(guard.reviewRequired).toBe(true);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('treats transport errors as uncertain even when no catalog error envelope arrived', async () => {
    const guard = new CatalogSaveGuard(false, vi.fn());
    const create = vi.fn(async () => { throw new Error('IPC reply lost after commit'); });
    await expect(guard.mutate(create)).rejects.toThrow('IPC reply lost');
    expect(guard.reviewRequired).toBe(true);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it.each(['INVALID_INPUT', 'CONFLICT', 'DUPLICATE_SKU', 'CATEGORY_CYCLE'])('keeps known %s errors correctable without a global review lock', async (code) => {
    const guard = new CatalogSaveGuard(false, vi.fn());
    const failure = new CatalogRequestError(code, 'Correct the input.');
    expect(catalogSaveNeedsReview(failure)).toBe(false);
    await expect(guard.mutate(async () => { throw failure; })).rejects.toThrow('Correct the input');
    await expect(guard.mutate(async () => 'saved')).resolves.toBe('saved');
    expect(guard.reviewRequired).toBe(false);
  });

  it('retains the block after either read fails and permits changes only after both reads succeed', async () => {
    const onChange = vi.fn();
    const guard = new CatalogSaveGuard(true, onChange);
    const mutate = vi.fn(async () => 'new record');
    await expect(guard.review(async () => ['saved product'], async () => { throw new Error('category read failed'); })).rejects.toThrow('category read failed');
    expect(guard.reviewRequired).toBe(true);
    await expect(guard.mutate(mutate)).rejects.toThrow('Reload the full catalog');
    expect(mutate).not.toHaveBeenCalled();
    await expect(guard.review(async () => ['saved product'], async () => ['saved category'])).resolves.toEqual({ products: ['saved product'], categories: ['saved category'] });
    await expect(guard.mutate(mutate)).resolves.toBe('new record');
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith(false);
  });

  it('does not submit a mutation merely because a read-only review succeeded', async () => {
    const guard = new CatalogSaveGuard(true, vi.fn());
    const create = vi.fn();
    await guard.review(async () => [], async () => []);
    expect(create).not.toHaveBeenCalled();
    expect(guard.reviewRequired).toBe(false);
  });

  it('rejects an invalid image reference locally without calling the bridge or locking correction', async () => {
    const updateProduct = vi.fn<CatalogApi['updateProduct']>();
    const guard = new CatalogSaveGuard(false, vi.fn());
    await expect(guard.mutate(async () => submitCatalogMutation({ updateProduct }, 'updateProduct', {
      productId: 'product-1', expectedRevision: 0, name: 'Tea', description: null, active: true,
      imageReference: 'https://unapproved.invalid/logo.png',
    }))).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(updateProduct).not.toHaveBeenCalled();
    expect(guard.reviewRequired).toBe(false);
    await expect(guard.mutate(async () => 'corrected')).resolves.toBe('corrected');
  });

  it('keeps valid requests subject to the uncertainty gate when their transport reply is lost', async () => {
    const createCategory = vi.fn<CatalogApi['createCategory']>().mockRejectedValue(new Error('IPC reply lost'));
    const guard = new CatalogSaveGuard(false, vi.fn());
    const request = { name: 'Drinks', parentId: null, active: true, position: 0 };
    await expect(guard.mutate(async () => submitCatalogMutation({ createCategory }, 'createCategory', request))).rejects.toThrow('IPC reply lost');
    await expect(guard.mutate(async () => submitCatalogMutation({ createCategory }, 'createCategory', request))).rejects.toMatchObject({ code: 'REVIEW_REQUIRED' });
    expect(createCategory).toHaveBeenCalledTimes(1);
    expect(guard.reviewRequired).toBe(true);
  });
});

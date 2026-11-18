import { CatalogRequestError } from './catalog-ui.js';
import { CATALOG_IPC_CONTRACTS, type CatalogApi, type CatalogRequest, type CatalogResponse } from '@cash-sloth/contracts';

type CatalogMutation = 'createProduct' | 'updateProduct' | 'createVariant' | 'updateVariant' | 'assignCategories' | 'createCategory' | 'updateCategory';

/** A definitely invalid local envelope is correctable, not an uncertain write. */
export function submitCatalogMutation<K extends CatalogMutation>(api: Pick<CatalogApi, K>, method: K, request: CatalogRequest<K>): Promise<CatalogResponse<K>> {
  const checked = CATALOG_IPC_CONTRACTS[method].request.safeParse(request);
  if (!checked.success) throw new CatalogRequestError('INVALID_INPUT', 'Check the catalog fields, including names, local image references, prices and display order. No change was submitted.');
  // The same literal method selects both its schema and its narrow bridge method.
  const invoke = api[method] as (input: CatalogRequest<K>) => Promise<CatalogResponse<K>>;
  return invoke(checked.data as CatalogRequest<K>);
}

export function catalogSaveNeedsReview(error: unknown): boolean {
  return !(error instanceof CatalogRequestError) || error.code === 'COMMIT_UNCERTAIN' || error.code === 'STORAGE_ERROR';
}

/** A missing acknowledgement must not become a fresh create request on retry. */
export class CatalogSaveGuard {
  constructor(private required: boolean, private readonly onChange: (required: boolean) => void) {}

  get reviewRequired(): boolean { return this.required; }

  async mutate<T>(operation: () => Promise<T>): Promise<T> {
    if (this.required) throw new CatalogRequestError('REVIEW_REQUIRED', 'Reload the full catalog and review the saved records before making another change.');
    try { return await operation(); }
    catch (error) {
      if (catalogSaveNeedsReview(error)) {
        this.required = true;
        this.onChange(true);
      }
      throw error;
    }
  }

  /** Both read-only snapshots must succeed before the mutation gate is reopened. */
  async review<TProducts, TCategories>(readProducts: () => Promise<TProducts>, readCategories: () => Promise<TCategories>): Promise<{ products: TProducts; categories: TCategories }> {
    const [products, categories] = await Promise.all([readProducts(), readCategories()]);
    this.required = false;
    this.onChange(false);
    return { products, categories };
  }
}

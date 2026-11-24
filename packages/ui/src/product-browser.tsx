import { productCategory } from './category-color.js';
import { t } from './preferences.js';
import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { CatalogApi, CategorySummary, ManagedProduct } from '@cash-sloth/contracts';
import { formatChf, type Cart } from '@cash-sloth/domain';
import { cartQuantities } from './cart-quantities.js';
import { ProductTile } from './product-tile.js';
import { Modal } from './modal.js';
import { catalogError, unwrapCatalog, variantLabel } from './catalog-ui.js';
import type { ProductBrowserState } from './pos-category-state.js';

export { initialProductBrowserState, type ProductBrowserState } from './pos-category-state.js';

export function ProductBrowser({ api, cart, disabled, state, onStateChange, onAdd }: {
  api: CatalogApi;
  cart: Cart | null;
  disabled: boolean;
  state: ProductBrowserState;
  onStateChange: (state: ProductBrowserState) => void;
  onAdd: (variantId: string, label: string) => void;
}): React.JSX.Element {
  const { query, categoryId, restricted } = state;
  const categoryContextId = useId();
  const [categories, setCategories] = useState<readonly CategorySummary[]>([]);
  const [products, setProducts] = useState<readonly ManagedProduct[]>([]);
  const [reading, setReading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selection, setSelection] = useState<ManagedProduct | null>(null);
  const quantities = useMemo(() => cartQuantities(cart?.items ?? []), [cart]);
  const sequence = useRef(0);

  useEffect(() => {
    const request = ++sequence.current;
    setReading(true);
    const timer = setTimeout(() => {
      void Promise.all([api.listProducts({ query, categoryId, restrictToCategory: restricted, includeInactive: false }), api.listCategories({ includeInactive: true })]).then(([result, categoryResult]) => {
        if (request !== sequence.current) return;
        setProducts(unwrapCatalog(result)); setCategories(unwrapCatalog(categoryResult)); setError(null);
      }).catch((failure: unknown) => {
        if (request === sequence.current) {
          setProducts([]);
          setError(catalogError(failure));
        }
      }).finally(() => { if (request === sequence.current) setReading(false); });
    }, query ? 140 : 0);
    return () => { clearTimeout(timer); sequence.current += 1; };
  }, [api, query, categoryId, restricted]);

  return <section className="product-browser" aria-label={t("Product browser")} aria-busy={reading}>
    <div className="product-browser-content">
    <div className="catalog-toolbar">
      <span className="category-context" id={categoryContextId} title={state.categoryPath ?? 'All products'}>{t("Selected category ·")}{' '}{state.categoryPath ?? 'All products'}</span>
      <label className="search-field">{t("Search products")}<input type="search" aria-describedby={categoryContextId} value={query} onChange={(event) => onStateChange({ ...state, query: event.target.value })} placeholder={t("Name, variant, SKU or barcode")} /></label>
    </div>
    <div className="search-options">
      <label className="inline-check"><input type="checkbox" checked={restricted} disabled={categoryId === null} onChange={(event) => onStateChange({ ...state, restricted: event.target.checked })} />{t("Restrict search to selected category")}</label>
      <span className="catalog-read-status" role="status">{reading ? t("Updating products…") : `${products.length} product${products.length === 1 ? '' : 's'}`}</span>
    </div>
    {query.trim() && categoryId !== null && !restricted && <p className="search-hint">{t("Searching every category. Select the option above to search only the chosen category and its descendants.")}</p>}
    <div className={`product-grid${reading ? ' is-reading' : ''}`} role="region" aria-label={t("Product catalog")} tabIndex={0}>
      {error && <p className="pos-error" role="alert">{error}</p>}
      {!reading && !error && products.length === 0 && <div className="pos-empty">{query.trim() ? t("No products match this search.") : t("No active products in this view.")}<br />{t("Create or activate products in Catalog.")}</div>}
      {products.map((product) => <ProductTile key={product.id} product={product} category={productCategory(product, categories)} quantities={quantities}
        disabled={disabled || reading} onChoose={setSelection} onAdd={onAdd} />)}
    </div>
    </div>
    {selection && <Modal title={t("Choose variant")} onClose={() => setSelection(null)}>
      <p className="dialog-description">{selection.name}</p>
      <div className="variant-options">{selection.variants.filter((variant) => variant.active).map((variant) => <button type="button" className="variant-option" key={variant.id} disabled={disabled} aria-label={`Add ${selection.name} — ${variant.name}`} onClick={() => { onAdd(variant.id, `${selection.name} — ${variant.name}`); setSelection(null); }}>
        <span><strong>{variantLabel(variant.name)}</strong>{variant.sku && <small>SKU {variant.sku}</small>}</span><strong>{formatChf(variant.unitPriceRappen)}</strong>
      </button>)}</div>
    </Modal>}
  </section>;
}

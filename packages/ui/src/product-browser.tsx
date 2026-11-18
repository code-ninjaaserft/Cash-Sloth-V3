import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { CatalogApi, ManagedProduct } from '@cash-sloth/contracts';
import { formatChf, type Cart } from '@cash-sloth/domain';
import { cartQuantities } from './cart-quantities.js';
import { ProductTile } from './product-tile.js';
import { Modal } from './modal.js';
import { catalogError, unwrapCatalog } from './catalog-ui.js';
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
      void api.listProducts({ query, categoryId, restrictToCategory: restricted, includeInactive: false }).then((result) => {
        if (request !== sequence.current) return;
        setProducts(unwrapCatalog(result)); setError(null);
      }).catch((failure: unknown) => {
        if (request === sequence.current) {
          setProducts([]);
          setError(catalogError(failure));
        }
      }).finally(() => { if (request === sequence.current) setReading(false); });
    }, query ? 140 : 0);
    return () => { clearTimeout(timer); sequence.current += 1; };
  }, [api, query, categoryId, restricted]);

  return <section className="product-browser" aria-label="Product browser" aria-busy={reading}>
    <div className="product-browser-content">
    <div className="catalog-toolbar">
      <span className="category-context" id={categoryContextId} title={state.categoryPath ?? 'All products'}>Selected category · {state.categoryPath ?? 'All products'}</span>
      <label className="search-field">Search products<input type="search" aria-describedby={categoryContextId} value={query} onChange={(event) => onStateChange({ ...state, query: event.target.value })} placeholder="Name, variant, SKU or barcode" /></label>
    </div>
    <div className="search-options">
      <label className="inline-check"><input type="checkbox" checked={restricted} disabled={categoryId === null} onChange={(event) => onStateChange({ ...state, restricted: event.target.checked })} />Restrict search to selected category</label>
      <span className="catalog-read-status" role="status">{reading ? 'Updating products…' : `${products.length} product${products.length === 1 ? '' : 's'}`}</span>
    </div>
    {query.trim() && categoryId !== null && !restricted && <p className="search-hint">Searching every category. Select the option above to search only the chosen category and its descendants.</p>}
    <div className={`product-grid${reading ? ' is-reading' : ''}`} role="region" aria-label="Product catalog" tabIndex={0}>
      {error && <p className="pos-error" role="alert">{error}</p>}
      {!reading && !error && products.length === 0 && <div className="pos-empty">{query.trim() ? 'No products match this search.' : 'No active products in this view.'}<br />Create or activate products in Catalog.</div>}
      {products.map((product) => <ProductTile key={product.id} product={product} quantities={quantities}
        disabled={disabled || reading} onChoose={setSelection} onAdd={onAdd} />)}
    </div>
    </div>
    {selection && <Modal title="Choose variant" onClose={() => setSelection(null)}>
      <p className="dialog-description">{selection.name}</p>
      <div className="variant-options">{selection.variants.filter((variant) => variant.active).map((variant) => <button type="button" className="variant-option" key={variant.id} disabled={disabled} aria-label={`Add ${selection.name} — ${variant.name}`} onClick={() => { onAdd(variant.id, `${selection.name} — ${variant.name}`); setSelection(null); }}>
        <span><strong>{variant.name}</strong>{variant.sku && <small>SKU {variant.sku}</small>}</span><strong>{formatChf(variant.unitPriceRappen)}</strong>
      </button>)}</div>
    </Modal>}
  </section>;
}

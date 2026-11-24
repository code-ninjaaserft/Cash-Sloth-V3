import { t, localeTag } from './preferences.js';
import React, { useCallback, useEffect, useState } from 'react';
import type { CatalogApi, CatalogRequest, CategorySummary, ManagedProduct, ManagedVariant } from '@cash-sloth/contracts';
import { formatChf, parseChfInput } from '@cash-sloth/domain';
import { catalogError, categoryRows, unwrapCatalog } from './catalog-ui.js';
import { Modal } from './modal.js';
import { CatalogSaveGuard, submitCatalogMutation } from './catalog-save-guard.js';

type ProductFields = Pick<CatalogRequest<'updateProduct'>, 'name' | 'description' | 'active' | 'imageReference' | 'ticketUses'>;
type VariantFields = Omit<CatalogRequest<'createVariant'>, 'productId' | 'expectedProductRevision'>;
type CategoryFields = CatalogRequest<'createCategory'>;
const nullable = (value: string): string | null => value.trim() || null;
const cashInput = (value: number): string => formatChf(value).replace(/^CHF\s+/u, '');

function VariantFieldsForm({ initial, disabled, onSave, onCancel, first = false }: {
  initial?: ManagedVariant;
  disabled: boolean;
  onSave: (fields: VariantFields) => Promise<void>;
  onCancel: () => void;
  first?: boolean;
}): React.JSX.Element {
  const [name, setName] = useState(initial?.name ?? 'Default');
  const [price, setPrice] = useState(initial ? cashInput(initial.unitPriceRappen) : '');
  const [sku, setSku] = useState(initial?.sku ?? '');
  const [barcode, setBarcode] = useState(initial?.barcode ?? '');
  const [active, setActive] = useState(initial?.active ?? true);
  const [position, setPosition] = useState(String(initial?.position ?? 0));
  const [error, setError] = useState<string | null>(null);
  return <form className="editor-form" onSubmit={(event) => {
    event.preventDefault(); setError(null);
    try {
      const fields = { name: name.trim(), unitPriceRappen: parseChfInput(price), sku: nullable(sku), barcode: nullable(barcode), active, position: Number(position) };
      void onSave(fields).catch((failure: unknown) => setError(catalogError(failure)));
    } catch (failure) { setError(failure instanceof Error ? failure.message : t("Enter a valid price.")); }
  }}>
    {error && <p className="pos-error" role="alert">{error}</p>}
    <label>{first ? t("First variant name") : t("Variant name")}<input required maxLength={200} value={name} disabled={disabled} onChange={(event) => setName(event.target.value)} /></label>
    <div className="form-columns"><label>{t("Price (CHF)")}<input required type="text" inputMode="decimal" placeholder="0.00" value={price} disabled={disabled} onChange={(event) => setPrice(event.target.value)} /></label><label>{t("Variant order")}<input type="number" min={0} max={1_000_000} step={1} value={position} disabled={disabled} onChange={(event) => setPosition(event.target.value)} /></label></div>
    <div className="form-columns"><label>SKU<input maxLength={100} value={sku} disabled={disabled} onChange={(event) => setSku(event.target.value)} /></label><label>{t("Barcode")}<input maxLength={100} value={barcode} disabled={disabled} onChange={(event) => setBarcode(event.target.value)} /></label></div>
    <label className="inline-check"><input type="checkbox" checked={active} disabled={disabled} onChange={(event) => setActive(event.target.checked)} />{t("Variant active")}</label>
    <div className="form-actions"><button type="submit" className="primary-button" disabled={disabled}>{t("Save variant")}</button><button type="button" className="subtle-button" disabled={disabled} onClick={onCancel}>{t("Cancel variant")}</button></div>
  </form>;
}

function ProductForm({ product, categories, disabled, onSave, onCancel }: {
  product: ManagedProduct | null;
  disabled: boolean;
  categories: readonly CategorySummary[];
  onSave: (fields: ProductFields, variants: readonly VariantFields[], categoryId: string) => Promise<void>;
  onCancel: () => void;
}): React.JSX.Element {
  const [name, setName] = useState(product?.name ?? '');
  const [description, setDescription] = useState(product?.description ?? '');
  const [imageReference, setImageReference] = useState(product?.imageReference ?? '');
  const [active, setActive] = useState(product?.active ?? true);
  const [ticketEnabled, setTicketEnabled] = useState((product?.ticketUses ?? 0) > 0);
  const [unlimited,setUnlimited]=useState(product?.ticketUses===2147483647);
  const [ticketUses, setTicketUses] = useState(String(product?.ticketUses===2147483647?1:product?.ticketUses||1));
  const [categoryId, setCategoryId] = useState('');
  const [drafts, setDrafts] = useState([{ key: 0, name: 'Default', price: '', sku: '', barcode: '' }]);
  const nextKey = React.useRef(1);
  const changeDraft = (key: number, field: 'name' | 'price' | 'sku' | 'barcode', value: string): void => setDrafts((items) => items.map((item) => item.key === key ? { ...item, [field]: value } : item));
  const [error, setError] = useState<string | null>(null);
  return <form className="editor-form" onSubmit={(event) => {
    event.preventDefault(); setError(null);
    try {
      if (product === null && !categoryId) throw new Error(t('Choose a category before creating a product.'));
      const variants = product === null ? drafts.map((item, position) => ({ name: item.name.trim(), unitPriceRappen: parseChfInput(item.price), sku: nullable(item.sku), barcode: nullable(item.barcode), active: true, position })) : [];
      void onSave({ name: name.trim(), description: nullable(description), active, imageReference: nullable(imageReference), ticketUses: ticketEnabled ? unlimited ? 2147483647 : Number(ticketUses) : 0 }, variants, categoryId).catch((failure: unknown) => setError(catalogError(failure)));
    } catch (failure) { setError(failure instanceof Error ? failure.message : t("Enter valid product details.")); }
  }}>
    {error && <p className="pos-error" role="alert">{error}</p>}
    <label>{t("Product name")}<input required maxLength={200} value={name} disabled={disabled} onChange={(event) => setName(event.target.value)} /></label>
    <label>{t("Description")}<textarea maxLength={4000} rows={3} value={description} disabled={disabled} onChange={(event) => setDescription(event.target.value)} /></label>
    <label>{t("Image reference")}<input aria-label={t("Image reference")} maxLength={500} value={imageReference} disabled={disabled} placeholder={t("Optional local asset reference")} onChange={(event) => setImageReference(event.target.value)} /><small>{t("Stored for future image support. Images are not loaded.")}</small></label>
    <label className="inline-check"><input type="checkbox" checked={active} disabled={disabled} onChange={(event) => setActive(event.target.checked)} />{t("Product active")}</label>
    <label className="inline-check"><input type="checkbox" checked={ticketEnabled} disabled={disabled} onChange={(event) => setTicketEnabled(event.target.checked)} />{t('Generate a ticket for each unit sold')}</label>
    {ticketEnabled && <label className="inline-check"><input type="checkbox" checked={unlimited} disabled={disabled} onChange={event=>setUnlimited(event.target.checked)} />{t("Unlimited redemptions")}</label>}
    {ticketEnabled && !unlimited && <label>{t('Allowed redemptions per ticket')}<input aria-label={t('Allowed redemptions per ticket')} required type="number" min={1} max={1000} step={1} value={ticketUses} disabled={disabled} onChange={(event) => setTicketUses(event.target.value)} /><small>{t('Each unit gets its own barcode after the sale is completed.')}</small></label>}
    {product === null && <>
      <label>{t('Category')}<select required aria-label={t('Product category')} value={categoryId} disabled={disabled} onChange={(event) => setCategoryId(event.target.value)}><option value="">{t('Choose a category')}</option>{categoryRows(categories).filter(({ category }) => category.active).map(({ category, path }) => <option key={category.id} value={category.id}>{path}</option>)}</select></label>
      {!categories.some((item) => item.active) && <p role="status">{t('Create an active category first, then add a product.')}</p>}
      {drafts.map((item, index) => <fieldset key={item.key} className="draft-variant"><legend>{t('Variant')} {index + 1}</legend>
        <label>{index === 0 ? t('First variant name') : t('Variant name')}<input required maxLength={200} value={item.name} disabled={disabled} onChange={(event) => changeDraft(item.key, 'name', event.target.value)} /></label>
        <label>{t('Price (CHF)')}<input required inputMode="decimal" value={item.price} disabled={disabled} placeholder="0.00" onChange={(event) => changeDraft(item.key, 'price', event.target.value)} /></label>
        <div className="form-columns"><label>SKU<input maxLength={100} value={item.sku} disabled={disabled} onChange={(event) => changeDraft(item.key, 'sku', event.target.value)} /></label><label>{t('Barcode')}<input maxLength={100} value={item.barcode} disabled={disabled} onChange={(event) => changeDraft(item.key, 'barcode', event.target.value)} /></label></div>
        {drafts.length > 1 && <button type="button" className="subtle-button" disabled={disabled} onClick={() => setDrafts((items) => items.filter((draft) => draft.key !== item.key))}>{t('Remove draft variant')}</button>}
      </fieldset>)}
      <button type="button" className="subtle-button" disabled={disabled || drafts.length >= 100} onClick={() => setDrafts((items) => [...items, { key: nextKey.current++, name: '', price: '', sku: '', barcode: '' }])}>{t('Add another variant')}</button>
    </>}
    <div className="form-actions"><button type="submit" className="primary-button" disabled={disabled || (product === null && !categoryId)}>{t("Save product")}</button><button type="button" className="subtle-button" disabled={disabled} onClick={onCancel}>{t("Cancel product")}</button></div>
  </form>;
}

function CategoryForm({ category, categories, disabled, onSave, onCancel }: {
  category: CategorySummary | null;
  categories: readonly CategorySummary[];
  disabled: boolean;
  onSave: (fields: CategoryFields) => Promise<void>;
  onCancel: () => void;
}): React.JSX.Element {
  const [name, setName] = useState(category?.name ?? '');
  const [parentId, setParentId] = useState(category?.parentId ?? '');
  const [color, setColor] = useState(category?.color ?? '#00a050');
  const [colored, setColored] = useState(category?.color != null);
  const [position, setPosition] = useState(String(category?.position ?? 0));
  const [active, setActive] = useState(category?.active ?? true);
  const [error, setError] = useState<string | null>(null);
  return <form className="editor-form" onSubmit={(event) => {
    event.preventDefault(); setError(null);
    void onSave({ color: colored ? color : null, name: name.trim(), parentId: parentId || null, position: Number(position), active }).catch((failure: unknown) => setError(catalogError(failure)));
  }}>
    {error && <p className="pos-error" role="alert">{error}</p>}
    <label>{t("Category name")}<input required maxLength={200} value={name} disabled={disabled} onChange={(event) => setName(event.target.value)} /></label>
    <label>{t("Parent category")}<select aria-label={t("Parent category")} value={parentId} disabled={disabled} onChange={(event) => setParentId(event.target.value)}><option value="">{t("Top level")}</option>{categoryRows(categories).filter((row) => row.category.id !== category?.id).map(({ category: item, path }) => <option key={item.id} value={item.id}>{path}{item.active ? '' : ' (inactive)'}</option>)}</select></label>
    <label className="inline-check"><input type="checkbox" checked={colored} disabled={disabled} onChange={(event) => setColored(event.target.checked)} />{t("Use category color")}</label>
    {colored && <label>{t("Category color")}<input type="color" value={color} disabled={disabled} onChange={(event) => setColor(event.target.value)} /></label>}
    <label>{t("Category order")}<input type="number" min={0} max={1_000_000} step={1} value={position} disabled={disabled} onChange={(event) => setPosition(event.target.value)} /></label>
    <label className="inline-check"><input type="checkbox" checked={active} disabled={disabled} onChange={(event) => setActive(event.target.checked)} />{t("Category active")}</label>
    <p className="form-hint">{t("Deactivating a category hides its branch from checkout browsing. Products and saved sales remain intact.")}</p>
    <div className="form-actions"><button type="submit" className="primary-button" disabled={disabled}>{t("Save category")}</button><button type="button" className="subtle-button" disabled={disabled} onClick={onCancel}>{t("Cancel category")}</button></div>
  </form>;
}

function AssignmentForm({ product, categories, disabled, onSave }: { product: ManagedProduct; categories: readonly CategorySummary[]; disabled: boolean; onSave: (categoryIds: readonly string[], primaryCategoryId: string | null) => Promise<void> }): React.JSX.Element {
  const [selected, setSelected] = useState<readonly string[]>(product.categoryIds);
  const [primary, setPrimary] = useState(product.primaryCategoryId ?? '');
  const [error, setError] = useState<string | null>(null);
  return <form className="editor-form category-assignment" onSubmit={(event) => { event.preventDefault(); setError(null); void onSave(selected, primary || null).catch((failure: unknown) => setError(catalogError(failure))); }}>
    <h3>{t("Category assignments")}</h3>
    {error && <p className="pos-error" role="alert">{error}</p>}
    <div className="category-checkboxes">{categoryRows(categories).map(({ category, path }) => <label className="inline-check" key={category.id}><input type="checkbox" aria-label={`Assign ${path}`} disabled={disabled} checked={selected.includes(category.id)} onChange={(event) => {
      setSelected(event.target.checked ? [...selected, category.id] : selected.filter((id) => id !== category.id));
      if (!event.target.checked && primary === category.id) setPrimary('');
    }} />{path}{category.active ? '' : ' (inactive)'}</label>)}</div>
    {categories.length === 0 && <p className="form-hint">{t("Create categories below to organize this product.")}</p>}
    <label>{t("Primary category")}<select aria-label={t("Primary category")} value={primary} disabled={disabled} onChange={(event) => setPrimary(event.target.value)}><option value="">{t("No primary category")}</option>{categoryRows(categories).filter((row) => selected.includes(row.category.id)).map(({ category, path }) => <option key={category.id} value={category.id}>{path}</option>)}</select></label>
    <button type="submit" className="subtle-button" disabled={disabled}>{t("Save categories")}</button>
  </form>;
}

export function CatalogEditor({ api, onSaved, reviewRequired, onReviewRequiredChange }: {
  api: CatalogApi;
  onSaved?: () => void;
  reviewRequired: boolean;
  onReviewRequiredChange: (required: boolean) => void;
}): React.JSX.Element {
  const [deleteTarget, setDeleteTarget] = useState<{ kind: 'product' | 'category' | 'variant'; id: string; name: string; revision: number } | null>(null);
  const [products, setProducts] = useState<readonly ManagedProduct[]>([]);
  const [categories, setCategories] = useState<readonly CategorySummary[]>([]);
  const [query, setQuery] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [includeInactive, setIncludeInactive] = useState(true);
  const [selected, setSelected] = useState<ManagedProduct | null>(null);
  const [creating, setCreating] = useState(false);
  const [variant, setVariant] = useState<ManagedVariant | null | undefined>(undefined);
  const [category, setCategory] = useState<CategorySummary | null | undefined>(undefined);
  const [reading, setReading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [saveGuard] = useState(() => new CatalogSaveGuard(reviewRequired, onReviewRequiredChange));
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [formVersion, setFormVersion] = useState(0);
  const [variantReloadVersion, setVariantReloadVersion] = useState(0);
  const [categoryReloadVersion, setCategoryReloadVersion] = useState(0);
  const sequence = React.useRef(0);
  const selectionSequence = React.useRef(0);
  const categoryPaths = React.useMemo(() => new Map(categoryRows(categories).map((row) => [row.category.id, row.path])), [categories]);
  const refreshCategories = useCallback(async (): Promise<void> => { setCategories(unwrapCatalog(await api.listCategories({ includeInactive: true }))); }, [api]);
  useEffect(() => { void refreshCategories().catch((failure: unknown) => setError(catalogError(failure))); }, [refreshCategories]);
  useEffect(() => {
    const request = ++sequence.current; setReading(true);
    const timer = setTimeout(() => { void api.listProducts({ query, categoryId: filterCategory || null, restrictToCategory: true, includeInactive }).then((result) => { if (request === sequence.current) setProducts(unwrapCatalog(result)); }).catch((failure: unknown) => { if (request === sequence.current) setError(catalogError(failure)); }).finally(() => { if (request === sequence.current) setReading(false); }); }, query ? 140 : 0);
    return () => { clearTimeout(timer); sequence.current += 1; };
  }, [api, query, filterCategory, includeInactive, refreshVersion]);
  const save = async (operation: () => Promise<void>): Promise<void> => {
    if (saving) return;
    setSaving(true); setError(null); setNotice(null);
    try {
      await saveGuard.mutate(operation); setNotice('Changes saved on this device.'); onSaved?.();
      setRefreshVersion((value) => value + 1);
      void refreshCategories().catch((failure: unknown) => setError(`Saved, but category refresh failed. ${catalogError(failure)}`));
    }
    catch (failure) {
      setError(catalogError(failure));
      if (saveGuard.reviewRequired) {
        setRefreshVersion((value) => value + 1);
        void refreshCategories().catch((readFailure: unknown) => setError(`The save remains uncertain and categories could not be refreshed. ${catalogError(readFailure)}`));
      }
      throw failure;
    }
    finally { setSaving(false); }
  };
  const reviewCatalog = async (): Promise<void> => {
    if (saving || reviewing) return;
    setReviewing(true);
    try {
      const saved = await saveGuard.review(
        async () => unwrapCatalog(await api.listProducts({ query: '', categoryId: null, restrictToCategory: false, includeInactive: true })),
        async () => unwrapCatalog(await api.listCategories({ includeInactive: true })),
      );
      sequence.current += 1; selectionSequence.current += 1;
      setProducts(saved.products); setCategories(saved.categories); setQuery(''); setFilterCategory(''); setIncludeInactive(true);
      setSelected(null); setCreating(false); setVariant(undefined); setCategory(undefined);
      setFormVersion((value) => value + 1); setError(null); setNotice('Saved catalog reloaded. Review the records before making another change.');
    } catch (failure) {
      setError(`The catalog could not be fully reloaded. Changes remain blocked. ${catalogError(failure)}`);
    } finally { setReviewing(false); }
  };
  const mutationsDisabled = saving || reviewRequired;
  const reviewNotice = (): React.JSX.Element | null => reviewRequired ? <div className="recovery-notice" role="alert">{t("The last save could not be confirmed. It may already exist in the catalog. Do not repeat the create request before reviewing the saved records.")}<button type="button" className="subtle-button" disabled={saving || reviewing} onClick={() => { void reviewCatalog(); }}>{reviewing ? t("Reloading catalog…") : t("Reload catalog and review")}</button>
  </div> : null;
  const openProduct = (productId: string): void => {
    const request = ++selectionSequence.current;
    void api.getProduct({ productId }).then((result) => {
      if (request !== selectionSequence.current) return;
      setSelected(unwrapCatalog(result)); setCreating(false); setError(null); setNotice(null); setFormVersion((value) => value + 1);
    }).catch((failure: unknown) => { if (request === selectionSequence.current) setError(catalogError(failure)); });
  };
  return <main className="catalog-editor">
    <header className="pos-heading"><div><span className="pos-label">{t("Product management")}</span><h1>{t("Catalog")}</h1><p>{t("Manage products, their variants and category relationships.")}</p></div><button type="button" className="subtle-button" disabled={mutationsDisabled} onClick={() => { selectionSequence.current += 1; setSelected(null); setCreating(true); setError(null); }}>{t("New product")}</button></header>
    {error && <div className="pos-error" role="alert">{error}{selected && <button type="button" className="subtle-button" disabled={saving} onClick={() => openProduct(selected.id)}>{t("Reload saved product")}</button>}</div>}
    {variant === undefined && category === undefined && reviewNotice()}
    <p className="catalog-save-status" role="status">{saving ? t("Saving changes…") : notice ?? ''}</p>
    <div className="catalog-editor-grid">
      <section className="editor-list" aria-label={t("Managed products")}>
        <label className="search-field">{t("Search catalog")}<input type="search" value={query} placeholder={t("Product, variant, SKU or barcode")} onChange={(event) => setQuery(event.target.value)} /></label>
        <label>{t("Filter category")}<select aria-label={t("Filter category")} value={filterCategory} onChange={(event) => setFilterCategory(event.target.value)}><option value="">{t("All categories")}</option>{categoryRows(categories).map(({ category: item, path }) => <option key={item.id} value={item.id}>{path}</option>)}</select></label>
        <label className="inline-check"><input type="checkbox" checked={includeInactive} onChange={(event) => setIncludeInactive(event.target.checked)} />{t("Include inactive products")}</label>
        <p className="catalog-read-status" role="status">{reading ? t("Updating catalog…") : `${products.length} products`}</p>
        <div className="editor-product-list">{products.map((product) => <button type="button" key={product.id} aria-label={`Edit product ${product.name}`} aria-pressed={selected?.id === product.id} className="editor-product-row" disabled={saving} onClick={() => openProduct(product.id)}><span className="editor-product-title"><strong>{product.name}</strong><span className={`management-badge ${product.active ? '' : 'warning'}`}>{product.active ? t("Active") : t("Inactive")}</span></span><small>{product.variants.length}{' '}{t("variant")}{product.variants.length === 1 ? '' : 's'} · {product.variants.filter((item) => item.active).length}{' '}{t("active")}</small>{product.categoryIds.length > 0 && <small className="editor-category-path">{product.categoryIds.map((id) => categoryPaths.get(id) ?? id).join(' · ')}</small>}</button>)}</div>
        {!reading && products.length === 0 && <div className="pos-empty">{t("No products in this view.")}</div>}
      </section>
      <section className="editor-details" aria-label={t("Product editor")}>
        {creating || selected ? <>
          <div className="editor-product-title"><h2>{creating ? t("Create product") : selected?.name}</h2>{selected && <span className={`management-badge ${selected.active ? '' : 'warning'}`}>{selected.active ? t("Active product") : t("Inactive product")}</span>}</div>
          <ProductForm key={selected ? `${selected.id}:${selected.revision}:${formVersion}` : 'new-product'} product={selected} categories={categories} disabled={mutationsDisabled} onCancel={() => { selectionSequence.current += 1; setCreating(false); setSelected(null); }} onSave={(fields, variants, categoryId) => save(async () => {
            if (selected === null && (!variants[0] || !categoryId)) throw new Error(t('Choose a category before creating a product.'));
            const saved = selected === null
              ? unwrapCatalog(await submitCatalogMutation(api, 'createProduct', { ...fields, categoryIds: [categoryId], primaryCategoryId: categoryId, firstVariant: variants[0] as VariantFields, additionalVariants: variants.slice(1) }))
              : unwrapCatalog(await submitCatalogMutation(api, 'updateProduct', { ...fields, productId: selected.id, expectedRevision: selected.revision }));
            setSelected(saved); setCreating(false);
          })} />
          {selected && <>
            <button type="button" className="subtle-button delete-catalog" disabled={mutationsDisabled} onClick={() => setDeleteTarget({ kind: 'product', id: selected.id, name: selected.name, revision: selected.revision })}>{t('Delete product')}</button>
            <div className="section-heading"><h3>{t("Variants")}</h3><button type="button" className="subtle-button" disabled={mutationsDisabled} onClick={() => setVariant(null)}>{t("Add variant")}</button></div>
            <div className="managed-variants">{selected.variants.map((item) => <div className="managed-variant" key={item.id}><span><strong>{item.name} <span className={`management-badge ${item.active ? '' : 'warning'}`}>{item.active ? t("Active") : t("Inactive")}</span></strong><small>{item.sku ? `SKU ${item.sku} · ` : ''}{item.barcode ? `Barcode ${item.barcode} · ` : ''}{t("Order")}{' '}{item.position}</small></span><strong>{formatChf(item.unitPriceRappen)}</strong><button type="button" className="subtle-button" aria-label={`Edit variant ${item.name}`} disabled={mutationsDisabled} onClick={() => setVariant(item)}>{t("Edit")}</button><button type="button" className="subtle-button" aria-label={'Delete variant ' + item.name} disabled={mutationsDisabled || selected.variants.length === 1} title={selected.variants.length === 1 ? t('Keep at least one variant, or delete the product.') : undefined} onClick={() => setDeleteTarget({ kind: 'variant', id: item.id, name: item.name, revision: item.revision })}>{t('Delete variant')}</button></div>)}</div>
            <AssignmentForm key={`categories:${selected.id}:${selected.revision}:${formVersion}`} product={selected} categories={categories} disabled={mutationsDisabled} onSave={(categoryIds, primaryCategoryId) => save(async () => { setSelected(unwrapCatalog(await submitCatalogMutation(api, 'assignCategories', { productId: selected.id, expectedRevision: selected.revision, categoryIds, primaryCategoryId }))); })} />
            <p className="form-hint">ID {selected.id}<br />{t("Created")}{' '}{new Date(selected.createdAt).toLocaleString(localeTag())}{' '}{t("· Modified")}{' '}{new Date(selected.updatedAt).toLocaleString(localeTag())}{' '}{t("· Revision")}{' '}{selected.revision}</p>
          </>}
        </> : <div className="pos-empty">{t("Choose a product to edit, or create one with its first priced variant.")}</div>}
      </section>
    </div>
    <section className="category-management" aria-label={t("Category management")}>
      <div className="section-heading"><div><h2>{t("Categories")}</h2><p className="form-hint">{t("Move categories by changing their parent and display order. Delete removes the category and its subcategories; products remain available.")}</p></div><button type="button" className="subtle-button" disabled={mutationsDisabled} onClick={() => setCategory(null)}>{t("New category")}</button></div>
      <div className="category-list">{categoryRows(categories).map(({ category: item, path }) => <button type="button" className="category-row" key={item.id} aria-label={`Edit category ${path}`} disabled={saving} onClick={() => setCategory(item)}><span>{path}</span><small>{item.active ? t("Active") : t("Inactive")} · {item.productCount}{' '}{t("products · Order")}{' '}{item.position}</small></button>)}</div>
      {categories.length === 0 && <p className="form-hint">{t("No categories yet. Create a top-level category, then add children.")}</p>}
    </section>
    {variant !== undefined && selected && <Modal title={variant === null ? t("Add variant") : t("Edit variant")} onClose={() => { if (!saving) setVariant(undefined); }}>
      {reviewNotice()}
      <VariantFieldsForm key={variant ? `${variant.id}:${variant.revision}:${variantReloadVersion}` : 'new'} {...(variant ? { initial: variant } : {})} disabled={mutationsDisabled} onCancel={() => setVariant(undefined)} onSave={(fields) => save(async () => {
        const saved = variant === null ? unwrapCatalog(await submitCatalogMutation(api, 'createVariant', { productId: selected.id, expectedProductRevision: selected.revision, ...fields })) : unwrapCatalog(await submitCatalogMutation(api, 'updateVariant', { productId: selected.id, variantId: variant.id, expectedProductRevision: selected.revision, expectedRevision: variant.revision, ...fields }));
        setSelected(saved); setVariant(undefined);
      })} />
      {variant && <button type="button" className="subtle-button reload-editor" disabled={saving} onClick={() => { void api.getProduct({ productId: selected.id }).then((result) => {
        const saved = unwrapCatalog(result); setSelected(saved); setVariant(saved.variants.find((item) => item.id === variant.id)); setVariantReloadVersion((value) => value + 1); setError(null);
      }).catch((failure: unknown) => setError(catalogError(failure))); }}>{t("Reload saved variant")}</button>}
    </Modal>}
    {category !== undefined && <Modal title={category === null ? t("New category") : t("Edit category")} onClose={() => { if (!saving) setCategory(undefined); }}>
      {reviewNotice()}
      <div className="category-editor-dialog"><CategoryForm key={category ? `${category.id}:${category.revision}:${categoryReloadVersion}` : 'new'} category={category} categories={categories} disabled={mutationsDisabled} onCancel={() => setCategory(undefined)} onSave={(fields) => save(async () => {
        if (category === null) unwrapCatalog(await submitCatalogMutation(api, 'createCategory', fields));
        else unwrapCatalog(await submitCatalogMutation(api, 'updateCategory', { categoryId: category.id, expectedRevision: category.revision, ...fields }));
        setCategory(undefined);
      })} />
      {category && <button type="button" className="subtle-button delete-catalog" disabled={mutationsDisabled} onClick={() => setDeleteTarget({ kind: 'category', id: category.id, name: category.name, revision: category.revision })}>{t('Delete category')}</button>}
      {category && <button type="button" className="subtle-button reload-editor" disabled={saving} onClick={() => { void api.listCategories({ includeInactive: true }).then((result) => {
        const saved = unwrapCatalog(result); setCategories(saved); setCategory(saved.find((item) => item.id === category.id)); setCategoryReloadVersion((value) => value + 1); setError(null);
      }).catch((failure: unknown) => setError(catalogError(failure))); }}>{t("Reload saved category")}</button>}</div>
    </Modal>}
    {deleteTarget && <Modal title={t(deleteTarget.kind === 'product' ? 'Delete product?' : deleteTarget.kind === 'variant' ? 'Delete variant?' : 'Delete category?')} closeDisabled={saving} onClose={() => { if (!saving) setDeleteTarget(null); }}>
      <p><strong>{deleteTarget.name}</strong></p><p>{t(deleteTarget.kind === 'product' ? 'Remove this product from the current catalog? Saved presets and completed sales are retained.' : deleteTarget.kind === 'variant' ? 'Remove this variant from the current catalog? Completed sales are retained.' : 'Delete this category and its subcategories? Products remain under All products. Completed sales are retained.')}</p><p>{t('Save changes to the active preset afterwards to keep this catalog change.')}</p>
      <div className="form-actions"><button type="button" disabled={mutationsDisabled} onClick={() => { void save(async () => {
        if (deleteTarget.kind === 'variant' && selected) {
          setSelected(unwrapCatalog(await submitCatalogMutation(api, 'removeVariant', { productId: selected.id, variantId: deleteTarget.id, expectedProductRevision: selected.revision, expectedRevision: deleteTarget.revision })));
          setDeleteTarget(null); setVariant(undefined); return;
        }
        if (deleteTarget.kind === 'product') unwrapCatalog(await submitCatalogMutation(api, 'removeProduct', { productId: deleteTarget.id, expectedRevision: deleteTarget.revision }));
        else unwrapCatalog(await submitCatalogMutation(api, 'removeCategory', { categoryId: deleteTarget.id, expectedRevision: deleteTarget.revision }));
        setSelected(null); setCreating(false); setCategory(undefined); setVariant(undefined); setFilterCategory(''); setDeleteTarget(null);
      }).catch(() => { setDeleteTarget(null); }); }}>{t('Confirm delete')}</button><button type="button" className="subtle-button" disabled={saving} onClick={() => setDeleteTarget(null)}>{t('Cancel')}</button></div>
    </Modal>}
  </main>;
}

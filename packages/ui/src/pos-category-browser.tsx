import { t } from './preferences.js';
import React, { useEffect, useRef, useState } from 'react';
import type { CatalogApi, CategorySummary } from '@cash-sloth/contracts';
import { catalogError, unwrapCatalog } from './catalog-ui.js';
import { PosCategoryNavigation } from './pos-category-navigation.js';
import { reconcileProductBrowserState, type ProductBrowserState } from './pos-category-state.js';

/** Category data and disclosure state stay mounted underneath the global overlay. */
export function PosCategoryBrowser({ api, state, onStateChange }: {
  api: CatalogApi;
  state: ProductBrowserState;
  onStateChange: (state: ProductBrowserState) => void;
}): React.JSX.Element {
  const [categories, setCategories] = useState<readonly CategorySummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const latestState = useRef(state);
  latestState.current = state;

  useEffect(() => {
    let current = true;
    void api.listCategories({ includeInactive: false }).then((result) => {
      if (!current) return;
      const saved = unwrapCatalog(result).filter((category) => category.browseable);
      setCategories(saved); setError(null);
      const next = reconcileProductBrowserState(latestState.current, saved);
      if (next !== latestState.current) onStateChange(next);
    }).catch((failure: unknown) => { if (current) setError(catalogError(failure)); });
    return () => { current = false; };
  }, [api, onStateChange]);

  return <>
    <PosCategoryNavigation categories={categories} categoryId={state.categoryId} expandedCategoryIds={state.expandedCategoryIds}
      onSelect={(categoryId, categoryPath) => onStateChange({ ...state, categoryId, categoryPath, restricted: categoryId !== null && state.restricted })}
      onExpandedChange={(expandedCategoryIds) => onStateChange({ ...state, expandedCategoryIds })} />
    {error && <p className="pos-error" role="alert">{t("Categories could not be loaded.")}{' '}{error}</p>}
  </>;
}

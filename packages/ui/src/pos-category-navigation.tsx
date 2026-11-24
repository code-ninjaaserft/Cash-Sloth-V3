import { t } from './preferences.js';
import React, { useId } from 'react';
import type { CategorySummary } from '@cash-sloth/contracts';
import { visibleCategoryRows } from './pos-category-state.js';

export function PosCategoryNavigation({ categories, categoryId, expandedCategoryIds, onSelect, onExpandedChange }: {
  categories: readonly CategorySummary[];
  categoryId: string | null;
  expandedCategoryIds: readonly string[];
  onSelect: (categoryId: string | null, categoryPath: string | null) => void;
  onExpandedChange: (categoryIds: readonly string[]) => void;
}): React.JSX.Element {
  const prefix = useId();
  const descendants = new Map<string | null, React.JSX.Element[]>();
  const rows = visibleCategoryRows(categories, expandedCategoryIds);
  for (const { category, depth, path, parentId, hasChildren, expanded } of rows.toReversed()) {
    const listId = `${prefix}-${category.id}`;
    const entry = <li key={category.id}>
      <div className="pos-category-row" data-category-color={category.color || undefined} style={{ '--category-color': category.color ?? undefined, paddingInlineStart: `${Math.min(depth, 4) * 8}px` } as React.CSSProperties}>
        <button type="button" className="pos-category-select" aria-label={path} aria-current={categoryId === category.id ? 'true' : undefined} title={path} onClick={() => onSelect(category.id, path)}>
          <span>{category.name}</span><span className="pos-category-count" aria-hidden="true">{category.productCount}</span>
        </button>
        {hasChildren && <button type="button" className="pos-category-toggle" aria-label={`${expanded ? t("Collapse") : t("Expand")} ${path}`} aria-expanded={expanded} aria-controls={listId} onClick={() => onExpandedChange(expanded ? expandedCategoryIds.filter((id) => id !== category.id) : [...expandedCategoryIds, category.id])}>
          <span aria-hidden="true">{expanded ? '−' : '+'}</span>
        </button>}
      </div>
      {hasChildren && <ul className="pos-category-list" id={listId} hidden={!expanded}>{descendants.get(category.id)}</ul>}
    </li>;
    const siblings = descendants.get(parentId) ?? [];
    siblings.unshift(entry); descendants.set(parentId, siblings);
  }
  return <nav className="pos-category-navigation" aria-label={t("POS categories")}>
    <h2 className="pos-category-heading">{t("Categories")}</h2>
    <button type="button" className="pos-category-select" aria-current={categoryId === null ? 'true' : undefined} onClick={() => onSelect(null, null)}>{t("All products")}</button>
    <ul className="pos-category-list">{descendants.get(null)}</ul>
  </nav>;
}

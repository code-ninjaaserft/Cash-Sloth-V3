import { variantLabel } from './catalog-ui.js';
import { t } from './preferences.js';
import React, { useId } from 'react';
import type { CategorySummary, ManagedProduct } from '@cash-sloth/contracts';
import { formatChf } from '@cash-sloth/domain';
import type { CartQuantities } from './cart-quantities.js';

function QuantityBadge({ quantity, description, id }: {
  quantity: number;
  description: string;
  id: string;
}): React.JSX.Element | null {
  if (quantity === 0) return null;
  return <>
    <span className="cart-quantity-badge" aria-hidden="true">{quantity}</span>
    <span id={id} hidden>{quantity} {description}</span>
  </>;
}

export function ProductTile({ product, category = null, quantities, disabled, onChoose, onAdd }: {
  product: ManagedProduct;
  category?: CategorySummary | null;
  quantities: CartQuantities;
  disabled: boolean;
  onChoose: (product: ManagedProduct) => void;
  onAdd: (variantId: string, label: string) => void;
}): React.JSX.Element {
  const descriptionId = useId();
  const variants = product.variants.filter((variant) => variant.active);
  const onlyVariant = variants.length === 1 ? variants[0] : undefined;
  const unitPrice = Math.min(...variants.map((variant) => variant.unitPriceRappen));
  const productQuantity = quantities.byProduct.get(product.id) ?? 0;
  const unavailable = disabled || !product.active || variants.length === 0;
  const quickVariants = variants.length > 1
    ? variants.filter((variant) => quantities.byVariant.has(variant.id))
    : [];

  return <div className="product-tile-group" data-category-color={category?.color || undefined} style={category?.color ? { '--category-color': category.color } as React.CSSProperties : undefined}>
    <button
      type="button"
      className="product-card"
      aria-label={`${onlyVariant ? t("Add") : t("Choose")} ${product.name}`}
      aria-describedby={productQuantity > 0 ? descriptionId : undefined}
      aria-disabled={unavailable}
      onClick={() => {
        if (unavailable) return;
        if (onlyVariant) onAdd(onlyVariant.id, product.name);
        else onChoose(product);
      }}
    >
      <span className="product-tile-top">
        <span className="product-symbol" aria-hidden="true">+</span>
        <QuantityBadge id={descriptionId} quantity={productQuantity} description="in cart across all variants" />
      </span>
      <strong>{product.name}{onlyVariant && onlyVariant.name !== 'Default' ? ` — ${onlyVariant.name}` : ''}</strong>
      {category && <span className="product-category-label">{category.name}</span>}
      {(!onlyVariant || onlyVariant.name === 'Default') && <small>{onlyVariant ? variantLabel(onlyVariant.name) : `${variants.length} ${t('variants')}`}</small>}
      <span className="product-price">{variants.length > 1 ? t('from') + ' ' : ''}{Number.isFinite(unitPrice) ? formatChf(unitPrice) : t("Unavailable")}</span>
    </button>
    {quickVariants.length > 0 && <div className="quick-variants" role="group" aria-label={`Quick add variants of ${product.name}`}>
      <span className="quick-variants-label" aria-hidden="true">{t("Quick add")}</span>
      <div className="quick-variant-list">
        {quickVariants.map((variant) => {
          const label = `${product.name} — ${variant.name}`;
          const id = `${descriptionId}-${variant.id}`;
          return <button
            key={variant.id}
            type="button"
            className="quick-variant-tile"
            aria-label={`Quick add ${label}`}
            aria-describedby={id}
            aria-disabled={unavailable}
            onClick={() => { if (!unavailable) onAdd(variant.id, label); }}
          >
            <span className="quick-variant-details"><strong>{variantLabel(variant.name)}</strong><small>{formatChf(variant.unitPriceRappen)}</small></span>
            <QuantityBadge id={id} quantity={quantities.byVariant.get(variant.id) ?? 0} description="in cart for this variant" />
          </button>;
        })}
      </div>
    </div>}
  </div>;
}

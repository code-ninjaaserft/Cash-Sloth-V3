import type { ImportSourceProduct } from '@cash-sloth/domain';

export const SWISS_DEMO_VERSION = 'swiss-development-v1';
export const SWISS_DEMO_CATEGORY_PATHS: readonly (readonly string[])[] = [
  ['Drinks'], ['Drinks', 'Water'], ['Drinks', 'Soft Drinks'], ['Drinks', 'Hot Drinks'],
  ['Food'], ['Food', 'Snacks'], ['Food', 'Bakery'], ['Food', 'Bakery', 'Sweet'], ['Food', 'Bakery', 'Sweet', 'Alpine'], ['Food', 'Hot Meals'],
  ['Desserts'], ['Desserts', 'Ice Cream'], ['Merchandise'], ['Merchandise', 'Faultir Products'],
  ['Test Cases'], ['Test Cases', 'Rounding'], ['Test Cases', 'Availability'], ['Test Cases', 'Split & Refund'],
];
type VariantInput = readonly [name: string, price: number];
function product(key: string, name: string, category: string, variants: readonly VariantInput[], options: { active?: boolean; inactiveVariant?: number; extraCategory?: string } = {}): ImportSourceProduct {
  return { key, name, description: 'Fictional Swiss Development demo product. Not a real retailer listing.', active: options.active ?? true,
    paths: [category.split(' > '), ...(options.extraCategory ? [options.extraCategory.split(' > ')] : [])],
    variants: variants.map(([variantName, unitPriceRappen], index) => ({ key: `${key}-${index + 1}`, name: variantName, unitPriceRappen,
      sku: index % 2 === 0 ? `DEMO-${key.toUpperCase()}-${index + 1}` : null,
      barcode: index % 3 === 0 ? `TEST-CSV3-${key}-${index + 1}` : null,
      active: options.inactiveVariant !== index, position: index })),
  };
}

/** Stable fictional fixtures. No startup path loads this manifest automatically. */
export const SWISS_DEMO_PRODUCTS: readonly ImportSourceProduct[] = [
  product('mineral-water', 'Mineral Water', 'Drinks > Water', [['33 cl', 250], ['50 cl', 350], ['1.5 l', 500]]),
  product('sparkling-water', 'Sparkling Water', 'Drinks > Water', [['50 cl', 350], ['1 l', 500]]),
  product('tap-water', 'Fresh Tap Water', 'Drinks > Water', [['Glass', 100]]),
  product('cola', 'Cola', 'Drinks > Soft Drinks', [['33 cl', 300], ['50 cl', 400]]),
  product('iced-tea', 'Iced Tea', 'Drinks > Soft Drinks', [['Lemon', 300], ['Peach', 300]]),
  product('apple-schorle', 'Apple Schorle', 'Drinks > Soft Drinks', [['33 cl', 300], ['50 cl', 400]]),
  product('orange-soda', 'Orange Soda', 'Drinks > Soft Drinks', [['33 cl', 300]]),
  product('lemonade', 'Alpine Lemonade', 'Drinks > Soft Drinks', [['50 cl', 390]]),
  product('energy-drink', 'Fictional Energy Drink', 'Drinks > Soft Drinks', [['25 cl', 450]]),
  product('espresso', 'Espresso', 'Drinks > Hot Drinks', [['Single', 350], ['Double', 450]]),
  product('roast-coffee', 'Swiss Roast Coffee', 'Drinks > Hot Drinks', [['Regular', 420], ['Large', 490]]),
  product('tea', 'Alpine Tea', 'Drinks > Hot Drinks', [['Peppermint', 350], ['Black', 350], ['Fruit', 350]]),
  product('hot-chocolate', 'Hot Chocolate', 'Drinks > Hot Drinks', [['Regular', 450], ['Large', 550]]),
  product('crisps', 'Potato Crisps', 'Food > Snacks', [['Paprika', 280], ['Salt', 280], ['Herbs', 280]]),
  product('pretzel', 'Salt Pretzel', 'Food > Snacks', [['Default', 250]]),
  product('almonds', 'Roasted Almonds', 'Food > Snacks', [['100 g', 550]]),
  product('popcorn', 'Popcorn', 'Food > Snacks', [['Small', 350], ['Large', 500]]),
  product('sandwich', 'Fresh Sandwich', 'Food > Snacks', [['Cheese', 650], ['Ham', 690]]),
  product('butter-croissant', 'Butter Croissant', 'Food > Bakery', [['Default', 220]]),
  product('chocolate-croissant', 'Chocolate Croissant', 'Food > Bakery > Sweet', [['Default', 280]]),
  product('bread-roll', 'Bread Roll', 'Food > Bakery', [['Plain', 150], ['Seeds', 180]]),
  product('nut-pastry', 'Nut Pastry', 'Food > Bakery > Sweet', [['Default', 320]]),
  product('fruit-tart', 'Seasonal Fruit Tart', 'Food > Bakery > Sweet', [['Slice', 450]]),
  product('alpine-cake', 'Alpine Cake', 'Food > Bakery > Sweet > Alpine', [['Walnut', 490], ['Honey', 490]], { extraCategory: 'Desserts' }),
  product('hotdog', 'Hotdog', 'Food > Hot Meals', [['Classic', 550], ['Spicy', 650]]),
  product('vegetarian-hotdog', 'Hotdog Vegetarian', 'Food > Hot Meals', [['Default', 600]]),
  product('raclette', 'Raclette Plate', 'Food > Hot Meals', [['Regular', 950], ['Large', 1250]]),
  product('burger', 'Alpine Burger', 'Food > Hot Meals', [['Classic', 1050], ['Cheese', 1150]]),
  product('vegetarian-burger', 'Vegetarian Burger', 'Food > Hot Meals', [['Default', 1090]]),
  product('soup', 'Daily Soup', 'Food > Hot Meals', [['Cup', 450], ['Bowl', 650]]),
  product('ice-cream', 'Ice Cream', 'Desserts > Ice Cream', [['Vanilla', 350], ['Chocolate', 350], ['Strawberry', 350]]),
  product('sorbet', 'Fruit Sorbet', 'Desserts > Ice Cream', [['Lemon', 350], ['Mango', 390]]),
  product('brownie', 'Chocolate Brownie', 'Desserts', [['Default', 390]], { extraCategory: 'Food > Bakery > Sweet' }),
  product('fruit-cup', 'Fresh Fruit Cup', 'Desserts', [['Default', 450]]),
  product('faultir-mug', 'Faultir Mug', 'Merchandise > Faultir Products', [['Default', 1290]]),
  product('soren-plush', 'Sören Plush', 'Merchandise > Faultir Products', [['Small', 1490], ['Large', 2490]]),
  product('tote', 'Faultir Tote Bag', 'Merchandise > Faultir Products', [['Default', 990]]),
  product('stickers', 'Faultir Sticker', 'Merchandise > Faultir Products', [['Green', 200], ['Gold', 200]]),
  product('cap', 'Faultir Cap', 'Merchandise > Faultir Products', [['Default', 1990]]),
  product('round-242', '[TEST] Rounding CHF 2.42', 'Test Cases > Rounding', [['Default', 242]], { extraCategory: 'Test Cases > Split & Refund' }),
  product('round-347', '[TEST] Rounding CHF 3.47', 'Test Cases > Rounding', [['Default', 347]], { extraCategory: 'Test Cases > Split & Refund' }),
  product('round-899', '[TEST] Rounding CHF 8.99', 'Test Cases > Rounding', [['Default', 899]], { extraCategory: 'Test Cases > Split & Refund' }),
  product('inactive-product', '[TEST] Inactive Seasonal Product', 'Test Cases > Availability', [['Default', 500]], { active: false }),
  product('variant-availability', '[TEST] Variant Availability', 'Test Cases > Availability', [['Available', 600], ['Inactive', 700]], { inactiveVariant: 1 }),
];
export const SWISS_DEMO_COUNTS = { products: SWISS_DEMO_PRODUCTS.length, variants: SWISS_DEMO_PRODUCTS.reduce((count, entry) => count + entry.variants.length, 0), activeVariants: SWISS_DEMO_PRODUCTS.reduce((count, entry) => count + (entry.active ? entry.variants.filter((variant) => variant.active).length : 0), 0), categories: SWISS_DEMO_CATEGORY_PATHS.length, version: SWISS_DEMO_VERSION } as const;

import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {_electron as electron,expect,test} from '@playwright/test';
import {navigateTo} from './navigation-helpers.js';

test('product vouchers and manual free-product discounts respect the selected variant',async()=>{
 test.setTimeout(120000);
 const directory=await mkdtemp(join(tmpdir(),'sloth-product-voucher-ui-'));
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
 const app=await electron.launch({args:[resolve('apps/desktop')],env:{...env,CASH_SLOTH_CHANNEL:'development',CASH_SLOTH_DATA_ROOT:directory}});
 try{
  const page=await app.firstWindow();
  await expect(page.getByRole('button',{name:'Add Chocolate',exact:true})).toBeVisible();
  const largeId=await page.evaluate(async()=>{
   const api=window.cashSloth!;
   const product=await api.catalog.getProduct({productId:'product-chocolate'});if(!product.ok)throw new Error(product.error.message);
   const created=await api.catalog.createVariant({productId:product.value.id,expectedProductRevision:product.value.revision,name:'Large',unitPriceRappen:500,sku:null,barcode:null,active:true,position:1});if(!created.ok)throw new Error(created.error.message);
   const variant=created.value.variants.find(v=>v.name==='Large')!;
   const initial=await api.pos.getCart({});if(!initial.ok)throw new Error(initial.error.message);let cart=initial.value.cart;
   for(const variantId of ['variant-chocolate-default','variant-chocolate-default',variant.id,variant.id]){const added=await api.pos.addItem({cartId:cart.id,expectedRevision:cart.revision,variantId});if(!added.ok)throw new Error(added.error.message);cart=added.value;}
   return variant.id;
  });
  await page.reload();
  await expect(page.getByTestId('cart-subtotal')).toHaveText('CHF 14.94');
  await navigateTo(page,'Vouchers & discounts');
  await page.getByLabel('Name',{exact:true}).fill('One large chocolate');
  await page.getByLabel('Art',{exact:true}).selectOption('freeProduct');
  await page.getByLabel('Produkt / Geltungsbereich',{exact:true}).selectOption('product-chocolate');
  await page.getByLabel('Variante',{exact:true}).selectOption(largeId);
  await page.getByRole('button',{name:'Als Rabattvorlage speichern',exact:true}).click();
  const template=page.locator('.promotion-row').filter({hasText:'One large chocolate'});
  await expect(template).toContainText('Chocolate — Large');
  await template.getByRole('button',{name:'Bearbeiten',exact:true}).click();
  await expect(page.getByLabel('Variante',{exact:true})).toHaveValue(largeId);
  await page.getByRole('button',{name:'Gutschein ausstellen',exact:true}).click();
  await expect(page.locator('.ticket-paper')).toContainText('Product voucher');
  await expect(page.locator('.ticket-paper')).toContainText('Chocolate — Large');
  const code=await page.locator('.ticket-paper code').innerText();
  await page.screenshot({path:'test-results/product-voucher-variant.png',fullPage:true});
  await navigateTo(page,'POS');
  await expect(page.getByTestId('cart-subtotal')).toHaveText('CHF 14.94');
  await page.getByRole('button',{name:'Rabatt / Rabattgutschein',exact:true}).click();
  let dialog=page.getByRole('dialog',{name:'Rabatt / Rabattgutschein',exact:true});
  await dialog.getByLabel('Rabattgutscheincode',{exact:true}).fill(code);
  await dialog.getByRole('button',{name:'Rabattgutschein einlösen',exact:true}).click();
  await expect(page.getByTestId('cart-subtotal')).toHaveText('CHF 9.94');
  await page.getByRole('button',{name:'Rabatt / Rabattgutschein',exact:true}).click();
  dialog=page.getByRole('dialog',{name:'Rabatt / Rabattgutschein',exact:true});
  await dialog.getByRole('button',{name:'Alle Rabatte entfernen',exact:true}).click();
  await page.getByRole('button',{name:'Rabatt / Rabattgutschein',exact:true}).click();
  dialog=page.getByRole('dialog',{name:'Rabatt / Rabattgutschein',exact:true});
  await dialog.getByLabel('Rabattart',{exact:true}).selectOption('freeProduct');
  await dialog.getByLabel('Rabatt auf',{exact:true}).selectOption('product-chocolate');
  await dialog.getByLabel('Variante',{exact:true}).selectOption('variant-chocolate-default');
  await dialog.getByRole('button',{name:'Rabatt anwenden',exact:true}).click();
  await expect(page.getByTestId('cart-subtotal')).toHaveText('CHF 12.47');
  await page.reload();await expect(page.getByTestId('cart-subtotal')).toHaveText('CHF 12.47');
 }finally{await app.close();await rm(directory,{recursive:true,force:true,maxRetries:5});}
});

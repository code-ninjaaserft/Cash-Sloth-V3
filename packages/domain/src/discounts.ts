import { DomainError,type Cart,type CartItem } from './models.js';
import { validateCart } from './cart.js';
import { assertRappen,multiplyMoney,addMoney } from './money.js';
export interface DiscountRule { name:string;kind:'percent'|'amount'|'freeProduct';value:number;productId:string|null }
export function restoreDiscounts(cart:Cart):Cart { const items=cart.items.map(item=>{const {originalUnitPriceRappen,discountLabel,...rest}=item;void discountLabel;return {...rest,unitPriceRappen:originalUnitPriceRappen??item.unitPriceRappen,lineTotalRappen:multiplyMoney(originalUnitPriceRappen??item.unitPriceRappen,item.quantity)};});return {...cart,items,subtotalRappen:items.reduce((sum,item)=>addMoney(sum,item.lineTotalRappen),0)}; }
export function applyDiscount(cart:Cart,rule:DiscountRule,newId:()=>string):Cart {
 validateCart(cart);assertRappen(rule.value);if(!rule.name.trim()||rule.name.length>120||!['percent','amount','freeProduct'].includes(rule.kind))throw new DomainError('INVALID_INPUT','Invalid discount.');
 if(rule.kind==='percent'&&rule.value>10000)throw new DomainError('INVALID_INPUT','Percent must be between 0 and 100.');
 const base=cart,eligible=base.items.filter(item=>(!rule.productId||item.productId===rule.productId)&&item.unitPriceRappen>0);const total=eligible.reduce((sum,item)=>addMoney(sum,item.lineTotalRappen),0);
 if(!eligible.length||!total)throw new DomainError('INVALID_INPUT','No eligible products.');if(rule.kind==='amount'&&rule.value>total)throw new DomainError('INVALID_INPUT','Discount exceeds eligible goods value.');
 let prefix=0n,free=false;const items:CartItem[]=[];
 for(const item of base.items){if(item.unitPriceRappen===0||rule.productId&&item.productId!==rule.productId){items.push(item);continue;}
 let discounted:number;
 if(rule.kind==='percent')discounted=Number((BigInt(item.unitPriceRappen)*BigInt(10000-rule.value)+5000n)/10000n)*item.quantity;
 else if(rule.kind==='freeProduct'){if(free){items.push(item);continue;}free=true;if(item.quantity>1)items.push({...item,quantity:item.quantity-1,lineTotalRappen:multiplyMoney(item.unitPriceRappen,item.quantity-1)});items.push({...item,id:item.quantity>1?newId():item.id,quantity:1,unitPriceRappen:0,lineTotalRappen:0,originalUnitPriceRappen:item.originalUnitPriceRappen??item.unitPriceRappen,discountLabel:(item.discountLabel ? item.discountLabel+' + ' : '')+rule.name});continue;}
 else{const end=prefix+BigInt(item.lineTotalRappen),discount=BigInt(rule.value)*end/BigInt(total)-BigInt(rule.value)*prefix/BigInt(total);prefix=end;discounted=item.lineTotalRappen-Number(discount);}
 const low=Math.floor(discounted/item.quantity),highQuantity=discounted%item.quantity;
 const add=(quantity:number,price:number,id:string)=>{if(quantity)items.push({...item,id,quantity,unitPriceRappen:price,lineTotalRappen:multiplyMoney(price,quantity),originalUnitPriceRappen:item.originalUnitPriceRappen??item.unitPriceRappen,discountLabel:(item.discountLabel ? item.discountLabel+' + ' : '')+rule.name});};
 add(item.quantity-highQuantity,low,item.id);add(highQuantity,low+1,item.quantity===highQuantity?item.id:newId());
 }
 if(items.some(item=>(item.discountLabel?.length??0)>120))throw new DomainError('INVALID_INPUT','Too many combined discounts. Use shorter discount names.');
 const result={...cart,revision:cart.revision+1,items,subtotalRappen:items.reduce((sum,item)=>addMoney(sum,item.lineTotalRappen),0)};validateCart(result);return result;
}

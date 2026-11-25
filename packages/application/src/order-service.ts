import {ORDERS_CONTRACTS,OrderSchema,type Order,type OrdersMethod,type OrdersRequest,type OrdersResponse} from '@cash-sloth/contracts';
import {DomainError,createCart,addVariantToCart,setCartQuantity,clearCart,addMoney,validateCart} from '@cash-sloth/domain';
import {PersistenceError,type PosRuntime} from './ports.js';
import type {OrderStore} from './order-ports.js';
export function createOrderService(store:OrderStore,runtime:PosRuntime){
 const run=<K extends Exclude<OrdersMethod,'open'|'openInfo'|'openKitchen'>>(method:K,input:OrdersRequest<K>,action:()=>unknown):OrdersResponse<K>=>{
  try{if(!ORDERS_CONTRACTS[method].request.safeParse(input).success)throw new DomainError('INVALID_INPUT','Invalid order request.');return ORDERS_CONTRACTS[method].response.parse({ok:true,value:store.pos.transaction(action)}) as OrdersResponse<K>;}
  catch(error){return {ok:false,error:{code:error instanceof DomainError?error.code:error instanceof PersistenceError&&error.outcome==='unknown'?'COMMIT_UNCERTAIN':'STORAGE_ERROR',message:error instanceof DomainError?error.message:'Order could not be confirmed. Retry the same operation.'}} as OrdersResponse<K>;}
 };
 const once=(id:string,input:unknown,action:()=>unknown)=>{const request=JSON.stringify(input),old=store.operation(id);if(old){if(old.request!==request)throw new DomainError('CONFLICT','Operation reference already used.');return JSON.parse(old.result) as unknown;}const result=action();store.saveOperation(id,request,JSON.stringify(result));return result;};
 const eventOrders=()=>{const eventId=store.catalog().eventId;return store.list().filter(o=>o.eventId===eventId);};
 const order=(id:string)=>{const current=store.get(id);if(!current)throw new DomainError('NOT_FOUND','Order not found.');if(current.eventId!==store.catalog().eventId)throw new DomainError('CONFLICT','Load the event belonging to this order first.');return current;};
 const idle=()=>{store.pos.assertNoFinancialCheckout?.();if(store.pos.getUnresolvedCheckout())throw new DomainError('CHECKOUT_PENDING','Finish the current payment first.');};
 const put=(current:Order,change:Partial<Order>)=>{const next=OrderSchema.parse({...current,...change,revision:current.revision+(change.preparation!==undefined&&change.preparation!==current.preparation||change.cart!==undefined?1:0)});store.put(next);return next;};
 const prep=(current:Order,next:'preparing'|'ready'|'collected')=>{
  const transitions:Record<Order['preparation'],readonly string[]>={received:['preparing'],preparing:['ready'],ready:['collected'],collected:[],cancelled:[]};
  if(current.status==='cancelled'||!transitions[current.preparation].includes(next))throw new DomainError('CONFLICT','Refresh this order before changing its preparation status.');
  return put(current,{preparation:next,...(current.paid&&next!=='preparing'?{status:next}:{})});
 };
 const enabled=(feature:'kiosk'|'tableService'|'infoDisplay'|'kitchen')=>{if(!store.settings()[feature])throw new DomainError('FEATURE_DISABLED','This feature is disabled in Settings.');};
 return {
 getSettings:(input:OrdersRequest<'getSettings'>)=>run('getSettings',input,()=>store.settings()),
 setSettings:(input:OrdersRequest<'setSettings'>)=>run('setSettings',input,()=>once(input.operationId,input,()=>{const current=store.settings();if(current.revision!==input.expectedRevision)throw new DomainError('CONFLICT','Settings changed. Reload them before saving.');const next={...input.settings,revision:current.revision+1};store.saveSettings(next);return next;})),
 resetCounter:(input:OrdersRequest<'resetCounter'>)=>run('resetCounter',input,()=>once(input.operationId,input,()=>{store.resetCounter();return {reset:true as const};})),
 catalog:(input:OrdersRequest<'catalog'>)=>run('catalog',input,()=>{enabled('kiosk');return store.catalog();}),
 board:(input:OrdersRequest<'board'>)=>run('board',input,()=>{enabled('infoDisplay');const c=store.catalog();return {eventTitle:c.eventTitle,logo:c.logo,demoMode:c.demoMode,orders:eventOrders().filter(o=>o.source!=='table'&&o.number!==null&&o.status!=='cancelled'&&['received','preparing','ready'].includes(o.preparation)).map(o=>({id:o.id,number:o.number,preparation:o.preparation}))};}),
 kitchen:(input:OrdersRequest<'kitchen'>)=>run('kitchen',input,()=>{enabled('kitchen');const c=store.catalog();return {eventTitle:c.eventTitle,demoMode:c.demoMode,orders:eventOrders().filter(o=>o.status!=='cancelled'&&!['collected','cancelled'].includes(o.preparation))};}),
 prepare:(input:OrdersRequest<'prepare'>)=>run('prepare',input,()=>once(input.operationId,input,()=>{const current=order(input.orderId);if(current.revision!==input.expectedRevision)throw new DomainError('CONFLICT','Refresh this order before changing its preparation status.');return prep(current,input.preparation);})),
 submit:(input:OrdersRequest<'submit'>)=>run('submit',input,()=>once(input.operationId,input,()=>{
  enabled('kiosk');const catalog=store.catalog();if(input.eventId!==catalog.eventId||input.version!==catalog.version)throw new DomainError('CONFLICT','The menu changed. Reload it and check your order.');
  let cart=createCart(runtime.newId());const seen=new Set<string>();
  for(const item of input.items){if(seen.has(item.variantId))throw new DomainError('INVALID_INPUT','Duplicate variant.');seen.add(item.variantId);const variant=store.pos.getVariant(item.variantId);if(!variant)throw new DomainError('NOT_FOUND','Product is no longer available.');cart=addVariantToCart(cart,variant,runtime.newId());if(item.quantity>1)cart=setCartQuantity(cart,cart.items[cart.items.length-1]!.id,item.quantity);}
  const saved=OrderSchema.parse({id:input.operationId,number:store.nextNumber(),eventId:catalog.eventId,eventTitle:catalog.eventTitle,createdAt:runtime.now(),cart,status:'waiting',cartId:null,source:'kiosk'});store.put(saved);return saved;
 })),
 book:(input:OrdersRequest<'book'>)=>run('book',input,()=>once(input.operationId,input,()=>{
  enabled('tableService');idle();const current=store.pos.getCart(input.cartId);if(!current||current.revision!==input.expectedRevision||!current.items.length)throw new DomainError('CONFLICT','Refresh the cart before booking table service.');
  if(current.items.some(i=>i.originalUnitPriceRappen!==undefined))throw new DomainError('CONFLICT','Apply discounts when paying the table bill.');
  if(store.list().some(o=>o.cartId===current.id&&o.status==='register'))throw new DomainError('CONFLICT','Release the previous unpaid order first.');
  const c=store.catalog();const saved=OrderSchema.parse({id:input.operationId,number:null,eventId:c.eventId,eventTitle:c.eventTitle,createdAt:runtime.now(),cart:{...current,items:current.items.map(i=>({...i,id:runtime.newId()}))},status:'waiting',cartId:null,source:'table',serviceLabel:input.serviceLabel});store.put(saved);store.pos.updateCart(clearCart(current),current.revision);return saved;
 })),
 list:(input:OrdersRequest<'list'>)=>run('list',input,eventOrders),
 accept:(input:OrdersRequest<'accept'>)=>run('accept',input,()=>once(input.operationId,input,()=>{
  const current=order(input.orderId);if(current.status!=='waiting')throw new DomainError('CONFLICT','Order is already being processed.');idle();
  let cart=store.pos.getDraftCart();if(cart&&store.list().some(o=>o.cartId===cart?.id&&o.status==='register'))throw new DomainError('CONFLICT','Release the previous unpaid order first.');if(cart?.items.length)throw new DomainError('CONFLICT','Empty the register cart before accepting an order.');
  const group=current.source==='table'?eventOrders().filter(o=>o.source==='table'&&o.serviceLabel===current.serviceLabel&&o.status==='waiting'):[current];
  if(current.source==='table'&&eventOrders().some(o=>o.source==='table'&&o.serviceLabel===current.serviceLabel&&o.status==='register'))throw new DomainError('CONFLICT','This table is already being paid. Finish its payment first.');
  if(!cart){cart=createCart(runtime.newId());store.pos.createCart(cart);}
  const next={...cart,revision:cart.revision+1,items:group.flatMap(o=>o.cart.items.map(item=>({...item,id:runtime.newId()}))),subtotalRappen:group.reduce((s,o)=>addMoney(s,o.cart.subtotalRappen),0)};validateCart(next);store.pos.updateCart(next,cart.revision);for(const o of group)put(o,{status:'register',cartId:next.id});return next;
 })),
 release:(input:OrdersRequest<'release'>)=>run('release',input,()=>once(input.operationId,input,()=>{
  const current=order(input.orderId);if(current.status!=='register'||!current.cartId)throw new DomainError('CONFLICT','Only unpaid register orders can be released.');idle();const cart=store.pos.getCart(current.cartId);if(!cart)throw new DomainError('CONFLICT','Order cart is no longer available.');
  const group=eventOrders().filter(o=>o.cartId===current.cartId&&o.status==='register');let next=current;for(const o of group)next=put(o,{status:o.source==='register'?'cancelled':'waiting',cartId:null,...(o.source==='register'?{preparation:'cancelled' as const}:{})});store.pos.updateCart(clearCart(cart),cart.revision);return current.source==='register'?{id:current.id,deleted:true as const}:next;
 })),
 status:(input:OrdersRequest<'status'>)=>run('status',input,()=>once(input.operationId,input,()=>{
  const current=order(input.orderId);
  if(input.status==='cancelled'){if(current.status!=='waiting'||current.preparation!=='received')throw new DomainError('CONFLICT','Only a received unpaid order can be cancelled.');put(current,{status:'cancelled',preparation:'cancelled'});return {id:current.id,deleted:true as const};}
  return prep(current,input.status==='ready'?'ready':'collected');
 })),
 };
}

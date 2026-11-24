import {t,localeTag} from './preferences.js';
import { Modal } from './modal.js';
import { TicketBatch } from './ticket-preview.js';
import React,{useEffect,useState} from 'react';
import type {PaymentsApi,TeamBooking,TicketsApi} from '@cash-sloth/contracts';
import {formatChf,addMoney} from '@cash-sloth/domain';
export function TeamStatistics({api,tickets}:{api:PaymentsApi;tickets?:TicketsApi|undefined}):React.JSX.Element {
 const [preview,setPreview]=useState<string|null>(null);
 const [rows,setRows]=useState<readonly TeamBooking[]>([]),[error,setError]=useState(false);
 useEffect(()=>{void api.listTeam({}).then(result=>{if(result.ok)setRows(result.value);else setError(true);}).catch(()=>setError(true));},[api]);
 const items=new Map<string,{name:string;quantity:number;value:number}>();
 for(const row of rows)for(const item of row.cart.items){const key=item.productName+' — '+item.variantName;const old=items.get(key)??{name:key,quantity:0,value:0};items.set(key,{...old,quantity:old.quantity+item.quantity,value:addMoney(old.value,item.lineTotalRappen)});}
 return <main className="pos-content"><h1>{t("Helpers / Team — consumption")}</h1><p>{t("Complimentary consumption without money transfers. Goods values are reference values, not income.")}</p>{error&&<p role="alert">{t("Statistics could not be loaded.")}</p>}<p>{rows.length} {t('bookings')} · {t('Income')}: CHF 0.00</p><table><thead><tr><th>{t("Product / variant")}</th><th>{t("Quantity consumed")}</th><th>{t("Goods value")}</th></tr></thead><tbody>{[...items.values()].map(item=><tr key={item.name}><td>{item.name}</td><td>{item.quantity}</td><td>{formatChf(item.value)}</td></tr>)}</tbody></table><h2>{t("Consumption by event")}</h2>{rows.map(row=><p key={row.sessionId}>{new Date(row.completedAt).toLocaleString(localeTag())} · {row.eventTitle??t('No event')} · {row.cart.items.map(item=>item.quantity+' × '+item.productName).join(', ')}{tickets&&row.cart.items.some(item=>(item.ticketUses??0)>0)&&<button type="button" onClick={()=>setPreview(row.sessionId)}>{t("Show tickets")}</button>}</p>)}{preview&&tickets&&<Modal title="Tickets" onClose={()=>setPreview(null)}><TicketBatch api={tickets} saleId={preview} /></Modal>}</main>;
}

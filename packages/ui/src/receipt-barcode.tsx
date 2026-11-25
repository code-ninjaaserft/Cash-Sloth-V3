import React,{useEffect,useState} from 'react';import type {HistoryApi} from '@cash-sloth/contracts';import {TicketBarcode} from './ticket-barcode.js';import {t} from './preferences.js';
export function ReceiptBarcode({api,saleId}:{api:HistoryApi|undefined;saleId:string}):React.JSX.Element|null{
 const [code,setCode]=useState<string|null>(null),[error,setError]=useState(false),[retry,setRetry]=useState(0);
 useEffect(()=>{let current=true;setCode(null);setError(false);if(api)void api.getReceiptCode({saleId}).then(r=>{if(current){if(r.ok)setCode(r.value);else setError(true);}}).catch(()=>{if(current)setError(true);});return()=>{current=false;};},[api,saleId,retry]);
 if(!api)return null;return <div className="receipt-barcode">{code?<><TicketBarcode code={code}/><code>{code}</code><small>{t('Scan this receipt in sales history.')}</small></>:error?<button onClick={()=>setRetry(n=>n+1)}>{t('Retry receipt barcode')}</button>:<small>{t('Loading receipt barcode…')}</small>}</div>;
}

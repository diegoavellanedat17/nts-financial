import { useEffect, useState } from 'react';
import { supabase } from './supabase';
import { money, type Currency } from './finance';
type Transfer = {sent_amount:number;received_amount:number;from_currency:Currency;to_currency:Currency;source_balance_after:number|null;effective_cop_per_usd:number|null;benchmark_rate:number|null;fx_difference_cop:number|null};
export function TransferInfo({ userId, id }: { userId?:string; id:string }) {
 const [data,setData]=useState<Transfer|null>(null),[failed,setFailed]=useState(false);
 useEffect(()=>{if(!supabase||!userId)return;let active=true;void supabase.from('transfers').select('sent_amount,received_amount,from_currency,to_currency,source_balance_after,effective_cop_per_usd,benchmark_rate,fx_difference_cop').eq('id',id).eq('user_id',userId).single().then(({data,error})=>{if(active){setFailed(!!error);setData(data);}});return()=>{active=false;};},[userId,id]);
 if(failed)return <p className="empty-note">No se pudo cargar el detalle.</p>;
 if(!data)return <p className="empty-note">Cargando…</p>;
 const rate=(value:number)=>new Intl.NumberFormat('es-CO',{minimumFractionDigits:2,maximumFractionDigits:2}).format(value);
 return <dl className="transfer-info"><dt>Salió</dt><dd>{money(data.sent_amount,data.from_currency)}</dd><dt>Llegó</dt><dd>{money(data.received_amount,data.to_currency)}</dd>{data.source_balance_after!==null&&<><dt>Quedó en origen</dt><dd>{money(data.source_balance_after,data.from_currency)}</dd></>}{data.effective_cop_per_usd!==null&&<><dt>Cambio aplicado</dt><dd>{rate(data.effective_cop_per_usd)} COP/USD</dd></>}{data.benchmark_rate!==null&&<><dt>TRM del día</dt><dd>{rate(data.benchmark_rate)} COP/USD</dd><dt>{Number(data.fx_difference_cop)>=0?'Diferencia frente a TRM':'A favor frente a TRM'}</dt><dd>{money(Math.abs(Number(data.fx_difference_cop)),'COP')} aprox.</dd></>}</dl>;
}

import { expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { bogotaToday, officialTrm, trmSource, validTrm } from '../lib/trm';
import { summarizeInCop, type Transaction } from '../src/finance';
const row: Transaction = { id:'1',date:'2026-10-01',kind:'income',amount:3000,currency:'USD',context:'Personal',category:'Otros',description:'Pago',reserved:0,from_reserve:false };
it('consolida monedas a la tasa del día sin cambiar los movimientos originales',()=>{
 const rows=[row,{...row,id:'2',kind:'expense' as const,currency:'COP' as const,amount:230000}];
 const before=JSON.stringify(rows);
 const result=summarizeInCop(rows,'2026-10',3312.84);
 expect(result).toMatchObject({income:9938520,expenses:230000,cash:9708520,available:9708520});
 expect(JSON.stringify(rows)).toBe(before);
});
it('mantiene las reservas separadas por moneda antes de convertir',()=>{
 const result=summarizeInCop([{...row,context:'Consultorio',amount:100,reserved:100},{...row,id:'2',context:'Consultorio',currency:'COP',kind:'expense',amount:50000,from_reserve:true}],'2026-10',4000);
 expect(result.reserved).toBe(400000);expect(result.available).toBe(-50000);
 expect(()=>summarizeInCop([row],'2026-10',0)).toThrow();
});
it('elige la TRM vigente en Colombia y rechaza la última publicada si es para mañana',()=>{
 const official=[{valor:'3307.73',unidad:'COP',vigenciadesde:'2026-10-02T00:00:00',vigenciahasta:'2026-10-02T00:00:00'}, {valor:'3312.84',unidad:'COP',vigenciadesde:'2026-10-01T00:00:00',vigenciahasta:'2026-10-01T00:00:00'}];
 const rate=officialTrm(official,'2026-10-01');expect(rate.cop_per_usd).toBe(3312.84);
 expect(validTrm(rate,'2026-10-02')).toBe(false);
 expect(()=>officialTrm([official[0]],'2026-10-01')).toThrow();
 expect(bogotaToday(new Date('2026-10-02T04:59:59Z'))).toBe('2026-10-01');
 expect(officialTrm([{valor:'4000',unidad:'COP',vigenciadesde:'2026-10-03T00:00:00',vigenciahasta:'2026-10-05T00:00:00'}],'2026-10-04').cop_per_usd).toBe(4000);
});
it('protege la tasa almacenada de modificaciones desde el navegador',async()=>{
 const db=new PGlite();
 try{
  await db.exec('create role anon;create role authenticated;grant usage on schema public to anon,authenticated;');
  await db.exec(readFileSync(new URL('../supabase/migrations/20261001060000_exchange_rates.sql',import.meta.url),'utf8'));
  await db.query('insert into public.exchange_rates values ($1,$2,$1,$1,$3,now())',['2026-10-01',3312.84,trmSource]);
  await db.exec('set role authenticated;');expect((await db.query('select * from public.exchange_rates')).rows).toHaveLength(1);
  await expect(db.query('update public.exchange_rates set cop_per_usd=1')).rejects.toThrow();
  await expect(db.query('delete from public.exchange_rates')).rejects.toThrow();
  await db.exec('set role anon;');expect((await db.query('select * from public.exchange_rates')).rows).toHaveLength(1);
 }finally{await db.close();}
},20000);

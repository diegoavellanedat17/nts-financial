import { expect, it } from 'vitest';
import { suggestedClassification } from '../lib/classification';
import { summarize, summarizeInCop, today, type Transaction } from '../src/finance';
const advance: Transaction = { id:'advance',date:'2026-09-01',kind:'income',context:'Consultorio',category:'Tratamiento',description:'Abono',amount:1650000,reserved:1650000,patient_advance:true,from_reserve:false };
it('clasifica conceptos por palabras completas y solo para Natalia',()=>{
 expect(suggestedClassification('Transporte DIDI', 'natalia')?.category).toBe('Transporte');
 expect(suggestedClassification('Pago Gladys empleada', 'natalia')?.category).toBe('Hogar');
 expect(suggestedClassification('Compra ventilador', 'natalia')?.category).toBe('Compras');
 expect(suggestedClassification('dividido', 'natalia')).toBeNull();
 expect(suggestedClassification('Didi', 'diego')).toBeNull();
 expect(suggestedClassification('arriendo casa','natalia')).toBeNull();
});
it('protege cada abono, conserva el efectivo y no lo libera con gastos genéricos',()=>{
 const expense:Transaction={...advance,id:'lab',patient_advance:false,kind:'expense',amount:100000,reserved:0,from_reserve:true};
 const held=summarize([advance,expense],today().slice(0,7));
 expect(held.cash).toBe(1550000);expect(held.reserved).toBe(1650000);expect(held.available).toBe(-100000);
 const released=summarize([{...advance,reserve_release_date:today()},expense],today().slice(0,7));
 expect(released.cash).toBe(held.cash);expect(released.income).toBe(held.income);expect(released.available).toBe(1550000);
 expect(summarize([{...advance,reserve_release_date:'2026-10-01'}],'2026-09').reserved).toBe(1650000);
});
it('mantiene abonos en su moneda y los convierte una sola vez',()=>{
 const usd={...advance,currency:'USD' as const,amount:100,reserved:100};
 expect(summarize([usd],'2026-10','COP').reserved).toBe(0);
 expect(summarizeInCop([usd],'2026-10',4000).reserved).toBe(400000);
});

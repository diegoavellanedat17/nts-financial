import { expect,it } from 'vitest';
import { budgetNoteId,budgetProgress,decodePlan,encodePlan,suggestedPlan } from '../lib/categoryBudgets';
import type { Transaction } from '../src/finance';
it('incluye los pagos confirmados en noviembre y no repite nevera ni sofás en diciembre',()=>{
 const diego=suggestedPlan('diego','2026-11'),natalia=suggestedPlan('natalia','2026-11');
 expect(diego.limits.Hogar).toBe(6500000+2600000+1400000);
 expect(natalia.limits.Hogar).toBe(2900000+1400000);
 expect(Object.values(diego.limits).reduce((a,b)=>a+b,0)).toBe(15946000);
 expect(Object.values(natalia.limits).reduce((a,b)=>a+b,0)).toBe(10400000);
 expect(suggestedPlan('diego','2026-12').limits.Hogar).toBe(6800000);
 expect(suggestedPlan('natalia','2026-12').limits.Hogar).toBe(2900000);
});
it('conserva documentos editados, valida moneda/mes/topes y evita presupuestos duplicados por usuario y mes',async()=>{
 const plan=suggestedPlan('diego','2026-11');plan.limits.Compras=0;
 expect(decodePlan(encodePlan(plan),'2026-11')).toEqual(plan);
 expect(()=>decodePlan(encodePlan(plan),'2026-10')).toThrow();
 expect(()=>encodePlan({...plan,limits:{...plan.limits,Hogar:-1}})).toThrow();
 expect(()=>encodePlan({...plan,limits:{...plan.limits,Hogar:1.5}})).toThrow();
 expect(()=>encodePlan({...plan,limits:{...plan.limits,Hogar:NaN}})).toThrow();
 expect(encodePlan(plan).length).toBeLessThan(4000);
 expect(await budgetNoteId('user','2026-11')).toBe(await budgetNoteId('user','2026-11'));
 expect(await budgetNoteId('user','2026-11')).not.toBe(await budgetNoteId('other','2026-11'));
 expect(await budgetNoteId('user','2026-11')).not.toBe(await budgetNoteId('user','2026-12'));
});
it('usa solo gastos personales COP del mes hasta hoy, con centavos exactos, alertas y tope cero',()=>{
 const base:Transaction={id:'one',date:'2026-11-01',kind:'expense',amount:80000,currency:'COP',context:'Personal',category:'Compras',description:'Compra',reserved:0,from_reserve:false,flow_type:'operating'};
 const plan=suggestedPlan('diego','2026-11');plan.limits.Compras=100000;plan.limits.Otros=0;
 const rows=[base,{...base,id:'cent',amount:0.9},{...base,kind:'income' as const},{...base,date:'2026-10-31'},{...base,date:'2026-11-30'},{...base,context:'Consultorio' as const},{...base,currency:'USD' as const},{...base,flow_type:'transfer' as const},{...base,flow_type:'opening_balance' as const},{...base,category:'Otros',amount:50}];
 const get=(r:Transaction[])=>budgetProgress(r,plan,'2026-11-03').find(p=>p.category==='Compras')!;
 expect(get(rows)).toMatchObject({spent:80000.9,remaining:19999.1,state:'near'});
 expect(get([...rows,{...base,amount:20000}])).toMatchObject({spent:100000.9,remaining:-0.9,state:'over'});
 expect(budgetProgress(rows,plan,'2026-11-03').find(p=>p.category==='Otros')).toMatchObject({spent:50,limit:0,remaining:-50,state:'over',percent:100});
 expect(get([{...base,amount:100000}])).toMatchObject({remaining:0,state:'near',percent:100});
});

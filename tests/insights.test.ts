import { expect, it } from 'vitest';
import { expenseShares, officeCash } from '../lib/insights';
import { recordedAnswer } from '../lib/recordedAnswers';
import { financeSnapshot, type LedgerRow } from '../lib/chat';
const row = (id:string,kind:string,amount:number,context:string,other:Partial<LedgerRow>={}):LedgerRow => ({ id,kind,amount,context,date:'2026-10-01',currency:'COP',flow_type:'operating',category:'Otros',description:'Concepto',reserved:0,from_reserve:false,...other });
const rows=[row('1','income',1520876,'Consultorio'),row('2','income',1650000,'Consultorio',{patient_advance:true,reserved:1650000}),row('3','expense',2850000,'Consultorio'),row('4','expense',755350,'Personal')];
it('grafica caja incluyendo abonos sin convertirla en utilidad y excluye ajustes',()=>{
 const result=officeCash([...rows,row('5','income',6000000,'Consultorio',{flow_type:'opening_balance'})]);
 expect(result.net).toBe(320876);expect(result.expensePercent).toBeCloseTo(89.88,2);
 expect(officeCash([row('6','expense',100,'Consultorio')])).toEqual({received:0,paid:100,net:-100,expensePercent:null});
});
it('separa gastos personales y laborales sin contar ingresos ni transferencias',()=>{
 const shares=expenseShares([...rows,row('7','expense',999999,'Personal',{flow_type:'transfer'})]);
 expect(shares.map(s=>[s.name,s.amount,Math.round(s.percent)])).toEqual([['Personal',755350,21],['Consultorio',2850000,79]]);
});
it('consulta los totales completos por moneda y no inventa utilidad futura',()=>{
 const snapshot=financeSnapshot([...rows,row('8','expense',100,'Personal',{currency:'USD'})],[],[],'2026-10-02');
 expect(recordedAnswer(snapshot,'¿Cómo va el consultorio?')).toContain('320.876 COP');
 expect(recordedAnswer(snapshot,'¿Qué utilidad espero?')).toContain('faltan los valores');
 expect(recordedAnswer(snapshot,'¿Cuánto hay apartado?')).toContain('1.650.000 COP');
 const spending=recordedAnswer(snapshot,'¿Cuáles son mis gastos personales?');
 expect(spending).toContain('755.350 COP');expect(spending).toContain('100 USD');
 expect(recordedAnswer(snapshot,'¿Cómo van los gastos de septiembre?')).toContain('este mes');
});

import { expect, it } from 'vitest';
import { officeQuestions, validateOfficeAnswer } from '../lib/officeQuestions';
import type { Transaction } from '../src/finance';
const mixed:Transaction={id:'mixed',date:'2026-10-06',kind:'income',amount:1511547,currency:'COP',context:'Consultorio',category:'Tratamiento',description:'Consultorio · Incluye tratamientos entregados y pendientes; cobro apartado hasta aclarar cada caso.',reserved:1511547,patient_advance:true,from_reserve:false,person_tag:'natalia'};
const advance={...mixed,id:'advance',amount:1650000,reserved:1650000,description:'Abono de tratamiento pendiente'};
const auxiliary:Transaction={...mixed,id:'auxiliary',kind:'expense',amount:180000,reserved:0,patient_advance:false,category:'Servicios',description:'Pago Dianita auxiliar'};
it('genera las tres preguntas de Natalia y no altera dinero ni mezcla personas',()=>{
 const rows=[mixed,advance,auxiliary,{...mixed,id:'diego',person_tag:'diego'},{...mixed,id:'future',date:'2026-10-20'}];const before=JSON.stringify(rows);
 const questions=officeQuestions(rows,[],'2026-10-07');expect(questions.map(q=>q.kind)).toEqual(['delivered_amount','pending_work','auxiliary_period']);
 expect(questions[0].amount).toBe(1511547);expect(questions[1].snapshot.transaction_ids).toEqual(['advance','mixed']);expect(questions[2].amount).toBe(180000);
 expect(JSON.stringify(rows)).toBe(before);
 expect(officeQuestions(rows,questions.map(q=>({question_key:q.key,kind:q.kind,answer:{notes:'Respondida'}})),'2026-10-07')).toEqual([]);
 expect(officeQuestions([{...mixed,reserve_release_date:'2026-10-07'}],[],'2026-10-07')).toEqual([]);
});
it('acepta montos parciales o cero, contexto sin costo conocido y periodos explícitos',()=>{
 const q=officeQuestions([mixed,advance,auxiliary],[],'2026-10-07');
 expect(validateOfficeAnswer(q[0],{amount:500000})).toBeNull();expect(validateOfficeAnswer(q[0],{amount:0})).toBeNull();expect(validateOfficeAnswer(q[0],{amount:1511548})).not.toBeNull();expect(validateOfficeAnswer(q[0],{amount:0.5})).not.toBeNull();expect(validateOfficeAnswer(q[0],{amount:null})).not.toBeNull();
 expect(validateOfficeAnswer(q[1],{notes:'Laboratorio de varios casos, costo por confirmar.'})).toBeNull();expect(validateOfficeAnswer(q[1],{notes:''})).not.toBeNull();
 expect(validateOfficeAnswer(q[2],{period:'week',notes:''})).toBeNull();expect(validateOfficeAnswer(q[2],{period:'other',notes:''})).not.toBeNull();
});

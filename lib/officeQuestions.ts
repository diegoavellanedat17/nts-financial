import type { Currency, Transaction } from '../src/finance';
export type OfficeQuestionKind = 'delivered_amount' | 'pending_work' | 'auxiliary_period';
export type OfficeQuestion = { key:string;kind:OfficeQuestionKind;transactionId:string|null;question:string;amount?:number;currency:Currency;snapshot:Record<string,unknown> };
export type OfficeAnswer = { question_key:string;kind:OfficeQuestionKind;answer:Record<string,unknown> };
export function officeQuestions(rows:Transaction[], answers:OfficeAnswer[], asOf:string):OfficeQuestion[] {
 const office=rows.filter(t=>t.person_tag==='natalia'&&t.context==='Consultorio'&&(t.flow_type || 'operating')==='operating'&&!t.transfer_id&&!t.balance_check_id&&t.date<=asOf);
 const pending=office.filter(t=>t.kind==='income'&&t.patient_advance&&t.reserved>0&&(!t.reserve_release_date||t.reserve_release_date>asOf)).sort((a,b)=>b.date.localeCompare(a.date)||a.id.localeCompare(b.id));
 const result:OfficeQuestion[]=[];
 for(const t of pending.filter(t=>/incluye tratamientos entregados y pendientes/i.test(t.description)))result.push({key:`delivered_amount:${t.id}`,kind:'delivered_amount',transactionId:t.id,question:'De este cobro, ¿cuánto corresponde a tratamientos ya terminados?',amount:t.amount,currency:t.currency || 'COP',snapshot:{question:'De este cobro, ¿cuánto corresponde a tratamientos ya terminados?',date:t.date,amount:t.amount,currency:t.currency || 'COP',description:t.description}});
 if(pending.length)result.push({key:`pending_work:${pending.map(t=>t.id).sort().join(',')}`,kind:'pending_work',transactionId:null,question:'¿Qué falta entregar y cuánto falta pagar de laboratorio o materiales?',currency:'COP',snapshot:{question:'¿Qué falta entregar y cuánto falta pagar de laboratorio o materiales?',transaction_ids:pending.map(t=>t.id).sort(),advances:pending.map(t=>({date:t.date,amount:t.amount,currency:t.currency || 'COP',description:t.description}))}});
 for(const t of office.filter(t=>t.kind==='expense'&&/auxiliar|dianita/i.test(t.description)).sort((a,b)=>b.date.localeCompare(a.date)||a.id.localeCompare(b.id)))result.push({key:`auxiliary_period:${t.id}`,kind:'auxiliary_period',transactionId:t.id,question:'Este pago a la auxiliar, ¿qué periodo cubre?',amount:t.amount,currency:t.currency || 'COP',snapshot:{question:'Este pago a la auxiliar, ¿qué periodo cubre?',date:t.date,amount:t.amount,currency:t.currency || 'COP',description:t.description}});
 const answered=new Set(answers.map(a=>a.question_key));
 return result.filter(q=>!answered.has(q.key));
}
export function validateOfficeAnswer(question:OfficeQuestion,answer:Record<string,unknown>) {
 if(question.kind==='delivered_amount')return typeof answer.amount==='number'&&Number.isFinite(answer.amount)&&answer.amount>=0&&answer.amount<=(question.amount || 0)&&Math.abs(answer.amount*100-Math.round(answer.amount*100))<0.000001&&(question.currency==='USD'||Number.isInteger(answer.amount))?null:'Escribe un monto entre cero y el total del cobro.';
 if(question.kind==='pending_work')return typeof answer.notes==='string'&&answer.notes.trim().length>0&&answer.notes.length<=4000?null:'Describe lo pendiente, aunque aún no sepas el costo.';
 return ['day','week','month','other'].includes(String(answer.period))&&typeof answer.notes==='string'&&answer.notes.length<=4000&&(answer.period!=='other'||answer.notes.trim().length>0)?null:'Indica qué periodo cubre el pago.';
}

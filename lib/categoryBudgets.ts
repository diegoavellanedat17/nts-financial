import { expenseCategories, type Transaction } from '../src/finance.ts';
export const personalBudgetCategories = expenseCategories.filter(c => !['Arriendo consultorio','Materiales','Laboratorio'].includes(c));
export type CategoryPlan = { version: 1; month: string; currency: 'COP'; context: 'Personal'; limits: Record<string, number>; homeDetails: string };
export const budgetNotePrefix = 'Presupuesto mensual por categoría · v1\n';
export function suggestedPlan(person: string, month: string): CategoryPlan {
  const november = month === '2026-11';
  const limits: Record<string, number> = Object.fromEntries(personalBudgetCategories.map(c=>[c,0]));
  Object.assign(limits,person === 'diego'
    ? { Hogar:november?10500000:6800000,Alimentación:1600000,Otros:600000,Planes:700000,Carro:200000,Compras:300000,Salud:650000,Transporte:500000,Deudas:230000,Bienestar:206000,Regalos:150000,Servicios:140000,Oficina:70000,Python:100000 }
    : { Hogar:november?4300000:2900000,Compras:800000,Salud:1200000,Alimentación:1400000,Regalos:300000,Python:750000,Transporte:600000,Carro:300000,Bienestar:350000,Planes:200000,Servicios:200000 });
  return {version:1,month,currency:'COP',context:'Personal',limits,homeDetails: person==='diego'
    ? november?'Arriendo $6.500.000 + nevera $2.600.000 + sofá $1.400.000.':'Arriendo $6.500.000 + $300.000 para otros gastos de casa.'
    : november?'Hogar y mercado $2.900.000 + sofá $1.400.000.':'Hogar y mercado $2.900.000.'};
}
export function validPlan(plan: CategoryPlan): boolean {
  return !!plan && plan.version===1 && /^\d{4}-(0[1-9]|1[0-2])$/.test(plan.month) && plan.currency==='COP' && plan.context==='Personal' &&
    typeof plan.homeDetails==='string' && plan.homeDetails.length<=400 && !!plan.limits &&
    Object.keys(plan.limits).length===personalBudgetCategories.length && personalBudgetCategories.every(c=>Number.isSafeInteger(plan.limits[c])&&plan.limits[c]>=0&&plan.limits[c]<=999999999);
}
export function encodePlan(plan: CategoryPlan) {
  if(!validPlan(plan)) throw Error('Revisa los topes: usa pesos completos, entre $0 y $999.999.999.');
  return budgetNotePrefix+JSON.stringify(plan);
}
export function decodePlan(body: string, month: string): CategoryPlan {
  if(!body.startsWith(budgetNotePrefix))throw Error('No pudimos leer este presupuesto.');
  const plan=JSON.parse(body.slice(budgetNotePrefix.length)) as CategoryPlan;
  // Extend existing saved plans without altering their limits or monthly totals.
  if(plan?.version===1 && plan.limits && typeof plan.limits==='object') {
    for(const category of ['Mercado','Tarjeta de crédito']) if(!Object.hasOwn(plan.limits,category)) plan.limits[category]=0;
  }
  if(!validPlan(plan)||plan.month!==month)throw Error('El presupuesto guardado no es válido.');
  return plan;
}
// Stable record ID prevents duplicate plans when two devices create the same month.
export async function budgetNoteId(userId: string, month: string) {
  const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(`nts-category-budget-v1:${userId}:${month}:COP:Personal`))).slice(0,16);
  bytes[6]=(bytes[6]&15)|128;bytes[8]=(bytes[8]&63)|128;
  const hex=Array.from(bytes,x=>x.toString(16).padStart(2,'0')).join('');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
export function budgetProgress(items: Transaction[], plan: CategoryPlan, asOf: string) {
  const expenses=items.filter(t=>t.date.startsWith(plan.month)&&t.date<=asOf&&t.kind==='expense'&&(t.flow_type||'operating')==='operating'&&t.context==='Personal'&&(t.currency||'COP')==='COP');
  return personalBudgetCategories.map(category=>{
    const spent=expenses.filter(t=>t.category===category).reduce((sum,t)=>sum+Math.round(t.amount*100),0)/100;
    const limit=plan.limits[category];const remaining=Math.round((limit-spent)*100)/100;
    return {category,spent,limit,remaining,percent:limit?spent/limit*100:spent?100:0,state:spent>limit?'over':limit>0&&spent>=limit*.8?'near':'ok'};
  });
}

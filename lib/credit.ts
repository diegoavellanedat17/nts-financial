export type CreditCard = {id:string;name:string;currency:'COP'|'USD';debt:number;credit_limit:number|null;monthly_payment:number|null;monthly_rate:number|null;closing_day:number|null;payment_day:number|null;balance_date:string;notes:string;updated_at?:string};
export type CreditScenario = {id:string;card_id:string;description:string;amount:number;installments:number;monthly_rate:number|null;currency:'COP'|'USD';created_at?:string};
// Equal principal installments, interest on the outstanding principal. Not a bank quote.
export function creditEstimate(amount:number,installments:number,rate:number|null){
 if(!Number.isFinite(amount)||amount<=0||!Number.isInteger(installments)||installments<1||installments>120||rate!==null&&(!Number.isFinite(rate)||rate<0||rate>20))throw Error('Invalid credit scenario');
 const round=(n:number)=>Math.round((n+Number.EPSILON)*100)/100;
 const principal=amount/installments,r=rate===null?null:rate/100;
 return {principal_per_installment:round(principal),first_installment:r===null?null:round(principal+amount*r),last_installment:r===null?null:round(principal+principal*r),total_interest:r===null?null:round(amount*r*(installments+1)/2),total_payment:r===null?null:round(amount+amount*r*(installments+1)/2),assumption:'Equal principal installments, fixed monthly interest on remaining principal; excludes fees, insurance and bank-specific billing dates.'};
}
export function creditContext(cards:CreditCard[],scenarios:CreditScenario[]){
 const debt={COP:0,USD:0};for(const c of cards)debt[c.currency]+=Math.round(Number(c.debt)*100);
 return {debt_by_currency:{COP:debt.COP/100,USD:debt.USD/100},cards:cards.map(c=>({...c,available_credit:c.credit_limit===null?null:Math.max(0,Math.round((Number(c.credit_limit)-Number(c.debt))*100)/100)})),planned_purchases:scenarios.map(s=>({...s,estimate:creditEstimate(Number(s.amount),Number(s.installments),s.monthly_rate===null?null:Number(s.monthly_rate))})),meaning:'Manual credit context as of each balance_date. Debt already includes existing purchases declared by the user. Scenarios are planned purchases, not real movements, and are not added to declared debt or existing monthly_payment. Available credit is not cash.'};
}

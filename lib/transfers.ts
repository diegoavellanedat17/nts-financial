export function transferFromBalance(balance: number, remaining: number, received: number, fromCurrency: string, toCurrency: string, rate: number | null, fee = 0) {
 const sent = Math.round((balance - remaining) * 100) / 100;
 const precision = (value:number,_currency:string) => Number.isFinite(value) && Math.abs(value*100-Math.round(value*100)) < 0.000001;
 if (!precision(balance,fromCurrency) || !precision(remaining,fromCurrency) || !precision(received,toCurrency) || remaining < 0 || sent <= 0 || received <= 0 || fee < 0 || fee >= sent || !precision(fee,fromCurrency)) return null;
 const principal = sent - fee;
 const effectiveRate = fromCurrency === 'USD' && toCurrency === 'COP' ? received / principal : fromCurrency === 'COP' && toCurrency === 'USD' ? principal / received : null;
 const difference = rate && effectiveRate ? Math.round(fromCurrency === 'USD' ? principal * rate - received : principal - received * rate) : null;
 return { sent, effectiveRate, difference };
}

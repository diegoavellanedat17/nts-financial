import { officeCash } from './insights.ts';
import type { financeSnapshot } from './chat.ts';
type Snapshot = ReturnType<typeof financeSnapshot>;
const format = (amount: number, currency: string) => `$${new Intl.NumberFormat('es-CO', { maximumFractionDigits: currency === 'USD' ? 2 : 0 }).format(amount)} ${currency}`;
function values(totals: Record<string, number>) { const entries = Object.entries(totals).filter(([, amount]) => amount !== 0); return entries.length ? entries.map(([c, a]) => format(a, c)).join(' y ') : '0'; }
export function recordedAnswer(snapshot: Snapshot, question: string): string {
  const q = question.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const month = snapshot.as_of.slice(0, 7), rows = snapshot.monthly_operating.filter(r => r.month === month);
  if (/ayer|semana|anterior|pasado|enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre|\b20\d{2}\b/.test(q)) return 'Por ahora consulto los totales de este mes y los saldos hasta hoy. Para otras fechas, revisa la tabla de movimientos.';
  if (/utilidad|profit|ganancia|rentab/.test(q)) return 'Para estimar utilidad faltan los valores de los tratamientos y sus costos pendientes. Los abonos recibidos no son ganancia.';
  if (/consultorio/.test(q)) {
    const office = rows.filter(r => r.context === 'Consultorio');
    if (!office.length) return 'Este mes no hay cobros ni pagos del consultorio.';
    return [...new Set(office.map(r => r.currency))].map(currency => {
      const cash = officeCash(office.filter(r => r.currency === currency));
      return `Este mes el consultorio recibió ${format(cash.received, currency)} y pagó ${format(cash.paid, currency)}. Resultado de caja: ${format(cash.net, currency)}${cash.expensePercent !== null ? `; ${Math.round(cash.expensePercent)}% de los cobros se fue en gastos` : ''}.`;
    }).join('\n') + '\nIncluye abonos; no es utilidad.';
  }
  if (/abono|apartad|reserv|tratamiento/.test(q)) return `Tienes ${values(snapshot.reserved_by_currency)} apartados y ${snapshot.patient_advances_pending.length} abonos pendientes.`;
  if (/comision|fee/.test(q)) return `Has pagado ${values(snapshot.transfer_fees_by_currency)} en comisiones de transferencias registradas.`;
  if (/cuenta|bancolombia|\barq\b|efectivo/.test(q)) {
    const accounts = snapshot.accounts.filter(a => !/bancolombia|\barq\b/.test(q) || q.includes(a.name.toLowerCase()));
    return accounts.length ? accounts.map(a => `${a.name}: ${format(a.balance, a.currency || 'COP')}`).join('\n') + '\nSegún los saldos registrados.' : 'No encuentro esa cuenta registrada.';
  }
  if (/disponible|saldo|cuanto tengo|dinero tengo/.test(q)) return `Tienes ${values(snapshot.available_by_currency)} disponibles y ${values(snapshot.reserved_by_currency)} apartados.`;
  if (/ingreso|entrada|recibi|cobro/.test(q)) {
    const totals: Record<string,number> = {};
    for (const r of rows.filter(r => r.kind === 'income')) totals[r.currency] = Math.round(((totals[r.currency] || 0) + r.amount) * 100) / 100;
    return `Este mes has recibido ${values(totals)}. Incluye abonos pendientes.`;
  }
  if (/gasto|gaste|pague|salida|personal/.test(q)) {
    const spending = rows.filter(r => r.kind === 'expense' && (!/personal/.test(q) || r.context === 'Personal'));
    if (!spending.length) return `Este mes no hay gastos${/personal/.test(q) ? ' personales' : ''} registrados.`;
    return [...new Set(spending.map(r => r.currency))].map(currency => {
      const totals = new Map<string,number>();
      for (const r of spending.filter(r => r.currency === currency)) { const label = `${r.context} · ${r.category}`; totals.set(label, Math.round(((totals.get(label) || 0) + r.amount) * 100) / 100); }
      const sorted = [...totals].sort((a,b) => b[1] - a[1]);
      return `Este mes gastaste ${format(sorted.reduce((s,[,v]) => s+v,0),currency)}.\n` + sorted.slice(0,3).map(([name,amount]) => `${name}: ${format(amount,currency)}`).join('\n');
    }).join('\n');
  }
  return 'Puedo consultar gastos, ingresos, disponible, cuentas, abonos y comisiones. Ejemplo: «¿Cómo va el consultorio?».';
}

export function rankedExpenseAnswer(snapshot: Snapshot, question: string): string | null {
 const q = question.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
 if (!/\b(mas|mayor|mayores|principal|principales)\b/.test(q) || !/gasto|gaste|gastado|pague|compra|categoria/.test(q)) return null;
 // Other periods stay with the assistant; this verified answer is explicitly for the current month.
 if (/ayer|hoy|semana|anterior|pasado|enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre|\b20\d{2}\b/.test(q)) return null;
 const month=snapshot.as_of.slice(0,7), context=/personal/.test(q)?'Personal':/consultorio/.test(q)?'Consultorio':null;
 const groups=snapshot.expense_rankings.filter(g=>g.month===month&&(!context||g.context===context));
 if (!groups.length) return `Este mes no hay gastos${context ? ` de ${context}` : ''} registrados.`;
 return [...new Set(groups.map(g=>g.currency))].map(currency=>{
  const sameCurrency=groups.filter(g=>g.currency===currency), totals=new Map<string,number>();
  for(const g of sameCurrency)for(const c of g.categories)totals.set(c.category,(totals.get(c.category)||0)+Math.round(c.amount*100));
  const category=[...totals].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]))[0];
  const movement=sameCurrency.flatMap(g=>g.largest_movements).sort((a,b)=>b.amount-a.amount||a.id.localeCompare(b.id))[0];
  const scope=context==='Personal'?'personal':context==='Consultorio'?'del consultorio':'registrado';
  const individual = `Tu gasto ${scope} más alto este mes fue «${movement.description}»: ${format(movement.amount,currency)}`;
  const same = category[0] === movement.category && category[1] === Math.round(movement.amount*100);
  return same ? `${individual}, en ${category[0]}.` : `Este mes gastaste más en ${category[0]}: ${format(category[1]/100,currency)}. ${individual}.`;
 }).join('\n');
}

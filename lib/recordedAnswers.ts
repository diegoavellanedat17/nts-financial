import { officeCash } from './insights.ts';
import type { financeSnapshot } from './chat.ts';
type Snapshot = ReturnType<typeof financeSnapshot>;
const format = (amount: number, currency: string) => `${new Intl.NumberFormat('es-CO', { maximumFractionDigits: currency === 'USD' ? 2 : 0 }).format(amount)} ${currency}`;
function values(totals: Record<string, number>) { const entries = Object.entries(totals).filter(([, amount]) => amount !== 0); return entries.length ? entries.map(([c, a]) => format(a, c)).join(' y ') : '0'; }
export function recordedAnswer(snapshot: Snapshot, question: string): string {
  const q = question.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const month = snapshot.as_of.slice(0, 7), rows = snapshot.monthly_operating.filter(r => r.month === month);
  if (/ayer|semana|anterior|pasado|enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre|\b20\d{2}\b/.test(q)) return 'Por ahora consulto los totales de este mes y los saldos hasta hoy. Para otras fechas, revisa la tabla de movimientos.';
  if (/utilidad|profit|ganancia|rentab/.test(q)) return 'Para estimar utilidad faltan los valores de los tratamientos y sus costos pendientes. Los abonos recibidos no son ganancia.';
  if (/consultorio/.test(q)) {
    const office = rows.filter(r => r.context === 'Consultorio');
    if (!office.length) return `No hay cobros ni pagos del consultorio registrados en ${month}.`;
    return [...new Set(office.map(r => r.currency))].map(currency => {
      const cash = officeCash(office.filter(r => r.currency === currency));
      return `${currency}: cobró ${format(cash.received, currency)}, pagó ${format(cash.paid, currency)}. Resultado de caja: ${format(cash.net, currency)}${cash.expensePercent !== null ? `; ${Math.round(cash.expensePercent)}% de los cobros se fue en gastos` : ''}.`;
    }).join('\n') + `\nPeriodo: ${month}. Incluye abonos; no es utilidad.`;
  }
  if (/abono|apartad|reserv|tratamiento/.test(q)) return `Apartado hasta ${snapshot.as_of}: ${values(snapshot.reserved_by_currency)}. Abonos pendientes: ${snapshot.patient_advances_pending.length}.`;
  if (/comision|fee/.test(q)) return `Comisiones de transferencias registradas hasta ${snapshot.as_of}: ${values(snapshot.transfer_fees_by_currency)}.`;
  if (/cuenta|bancolombia|\barq\b|efectivo/.test(q)) {
    const accounts = snapshot.accounts.filter(a => !/bancolombia|\barq\b/.test(q) || q.includes(a.name.toLowerCase()));
    return accounts.length ? accounts.map(a => `${a.name}: ${format(a.balance, a.currency || 'COP')}`).join('\n') + `\nSaldos registrados al ${snapshot.as_of}.` : 'No encuentro esa cuenta registrada.';
  }
  if (/disponible|saldo|cuanto tengo|dinero tengo/.test(q)) return `Disponible al ${snapshot.as_of}: ${values(snapshot.available_by_currency)}. Apartado: ${values(snapshot.reserved_by_currency)}.`;
  if (/ingreso|entrada|recibi|cobro/.test(q)) {
    const totals: Record<string,number> = {};
    for (const r of rows.filter(r => r.kind === 'income')) totals[r.currency] = Math.round(((totals[r.currency] || 0) + r.amount) * 100) / 100;
    return `Cobros registrados en ${month}: ${values(totals)}. Incluyen abonos pendientes.`;
  }
  if (/gasto|gaste|pague|salida|personal/.test(q)) {
    const spending = rows.filter(r => r.kind === 'expense' && (!/personal/.test(q) || r.context === 'Personal'));
    if (!spending.length) return `No hay gastos${/personal/.test(q) ? ' personales' : ''} registrados en ${month}.`;
    return [...new Set(spending.map(r => r.currency))].map(currency => {
      const totals = new Map<string,number>();
      for (const r of spending.filter(r => r.currency === currency)) { const label = `${r.context} · ${r.category}`; totals.set(label, Math.round(((totals.get(label) || 0) + r.amount) * 100) / 100); }
      const sorted = [...totals].sort((a,b) => b[1] - a[1]);
      return `${month} · ${currency}: ${format(sorted.reduce((s,[,v]) => s+v,0),currency)} en gastos.\n` + sorted.slice(0,3).map(([name,amount]) => `${name}: ${format(amount,currency)}`).join('\n');
    }).join('\n');
  }
  return 'Puedo consultar gastos, ingresos, disponible, cuentas, abonos y comisiones. Ejemplo: «¿Cómo va el consultorio?».';
}

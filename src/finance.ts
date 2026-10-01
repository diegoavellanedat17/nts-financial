import { personTag } from './person';
export const contexts = ['Personal', 'Consultorio', 'Clínica 1', 'Clínica 2'] as const;
export const expenseCategories = ['Alimentación', 'Transporte', 'Hogar', 'Compras', 'Bienestar', 'Arriendo consultorio', 'Materiales', 'Laboratorio', 'Servicios', 'Otros'] as const;
export const incomeCategories = ['Consulta', 'Tratamiento', 'Honorarios', 'Otros'] as const;
export type Currency = 'COP' | 'USD';
export type Context = typeof contexts[number];
export type Transaction = {
  currency?: Currency;
  id: string; date: string; kind: 'income' | 'expense'; amount: number;
  context: Context; category: string; description: string;
  reserved: number; from_reserve: boolean;
  source_id?: string | null;
  competence_date?: string;
  flow_type?: FlowType;
  user_id?: string;
  person_tag?: string;
  counterparty?: string;
  reference?: string;
  payment_method?: PaymentMethod;

};
export const paymentMethods = { unspecified: 'Sin especificar', cash: 'Efectivo', bank_transfer: 'Transferencia', debit_card: 'Tarjeta débito', credit_card: 'Tarjeta crédito', other: 'Otro' };
export type PaymentMethod = keyof typeof paymentMethods;
export type FlowType = 'operating' | 'opening_balance' | 'financing' | 'transfer';
export const flowLabels: Record<FlowType, string> = { operating: 'Ingreso o gasto normal', opening_balance: 'Saldo inicial', financing: 'Préstamo / financiación', transfer: 'Transferencia entre cuentas' };
export type IncomeSource = { id: string; name: string; context: Context };
export function defaultSources(tag = personTag): IncomeSource[] {
  return (tag === 'diego' ? ['Personal'] as const : contexts).map(context => ({ id: crypto.randomUUID(), name: context === 'Personal' ? 'Otro ingreso' : context, context }));
}
export function normalizeTransaction(t: Transaction, sources: IncomeSource[] = []): Transaction {
  return { ...t, currency: t.currency || 'COP', person_tag: t.person_tag || personTag, counterparty: t.counterparty || '', reference: t.reference || '', payment_method: t.payment_method || 'unspecified', competence_date: t.competence_date || t.date, flow_type: t.flow_type || 'operating', source_id: t.kind === 'income' ? t.source_id || sources.find(s => s.context === t.context)?.id || null : null };
}
export function spendingByCategory(rows: Transaction[], month: string, context: string = 'Todos', currency: Currency = 'COP') {
  const totals = new Map<string, number>();
  for (const t of rows) {
    if ((t.currency || 'COP') !== currency || t.kind !== 'expense' || (t.flow_type || 'operating') !== 'operating' || !t.date.startsWith(month) || (context !== 'Todos' && t.context !== context)) continue;
    totals.set(t.category, Math.round(((totals.get(t.category) || 0) + t.amount) * 100) / 100);
  }
  return [...totals].map(([category, amount]) => ({ category, amount })).sort((a, b) => b.amount - a.amount);
}
export type Budgets = Record<string, number>;
export const money = (amount: number, currency: Currency = 'COP') => `${new Intl.NumberFormat('es-CO', { style: 'currency', currency, minimumFractionDigits: currency === 'USD' ? 2 : 0, maximumFractionDigits: currency === 'USD' ? 2 : 0 }).format(amount)} ${currency}`;
function sumMoney(rows: Transaction[], value: (t: Transaction) => number) { return rows.reduce((s,t)=>s+Math.round(value(t)*100),0)/100; }
export function today() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function validateTransaction(t: Transaction): string | null {
  if (t.person_tag && !/^[a-z][a-z0-9_]{0,39}$/.test(t.person_tag)) return 'Selecciona una persona válida.';
  if ((t.counterparty?.length || 0) > 120 || (t.reference?.length || 0) > 120) return 'La referencia y el tercero admiten hasta 120 caracteres.';
  if (t.payment_method && !Object.hasOwn(paymentMethods, t.payment_method)) return 'Selecciona un medio de pago válido.';
  if (t.kind !== 'income' && t.kind !== 'expense') return 'Selecciona un tipo válido.';
  if (t.flow_type && !Object.hasOwn(flowLabels, t.flow_type)) return 'Selecciona un tipo de movimiento válido.';
  if (t.competence_date && (!/^\d{4}-\d{2}-\d{2}$/.test(t.competence_date) || Number.isNaN(Date.parse(t.competence_date)) || new Date(`${t.competence_date}T12:00:00Z`).toISOString().slice(0, 10) !== t.competence_date)) return 'Selecciona una fecha de periodo válida.';
  const currency = t.currency || 'COP';
  if (!['COP','USD'].includes(currency)) return 'Selecciona COP o USD.';
  const validPrecision = (value: number) => currency === 'COP' ? Number.isSafeInteger(value) : Number.isFinite(value) && Math.abs(value * 100 - Math.round(value * 100)) < 0.000001;
  if (!validPrecision(t.amount) || t.amount <= 0 || t.amount > 999_999_999) return currency === 'USD' ? 'Ingresa un monto positivo de hasta 2 decimales.' : 'Ingresa un monto entero entre $1 y $999.999.999.';
  if (!validPrecision(t.reserved) || t.reserved < 0 || t.reserved > t.amount) return 'El dinero separado no puede superar el ingreso.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t.date) || Number.isNaN(Date.parse(t.date)) || new Date(`${t.date}T12:00:00Z`).toISOString().slice(0, 10) !== t.date) return 'Selecciona una fecha válida.';
  if (!contexts.includes(t.context)) return 'Selecciona un origen válido.';
  if (!(t.kind === 'income' ? incomeCategories : expenseCategories).some(c => c === t.category)) return 'Selecciona una categoría válida.';
  if (t.description.trim().length === 0 || t.description.length > 4000) return 'Escribe una concepto de máximo 4000 caracteres.';
  if (t.kind === 'expense' && t.reserved !== 0) return 'Solo puedes separar dinero de un ingreso.';
  if (t.kind === 'income' && t.from_reserve) return 'Solo un gasto puede pagarse con dinero separado.';
  if (t.context === 'Personal' && (t.reserved > 0 || t.from_reserve)) return 'El dinero para tratamientos pertenece a los espacios de trabajo.';
  return null;
}
export function summarize(rows: Transaction[], month: string, currency: Currency = 'COP') {
  const all = rows.filter(t => (t.currency || 'COP') === currency);
  const monthly = all.filter(t => t.date.startsWith(month));
  const income = sumMoney(monthly.filter(t => t.kind === 'income'), t => t.amount);
  const expenses = sumMoney(monthly.filter(t => t.kind === 'expense'), t => t.amount);
  // Los saldos se acumulan hasta el cierre del mes; las reservas no caducan al cambiar de mes.
  const history = all.filter(t => t.date.slice(0, 7) <= month);
  const cash = sumMoney(history,t => t.kind === 'income' ? t.amount : -t.amount);
  const reserves = Object.fromEntries(contexts.map(context => [context, Math.max(0, sumMoney(history.filter(t => t.context === context),t => t.kind === 'income' ? t.reserved : t.from_reserve ? -t.amount : 0))])) as Record<Context, number>;
  const reserved = Math.round(Object.values(reserves).reduce((a, b) => a + b, 0) * 100) / 100;
  return { monthly, income, expenses, cash, reserves, reserved, available: Math.round((cash - reserved) * 100) / 100 };
}
// Derived values at today's rate; never persist these as native transactions.
export function rowsInCop(rows: Transaction[], copPerUsd: number): Transaction[] {
  if (!Number.isFinite(copPerUsd) || copPerUsd <= 0) throw new Error('La TRM debe ser positiva.');
  return rows.map(row => (row.currency || 'COP') === 'USD' ? { ...row, currency: 'COP', amount: Math.round(row.amount * copPerUsd * 100) / 100, reserved: Math.round(row.reserved * copPerUsd * 100) / 100 } : row);
}
export function summarizeInCop(rows: Transaction[], month: string, copPerUsd: number) {
  const cop = summarize(rows, month, 'COP');
  const usd = summarize(rows, month, 'USD');
  const combine = (pesos: number, dollars: number) => Math.round((pesos + dollars * copPerUsd) * 100) / 100;
  // Keep reservations separate before conversion: COP expenses cannot use USD reserves.
  const reserves = Object.fromEntries(contexts.map(context => [context, combine(cop.reserves[context], usd.reserves[context])])) as Record<Context, number>;
  const cash = combine(cop.cash, usd.cash), reserved = combine(cop.reserved, usd.reserved);
  return { monthly: rowsInCop([...cop.monthly, ...usd.monthly], copPerUsd), income: combine(cop.income, usd.income), expenses: combine(cop.expenses, usd.expenses), cash, reserves, reserved, available: Math.round((cash - reserved) * 100) / 100 };
}
export function demoTransactions(): Transaction[] {
  const month = today().slice(0, 7);
  const d = (day: number) => `${month}-${String(Math.min(day, Number(today().slice(8)))).padStart(2, '0')}`;
  return [
    { id: crypto.randomUUID(), date: d(1), kind: 'income', amount: 2400000, context: 'Clínica 1', category: 'Honorarios', description: 'Honorarios de la clínica', reserved: 0, from_reserve: false },
    { id: crypto.randomUUID(), date: d(2), kind: 'income', amount: 1800000, context: 'Clínica 2', category: 'Honorarios', description: 'Jornadas de atención', reserved: 0, from_reserve: false },
    { id: crypto.randomUUID(), date: d(3), kind: 'income', amount: 1600000, context: 'Consultorio', category: 'Tratamiento', description: 'Abono de tratamiento', reserved: 650000, from_reserve: false },
    { id: crypto.randomUUID(), date: d(3), kind: 'expense', amount: 850000, context: 'Consultorio', category: 'Arriendo consultorio', description: 'Arriendo del mes', reserved: 0, from_reserve: false },
    { id: crypto.randomUUID(), date: d(4), kind: 'expense', amount: 240000, context: 'Consultorio', category: 'Laboratorio', description: 'Trabajo de laboratorio', reserved: 0, from_reserve: true },
    { id: crypto.randomUUID(), date: d(5), kind: 'expense', amount: 185000, context: 'Personal', category: 'Alimentación', description: 'Mercado de la semana', reserved: 0, from_reserve: false },
    { id: crypto.randomUUID(), date: d(5), kind: 'expense', amount: 68000, context: 'Personal', category: 'Transporte', description: 'Transportes de la semana', reserved: 0, from_reserve: false },
    { id: crypto.randomUUID(), date: d(6), kind: 'expense', amount: 120000, context: 'Personal', category: 'Bienestar', description: 'Un espacio para mí', reserved: 0, from_reserve: false },
  ];
}
export function exportCsv(rows: Transaction[], sources: IncomeSource[] = [], userId = 'demo') {
  const cell = (value: string | number) => `"${(typeof value === 'string' ? value.replace(/^[\s]*[=+@\-]/, "'$&") : String(value)).replaceAll('"', '""')}"`;
  const headers = ['ID movimiento', 'ID persona', 'Fecha pago', 'Fecha periodo', 'Tipo', 'Clasificación', 'Espacio', 'ID fuente', 'Fuente ingreso', 'Categoría', 'Descripción', 'Moneda', 'Monto', 'Flujo neto', 'Separado', 'Pagado con reserva', 'Persona', 'Tercero', 'Referencia', 'Medio de pago'];
  const data = rows.map(row => {
    const t = normalizeTransaction(row);
    const source = sources.find(s => s.id === t.source_id);
    return [t.id, t.user_id || userId, t.date, t.competence_date!, t.kind === 'income' ? 'Ingreso' : 'Gasto', t.flow_type!, t.context, t.source_id || '', t.kind === 'income' ? source?.name || t.context : '', t.category, t.description, t.currency!, t.amount, t.kind === 'income' ? t.amount : -t.amount, t.reserved, t.from_reserve ? 'Sí' : 'No', t.person_tag!, t.counterparty!, t.reference!, paymentMethods[t.payment_method!]];
  });
  return '\uFEFF' + [headers, ...data].map(row => row.map(cell).join(';')).join('\r\n');
}

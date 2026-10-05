type Movement = { kind: string; amount: number; context: string; flow_type?: string };
export function officeCash(rows: Movement[]) {
  const office = rows.filter(t => t.context === 'Consultorio' && (t.flow_type || 'operating') === 'operating');
  const sum = (kind: string) => office.filter(t => t.kind === kind).reduce((total, t) => total + Math.round(Number(t.amount) * 100), 0) / 100;
  const received = sum('income'), paid = sum('expense');
  return { received, paid, net: Math.round((received - paid) * 100) / 100, expensePercent: received > 0 ? paid / received * 100 : null };
}
// A monthly cash comparison, not profit or the balance of a bank account.
export function officeAfterReserves(rows: (Movement & { reserved?: number; from_reserve?: boolean; patient_advance?: boolean; reserve_release_date?: string | null })[], asOf: string) {
  const office = rows.filter(t => t.context === 'Consultorio' && (t.flow_type || 'operating') === 'operating');
  const cents = (amount: number) => Math.round(Number(amount) * 100);
  const pending = office.filter(t => t.kind === 'income' && (!t.reserve_release_date || t.reserve_release_date > asOf));
  const protectedCents = pending.filter(t => t.patient_advance).reduce((n,t) => n + cents(t.reserved || 0), 0);
  const otherCents = pending.filter(t => !t.patient_advance).reduce((n,t) => n + cents(t.reserved || 0), 0);
  const spentFromReserves = office.filter(t => t.kind === 'expense' && t.from_reserve).reduce((n,t) => n + cents(t.amount), 0);
  const reserved = (protectedCents + Math.max(0, otherCents - spentFromReserves)) / 100;
  return { reserved, net: Math.round((officeCash(office).net - reserved) * 100) / 100 };
}
export function expenseShares(rows: Movement[]) {
  const totals = { Personal: 0, Consultorio: 0, Clínicas: 0 };
  for (const row of rows) {
    if (row.kind !== 'expense' || (row.flow_type || 'operating') !== 'operating') continue;
    const group = row.context === 'Personal' ? 'Personal' : row.context === 'Consultorio' ? 'Consultorio' : 'Clínicas';
    totals[group] += Math.round(Number(row.amount) * 100);
  }
  const total = Object.values(totals).reduce((a, b) => a + b, 0);
  return Object.entries(totals).filter(([, cents]) => cents > 0).map(([name, cents]) => ({name, amount: cents / 100, percent: total ? cents / total * 100 : 0}));
}

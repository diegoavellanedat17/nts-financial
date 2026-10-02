type Movement = { kind: string; amount: number; context: string; flow_type?: string };
export function officeCash(rows: Movement[]) {
  const office = rows.filter(t => t.context === 'Consultorio' && (t.flow_type || 'operating') === 'operating');
  const sum = (kind: string) => office.filter(t => t.kind === kind).reduce((total, t) => total + Math.round(Number(t.amount) * 100), 0) / 100;
  const received = sum('income'), paid = sum('expense');
  return { received, paid, net: Math.round((received - paid) * 100) / 100, expensePercent: received > 0 ? paid / received * 100 : null };
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

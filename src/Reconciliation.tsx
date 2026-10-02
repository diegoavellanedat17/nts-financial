import { money, today, type Transaction } from './finance';
import type { Account } from './Accounts';

export function Reconciliation({ items, accounts }: { items: Transaction[]; accounts: Account[] }) {
  const rows = items.filter(t => t.balance_check_id && t.date <= today()).sort((a,b) => b.date.localeCompare(a.date));
  if (!rows.length) return null;
  return <details className="reconciliation"><summary>Otros · Conciliación</summary><p>Dinero sin concepto. Ya incluido en tus cuentas.</p><div className="reconciliation-totals">{(['COP', 'USD'] as const).map(currency => {
    const own = rows.filter(t => (t.currency || 'COP') === currency);
    if (!own.length) return null;
    const net = own.reduce((sum,t) => sum + (t.kind === 'income' ? 1 : -1) * Math.round(t.amount*100),0)/100;
    return <span key={currency}>Sin identificar · neto<strong>{money(net, currency)}</strong></span>;
  })}</div><div className="movements-table-wrap"><table className="movements-table"><thead><tr><th>Fecha</th><th>Cuenta</th><th>Diferencia</th></tr></thead><tbody>{rows.map(t => <tr key={t.id}><td><time dateTime={t.date}>{new Intl.DateTimeFormat('es-CO').format(new Date(`${t.date}T12:00:00`))}</time></td><td>{accounts.find(a => a.id === t.account_id)?.name || 'Cuenta'}</td><td>{t.kind === 'income' ? '+' : '−'}{money(t.amount,t.currency || 'COP')}</td></tr>)}</tbody></table></div></details>;
}

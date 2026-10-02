import { expenseShares, officeCash } from '../lib/insights';
import { money, type Currency, type Transaction } from './finance';
export function OfficeChart({ rows, currency }: { rows: Transaction[]; currency: Currency }) {
  const cash = officeCash(rows), scale = Math.max(cash.received, cash.paid, 1);
  return <div className="office-cash-chart">
    <div className="office-totals">
      <span>Cobró<strong>{money(cash.received, currency)}</strong><i style={{ width: `${cash.received / scale * 100}%` }} /></span>
      <span>Pagó<strong>{money(cash.paid, currency)}</strong><i className="cash-paid" style={{ width: `${cash.paid / scale * 100}%` }} /></span>
    </div>
    <div className="office-result"><span>Resultado de caja<strong className={cash.net < 0 ? 'cash-negative' : ''}>{cash.net > 0 ? '+' : ''}{money(cash.net, currency)}</strong></span>{cash.expensePercent !== null && <span className="cash-ratio">{Math.round(cash.expensePercent)}%<small>de cobros en gastos</small></span>}</div>
    <small className="cash-caption">Incluye abonos. No es utilidad.</small>
  </div>;
}
export function SpendingSplit({ rows, currency }: { rows: Transaction[]; currency: Currency }) {
  const shares = expenseShares(rows);
  return <div className="spending-split"><h2>¿En qué se fue el dinero?</h2>{shares.length ? <>
    <div className="expense-share-bar" role="img" aria-label={shares.map(s => `${s.name}: ${Math.round(s.percent)}%`).join(', ')}>{shares.map(s => <span key={s.name} className={`share-${s.name === 'Personal' ? 'personal' : s.name === 'Consultorio' ? 'office' : 'clinics'}`} style={{width: `${s.percent}%`}} />)}</div>
    <div className="expense-share-labels">{shares.map(s => <span key={s.name}><strong>{s.name} · {Math.round(s.percent)}%</strong><small>{money(s.amount, currency)}</small></span>)}</div>
  </> : <p className="empty-note">Sin gastos este mes.</p>}</div>;
}

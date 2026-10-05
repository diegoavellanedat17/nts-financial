import { expenseShares, officeCash, officeAfterReserves } from '../lib/insights';
import { money, today, type Currency, type Transaction } from './finance';
export function OfficeChart({ rows, currency }: { rows: Transaction[]; currency: Currency }) {
  const cash = officeCash(rows), scale = Math.max(cash.received, cash.paid, 1), free = officeAfterReserves(rows, today());
  return <div className="office-cash-chart">
    <div className="office-totals">
      <span>Cobró<strong>{money(cash.received, currency)}</strong><i style={{ width: `${cash.received / scale * 100}%` }} /></span>
      <span>Pagó<strong>{money(cash.paid, currency)}</strong><i className="cash-paid" style={{ width: `${cash.paid / scale * 100}%` }} /></span>
    </div>
    <div className="office-result"><span>{free.net < 0 ? 'Los pagos superaron los cobros libres en' : 'Queda de los cobros libres'}<strong className={free.net < 0 ? 'cash-negative' : ''}>{money(Math.abs(free.net), currency)}</strong></span>{free.reserved > 0 && <span className="cash-ratio">{money(free.reserved, currency)}<small>apartado de estos cobros</small></span>}</div>
    <small className="cash-caption">Cobros del mes menos pagos y dinero apartado. No es utilidad.</small>
  </div>;
}
export function SpendingSplit({ rows, currency }: { rows: Transaction[]; currency: Currency }) {
  const shares = expenseShares(rows);
  return <div className="spending-split"><h2>¿En qué se fue el dinero?</h2>{shares.length ? <>
    <div className="expense-share-bar" role="img" aria-label={shares.map(s => `${s.name}: ${Math.round(s.percent)}%`).join(', ')}>{shares.map(s => <span key={s.name} className={`share-${s.name === 'Personal' ? 'personal' : s.name === 'Consultorio' ? 'office' : 'clinics'}`} style={{width: `${s.percent}%`}} />)}</div>
    <div className="expense-share-labels">{shares.map(s => <span key={s.name}><strong>{s.name} · {Math.round(s.percent)}%</strong><small>{money(s.amount, currency)}</small></span>)}</div>
  </> : <p className="empty-note">Sin gastos este mes.</p>}</div>;
}

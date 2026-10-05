import { useState } from 'react';
import { Pencil } from 'lucide-react';
import { expenseCategories, money, spendingByCategory, today, type Currency, type Transaction } from './finance';

const colors = ['#d18a45', '#597eab', '#176b58', '#9474b4', '#b95e70', '#658675', '#82984d', '#9b775c', '#428b98', '#929990', '#ad704e'];
const label = (category: string) => category === 'Otros' ? 'Otros / sin clasificar' : category;
export function SpendingDonut({ rows, currency, isDental = false, onCategorize, busy = false }: { rows: Transaction[]; currency: Currency; isDental?: boolean; onCategorize?: (id: string) => void; busy?: boolean }) {
  const [selection, setSelection] = useState<string | null>(null);
  const [context, setContext] = useState<'Personal' | 'Consultorio'>('Personal');
  const month = today().slice(0, 7);
  const expenses = rows.filter(t => (!isDental || t.context === context) && t.date <= today() && t.date.startsWith(month) && t.kind === 'expense' && (t.flow_type || 'operating') === 'operating' && (t.currency || 'COP') === currency);
  const totals = spendingByCategory(expenses, month, 'Todos', currency);
  const total = Math.round(totals.reduce((n,t) => n + t.amount, 0) * 100) / 100;
  const selected = totals.find(t => t.category === selection);
  let offset = 0;
  const slices = totals.map(t => {
    const percent = t.amount / total * 100, start = offset;
    offset += percent;
    const color = colors[Math.max(0, expenseCategories.indexOf(t.category as typeof expenseCategories[number]))];
    return { ...t, percent, color, stop: `${color}${selected && selected.category !== t.category ? '40' : ''} ${start}% ${offset}%` };
  });
  const details = selected ? expenses.filter(t => t.category === selected.category).sort((a,b) => b.amount - a.amount || b.date.localeCompare(a.date)) : [];
  return <section className="category-chart" aria-label="Gastos por categoría">
    <div className="category-chart-heading"><h2>¿En qué gastaste?</h2><span>Este mes</span></div>
    {isDental && <div className="currency-switch category-context" role="group" aria-label="Espacio de los gastos">{(['Personal','Consultorio'] as const).map(c => <button key={c} aria-label={c === 'Personal' ? 'Ver gastos personales' : 'Ver gastos del consultorio'} aria-pressed={context === c} onClick={() => { setContext(c); setSelection(null); }}>{c}</button>)}</div>}
    {total > 0 ? <>
      <div className="category-donut" role="img" aria-label={slices.map(t => `${label(t.category)}: ${money(t.amount, currency)}, ${t.percent.toFixed(1)}%`).join('; ')} style={{ background: `conic-gradient(${slices.map(t => t.stop).join(',')})` }}>
        <div><span>{selected ? label(selected.category) : isDental ? context === 'Personal' ? 'Gastos personales' : 'Gastos del consultorio' : 'Gastos del mes'}</span><strong>{money(selected?.amount ?? total, currency)}</strong>{selected && <small>{new Intl.NumberFormat('es-CO', { maximumFractionDigits: 1 }).format(selected.amount / total * 100)}% del total</small>}</div>
      </div>
      <ul className="category-legend">{slices.map(t => <li key={t.category}><button type="button" aria-pressed={selected?.category === t.category} aria-label={`Ver gastos de ${label(t.category)}`} onClick={() => setSelection(selected?.category === t.category ? null : t.category)}><span className="category-dot" style={{ background: t.color }} /><span className="category-name">{label(t.category)}<i style={{ width: `${t.percent}%`, background: t.color }} /></span><span className="category-numbers"><strong>{money(t.amount, currency)}</strong><small>{new Intl.NumberFormat('es-CO', { maximumFractionDigits: 1 }).format(t.percent)}%</small></span></button></li>)}</ul>
      {selected && <div className="category-detail" aria-label={`Movimientos de ${label(selected.category)}`}><div><h3>{label(selected.category)}</h3><button className="show-more" onClick={() => setSelection(null)}>Ver total</button></div><ul>{details.map(t => <li key={t.id}><span>{t.description}<small>{new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'short' }).format(new Date(`${t.date}T12:00:00`))}</small></span><strong>{money(t.amount, currency)}</strong>{onCategorize && <button type="button" className="clarification-pencil" aria-label={`Categorizar ${t.description}`} disabled={busy} onClick={() => onCategorize(t.id)}><Pencil size={16} /></button>}</li>)}</ul></div>}
    </> : <p className="empty-note">Sin gastos registrados este mes en {isDental ? `${context} · ` : ''}{currency}.</p>}
  </section>;
}

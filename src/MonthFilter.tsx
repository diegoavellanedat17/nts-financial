import { ChevronLeft, ChevronRight } from 'lucide-react';
import { today } from './finance';

export function monthLabel(month: string) {
  const label = new Intl.DateTimeFormat('es-CO', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${month}-01T12:00:00Z`));
  return label.charAt(0).toUpperCase() + label.slice(1);
}
export function MonthFilter({ month, onChange, firstMonth }: { month: string; onChange: (month: string) => void; firstMonth?: string }) {
  const current = today().slice(0, 7);
  const first = `${Number(current.slice(0, 4)) - 1}-${current.slice(5)}`;
  const earliest = firstMonth && firstMonth < first ? firstMonth : first;
  const months: string[] = [];
  for (let date = new Date(`${current}-01T12:00:00Z`); date.toISOString().slice(0, 7) >= earliest; date.setUTCMonth(date.getUTCMonth() - 1)) months.push(date.toISOString().slice(0, 7));
  const index = months.indexOf(month);
  return <section className="month-filter" aria-label="Filtro por mes">
    <label htmlFor="selected-month">¿Qué mes quieres ver?</label>
    <div className="month-controls">
      <button type="button" aria-label="Mes anterior" disabled={index === months.length - 1} onClick={() => onChange(months[index + 1])}><ChevronLeft size={20} /></button>
      <select id="selected-month" value={month} onChange={e => onChange(e.target.value)}>{months.map(value => <option key={value} value={value}>{monthLabel(value)}</option>)}</select>
      <button type="button" aria-label="Mes siguiente" disabled={index <= 0} onClick={() => onChange(months[index - 1])}><ChevronRight size={20} /></button>
    </div>
    {month !== current && <button type="button" className="show-more" onClick={() => onChange(current)}>Volver al mes actual</button>}
    <small>Ingresos, gastos y movimientos del mes elegido. Los saldos de tus cuentas son de hoy.</small>
  </section>;
}

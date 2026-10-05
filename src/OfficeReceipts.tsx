import { Pencil } from 'lucide-react';
import { clarificationQuestion } from '../lib/clarifications';
import { money, today, type Transaction } from './finance';

export function OfficeReceipts({ items, busy, onRelease, onClarify, personTag }: { items: Transaction[]; busy: boolean; onRelease: (t: Transaction) => Promise<void>; onClarify: (t: Transaction) => void; personTag: string }) {
  const receipts = items.filter(t => t.kind === 'income' && t.context === 'Consultorio' &&
    (t.flow_type || 'operating') === 'operating' && t.date <= today())
    .sort((a, b) => b.date.localeCompare(a.date));
  return <details className="office-receipts">
    <summary>Ver cobros y abonos</summary>
    {receipts.length ? <div className="receipts-scroll" role="region" aria-label="Cobros del consultorio" tabIndex={0}>
      <table className="receipts-table">
        <thead><tr><th>Fecha</th><th>Concepto</th><th>Recibido</th><th>Apartado</th></tr></thead>
        <tbody>{receipts.map(t => {
          const delivered = !!t.reserve_release_date && t.reserve_release_date <= today();
          return <tr key={t.id}>
            <td><time dateTime={t.date}>{new Intl.DateTimeFormat('es-CO', {day:'2-digit',month:'2-digit',year:'numeric'}).format(new Date(`${t.date}T12:00:00`))}</time></td>
            <td className="receipt-concept"><strong title={t.description}>{t.counterparty || t.reference || t.description}</strong>{(t.counterparty || t.reference) && <small title={t.description}>{t.description}</small>}{clarificationQuestion(t, personTag) && <button className="clarification-pencil" aria-label={`Aclarar ${t.description}`} title={clarificationQuestion(t, personTag)!} disabled={busy} onClick={() => onClarify(t)}><Pencil size={16} /></button>}</td>
            <td className="receipt-money">{money(t.amount, t.currency || 'COP')}</td>
            <td className="receipt-money">{money(delivered ? 0 : t.reserved, t.currency || 'COP')}{delivered ? <small>Entregado · {t.reserve_release_date}</small> : t.patient_advance ? <><small>Pendiente</small><button className="receipt-release" disabled={busy} onClick={() => void onRelease(t)}>Entregado</button></> : null}</td>
          </tr>;
        })}</tbody>
      </table>
    </div> : <p className="empty-note">Sin cobros registrados.</p>}
  </details>;
}

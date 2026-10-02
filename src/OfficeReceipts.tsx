import { money, today, type Transaction } from './finance';

export function OfficeReceipts({ items }: { items: Transaction[] }) {
  const receipts = items.filter(t => t.kind === 'income' && t.context === 'Consultorio' &&
    (t.flow_type || 'operating') === 'operating' && t.date <= today())
    .sort((a, b) => b.date.localeCompare(a.date));
  return <details className="office-receipts">
    <summary>Ver cobros y abonos</summary>
    <p className="receipts-hint">Cada fila es un cobro registrado; puede incluir varios pacientes. El nombre o la referencia aparecerán cuando los agregues en los detalles del ingreso.</p>
    {receipts.length ? <div className="receipts-scroll" role="region" aria-label="Cobros del consultorio" tabIndex={0}>
      <table className="receipts-table">
        <thead><tr><th>Fecha</th><th>Paciente / caso y concepto</th><th>Recibido</th><th>Apartado registrado</th></tr></thead>
        <tbody>{receipts.map(t => {
          const delivered = !!t.reserve_release_date && t.reserve_release_date <= today();
          return <tr key={t.id}>
            <td><time dateTime={t.date}>{new Intl.DateTimeFormat('es-CO', {day:'2-digit',month:'2-digit',year:'numeric'}).format(new Date(`${t.date}T12:00:00`))}</time></td>
            <td className="receipt-concept"><strong>{t.counterparty || (t.reference ? `Caso ${t.reference}` : 'Por identificar')}</strong>{t.counterparty && t.reference && <small>Referencia: {t.reference}</small>}<p>{t.description}</p></td>
            <td className="receipt-money">{money(t.amount, t.currency || 'COP')}</td>
            <td className="receipt-money">{money(delivered ? 0 : t.reserved, t.currency || 'COP')}<small>{delivered ? `Entregado · ${t.reserve_release_date}` : t.patient_advance ? 'Tratamiento pendiente' : t.reserved > 0 ? 'Reserva de materiales' : 'Estado del tratamiento no indicado'}</small></td>
          </tr>;
        })}</tbody>
      </table>
    </div> : <p className="empty-note">Aquí aparecerán los ingresos que registres en Consultorio.</p>}
    <p className="receipts-hint">Todavía no calculamos cuánto falta cobrar: necesitamos el valor acordado de cada tratamiento. Los pagos de laboratorio pueden cubrir varios casos y se mantienen como gastos generales.</p>
  </details>;
}

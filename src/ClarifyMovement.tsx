import { useState, type FormEvent } from 'react';
import { suggestedExpenseCategory } from '../lib/clarifications';
import { expenseCategories, money, type Transaction } from './finance';
import { MoneyInput } from './MoneyInput';

export type ClarificationPatch = Pick<Transaction, 'description' | 'context' | 'category' | 'reserved' | 'patient_advance' | 'from_reserve'>;
export function ClarifyMovement({ transaction: t, question, busy, error, onSave }: {
  transaction: Transaction; question: string; busy: boolean; error: string;
  onSave: (patch: ClarificationPatch) => Promise<void>;
}) {
  const [description, setDescription] = useState(t.description);
  const [context, setContext] = useState(t.context);
  const [category, setCategory] = useState(suggestedExpenseCategory(t));
  const [delivery, setDelivery] = useState<'done' | 'pending' | 'mixed' | ''>('');
  const [reserved, setReserved] = useState('');
  const [message, setMessage] = useState('');
  function submit(e: FormEvent) {
    e.preventDefault(); setMessage('');
    if (t.kind === 'expense' && category === 'Otros') { setMessage('Elige una categoría.'); return; }
    if (t.kind === 'income' && !delivery) { setMessage('Elige si los tratamientos están entregados o pendientes.'); return; }
    const reserve = t.kind === 'income' ? delivery === 'pending' ? t.amount : delivery === 'mixed' ? Number(reserved) : 0 : t.reserved;
    if (delivery === 'mixed' && (!reserved || reserve <= 0 || reserve >= t.amount)) { setMessage('Indica cuánto sigue pendiente: mayor que cero y menor que el cobro.'); return; }
    void onSave({ description: description.trim(), context, category: t.kind === 'income' ? 'Tratamiento' : category,
      reserved: reserve, patient_advance: t.kind === 'income' ? delivery === 'pending' : t.patient_advance,
      from_reserve: context === 'Personal' ? false : t.from_reserve });
  }
  return <form className="clarify-form" onSubmit={submit}>
    <p className="clarify-amount">{money(t.amount, t.currency || 'COP')} · {t.date.split('-').reverse().join('/')}</p>
    <p className="clarify-question">{question}</p>
    <fieldset disabled={busy}>
      <label>Concepto<textarea required maxLength={4000} rows={2} value={description} onChange={e => setDescription(e.target.value)} /></label>
      {t.kind === 'expense' ? <>
        {t.person_tag === 'natalia' && <label>¿Para quién?<select value={context} onChange={e => { const next = e.target.value as Transaction['context']; setContext(next); if (next === 'Personal' && ['Laboratorio', 'Materiales', 'Arriendo consultorio'].includes(category)) setCategory('Otros'); }}><option>Personal</option><option>Consultorio</option></select></label>}
        <label>Categoría<select value={category} onChange={e => setCategory(e.target.value)}>{expenseCategories.filter(c => context !== 'Personal' || !['Laboratorio', 'Materiales', 'Arriendo consultorio'].includes(c)).map(c => <option key={c}>{c}</option>)}</select></label>
      </> : <>
        <div className="delivery-choices" role="group" aria-label="Estado de los tratamientos">{([['done','Ya entregados'],['pending','Aún pendientes'],['mixed','Hay de ambos']] as const).map(([value,label]) => <button type="button" key={value} aria-pressed={delivery === value} onClick={() => setDelivery(value)}>{label}</button>)}</div>
        {delivery === 'mixed' && <label>¿Cuánto hay que apartar?<MoneyInput value={reserved} onValueChange={setReserved} currency={t.currency || 'COP'} min="0" max={t.amount} step={t.currency === 'USD' ? 0.01 : 1} /></label>}
        {delivery === 'pending' && <small>Se apartarán {money(t.amount, t.currency || 'COP')}. El saldo de la cuenta no cambia.</small>}
      </>}
    </fieldset>
    {(message || error) && <p className="error" role="alert">{message || error}</p>}
    <button className="primary form-submit" disabled={busy}>{busy ? 'Guardando…' : 'Guardar respuesta'}</button>
  </form>;
}

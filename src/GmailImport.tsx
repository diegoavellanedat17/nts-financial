import { useEffect, useRef, useState, type FormEvent } from 'react';
import { authorizeGmail, gmailAccount, gmailClientId, loadGoogle, scanGmail, similarMovement, type GmailCandidate } from './gmail';
import { expenseCategories, incomeCategories, normalizeTransaction, today, validateTransaction, type IncomeSource, type Transaction } from './finance';
import { supabase } from './supabase';

type Props = { userId?: string; sources: IncomeSource[]; items: Transaction[]; onImported: (transaction: Transaction) => void; onBusy: (busy: boolean) => void };
export default function GmailImport({ userId, sources, items, onImported, onBusy }: Props) {
  const [googleReady, setGoogleReady] = useState(false);
  const [connection, setConnection] = useState<{ token: string; expiresAt: number } | null>(null);
  const [account, setAccount] = useState('');
  const [date, setDate] = useState(today());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [candidates, setCandidates] = useState<GmailCandidate[]>([]);
  const [done, setDone] = useState<Set<string>>(new Set());
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    if (gmailClientId && userId) void loadGoogle().then(() => { if (mounted.current) setGoogleReady(true); }).catch(e => { if (mounted.current) setError(e.message); });
    return () => { mounted.current = false; controller.current?.abort(); };
  }, [userId]);
  function working(value: boolean) { setBusy(value); onBusy(value); }
  async function review() {
    if (!userId || !supabase) return;
    working(true); setError(''); setMessage(''); setCandidates([]);
    controller.current = new AbortController();
    try {
      // Open the popup immediately in this click, before asynchronous work.
      const auth = connection && connection.expiresAt > Date.now() ? connection : await authorizeGmail();
      if (!mounted.current) return;
      setConnection(auth);
      const scan = await scanGmail(auth.token, date, controller.current.signal);
      const imported = new Set<string>();
      for (let i = 0; i < scan.candidates.length; i += 100) {
        const { data, error: receiptError } = await supabase.from('gmail_imports').select('message_id').eq('user_id', userId).eq('account_email', scan.account.toLowerCase()).in('message_id', scan.candidates.slice(i, i + 100).map(c => c.messageId));
        if (receiptError) throw new Error('No pudimos verificar los movimientos ya importados. Intenta de nuevo.');
        for (const row of data) imported.add(row.message_id);
      }
      if (!mounted.current) return;
      setAccount(scan.account); setDone(imported); setCandidates(scan.candidates);
      setMessage(scan.truncated ? 'Revisamos los primeros 500 avisos. Hay más correos para esta fecha; este resultado está incompleto.' : scan.candidates.length ? `${scan.candidates.length} avisos encontrados. Revisa cada uno antes de guardar.` : 'No encontramos avisos de movimientos para esta fecha.');
    } catch (e) {
      if (mounted.current) {
        setConnection(null);
        setError(e instanceof Error ? e.message : 'No pudimos revisar Gmail.');
      }
    } finally { if (mounted.current) working(false); }
  }
  async function confirm(candidate: GmailCandidate, movement: Transaction) {
    if (!supabase || !userId) return;
    const invalid = validateTransaction(movement);
    if (invalid) { setError(invalid); return; }
    working(true); setError('');
    try {
      const { data, error: importError } = await supabase.rpc('import_gmail_movement', { p_email: {
        account: candidate.account, messageId: candidate.messageId, receivedAt: candidate.receivedAt,
        sender: candidate.sender, subject: candidate.subject, excerpt: candidate.excerpt,
      }, p_movement: movement });
      if (importError) throw new Error('No pudimos guardar este movimiento. Revisa la conexión y vuelve a intentarlo.');
      if (!data || typeof data.duplicate !== 'boolean' || (!data.duplicate && !data.transaction)) throw new Error('No pudimos confirmar el guardado. Puedes intentar de nuevo sin duplicarlo.');
      if (!data.duplicate) onImported(normalizeTransaction(data.transaction));
      setDone(previous => new Set([...previous, candidate.messageId]));
      setMessage(data.duplicate ? 'Ese correo ya fue importado. No se creó otro movimiento.' : 'Movimiento guardado.');
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo guardar.'); }
    finally { working(false); }
  }
  async function disconnect() {
    if (!connection || !window.google) return;
    working(true); setError('');
    try {
      await new Promise<void>((resolve, reject) => window.google!.accounts.oauth2.revoke(connection.token, result => result.successful ? resolve() : reject(new Error('No pudimos desconectar. Puedes retirar el permiso desde tu cuenta de Google.'))));
      setConnection(null); setAccount(''); setCandidates([]); setMessage('Gmail desconectado. Los movimientos guardados se conservan.');
    } catch (e) { setError(e instanceof Error ? e.message : 'No pudimos desconectar Gmail.'); }
    finally { working(false); }
  }
  if (!userId) return <p className="modal-copy">Entra a la versión conectada a Supabase para importar movimientos.</p>;
  if (!gmailClientId) return <p className="modal-copy">La conexión con Gmail está en preparación. Mientras tanto puedes registrar tus entradas y salidas.</p>;
  return <div className="gmail-import">
    <p className="modal-copy">Busca avisos de pagos, compras y transferencias. Tú decides qué guardar. {gmailAccount && <>Cuenta: <strong>{gmailAccount}</strong>.</>}</p>
    <div className="gmail-controls"><label>Fecha de los avisos<input type="date" value={date} max={today()} required disabled={busy} onChange={e => { setDate(e.target.value); setCandidates([]); setMessage(''); }} /></label>
      <button className="primary" disabled={busy || !googleReady || !date} onClick={review}>{busy ? 'Procesando…' : connection ? 'Revisar movimientos' : 'Conectar Gmail y revisar'}</button>
    </div>
    <p className="form-hint">Los avisos pueden llegar después de la transacción: comprueba la fecha del movimiento. Algunos correos requieren completar monto, moneda o tipo.</p>
    {account && <div className="gmail-account"><span>{account}</span><button disabled={busy} onClick={disconnect}>Desconectar Gmail</button></div>}
    {error && <p className="error" role="alert">{error}</p>}
    {message && <p role="status">{message}</p>}
    <div className="gmail-candidates">{candidates.map(candidate => done.has(candidate.messageId) ? <p className="gmail-done" key={candidate.messageId}>Ya importado: {candidate.subject}</p> : <CandidateForm key={`${candidate.account}:${candidate.messageId}`} candidate={candidate} sources={sources} items={items} busy={busy} onConfirm={confirm} onSkip={() => setCandidates(previous => previous.filter(c => c.messageId !== candidate.messageId))} />)}</div>
    <p className="form-hint">Google pide permiso de lectura del correo. La app busca los avisos al pulsar el botón. La autorización se mantiene durante esta sesión; al volver puede pedirte conectar otra vez.</p>
  </div>;
}
function CandidateForm({ candidate, sources, items, busy, onConfirm, onSkip }: {
  candidate: GmailCandidate; sources: IncomeSource[]; items: Transaction[]; busy: boolean;
  onConfirm: (candidate: GmailCandidate, movement: Transaction) => Promise<void>; onSkip: () => void;
}) {
  const [draft, setDraft] = useState(candidate);
  const [sourceId, setSourceId] = useState(sources.find(s => s.context === 'Personal')?.id || '');
  const [category, setCategory] = useState('Otros');
  const similar = similarMovement(draft, items);
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!draft.kind || !draft.currency) return;
    void onConfirm(candidate, { id: crypto.randomUUID(), date: draft.date, competence_date: draft.date, kind: draft.kind, currency: draft.currency,
      amount: Number(draft.amount), description: draft.description, context: 'Personal', category, source_id: draft.kind === 'income' ? sourceId : null,
      reserved: 0, from_reserve: false, person_tag: 'diego', flow_type: draft.flowType, reference: `gmail:${candidate.messageId}` });
  }
  return <article className="gmail-candidate"><h3>{candidate.subject || 'Aviso sin asunto'}</h3><p className="gmail-sender">{candidate.sender}</p>
    <details><summary>Ver texto del aviso</summary><pre>{candidate.excerpt}</pre></details>
    <form className="quick-form" onSubmit={submit}><fieldset disabled={busy}>
      <div className="gmail-fields"><label>Tipo<select required value={draft.kind} onChange={e => { setDraft({ ...draft, kind: e.target.value as GmailCandidate['kind'] }); setCategory('Otros'); }}><option value="">Seleccionar</option><option value="income">Entrada</option><option value="expense">Salida</option></select></label>
        <label>Moneda<select required value={draft.currency} onChange={e => setDraft({ ...draft, currency: e.target.value as GmailCandidate['currency'] })}><option value="">Seleccionar</option><option>COP</option><option>USD</option></select></label>
        <label>Monto<input type="number" required min={draft.currency === 'COP' ? 1 : 0.01} max="999999999" step={draft.currency === 'COP' ? 1 : 0.01} value={draft.amount} onChange={e => setDraft({ ...draft, amount: e.target.value })} /></label>
        <label>Fecha del movimiento<input type="date" required max={today()} value={draft.date} onChange={e => setDraft({ ...draft, date: e.target.value })} /></label></div>
      <label>Concepto<textarea aria-label="Concepto" rows={2} required maxLength={4000} value={draft.description} onChange={e => setDraft({ ...draft, description: e.target.value })} /></label>
      {draft.kind === 'income' && <label>Fuente de ingreso<select required value={sourceId} onChange={e => setSourceId(e.target.value)}>{sources.filter(s => s.context === 'Personal').map(s => <option value={s.id} key={s.id}>{s.name}</option>)}</select></label>}
      <label>Categoría<select value={category} onChange={e => setCategory(e.target.value)}>{(draft.kind === 'income' ? incomeCategories : expenseCategories.filter(c => !['Arriendo consultorio', 'Materiales', 'Laboratorio'].includes(c))).map(c => <option key={c}>{c}</option>)}</select></label>
      <label className="checkbox-label"><input type="checkbox" checked={draft.flowType === 'transfer'} onChange={e => setDraft({ ...draft, flowType: e.target.checked ? 'transfer' : 'operating' })} />Es una transferencia entre mis cuentas</label>
      {similar && <p className="gmail-warning">Ya tienes un movimiento con la misma fecha, monto, moneda y tipo. Revisa si es el mismo antes de guardar.</p>}
      {draft.flowType === 'transfer' && <p className="form-hint">Registra ambos lados de la transferencia para que el saldo total se conserve. No se cuenta como ganancia o gasto en el análisis de resultados.</p>}
    </fieldset><div className="gmail-card-actions"><button className="primary" disabled={busy}>Confirmar y guardar</button><button type="button" className="show-more" disabled={busy} onClick={onSkip}>Omitir</button></div></form>
  </article>;
}

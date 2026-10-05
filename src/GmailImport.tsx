import { useEffect, useRef, useState, type FormEvent } from 'react';
import { authorizeGmail, gmailAccount, gmailClientId, loadGoogle, purchaseMerchant, purchaseDescription, scanGmail, similarMovement, type GmailCandidate } from './gmail';
import { MoneyInput } from './MoneyInput';
import type { Account } from './Accounts';
import { money, expenseCategories, incomeCategories, normalizeTransaction, today, validateTransaction, type IncomeSource, type Transaction } from './finance';
import { supabase } from './supabase';

type Receipt = { message_id: string; account_email: string; subject: string; received_at: string; created_at: string; transaction_id: string; excerpt?: string };
const savedAt = (value: string) => new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Bogota' }).format(new Date(value));
type Props = { accounts: Account[]; userId?: string; sources: IncomeSource[]; items: Transaction[]; onImported: (transaction: Transaction) => void; onBusy: (busy: boolean) => void };
export default function GmailImport({ accounts, userId, sources, items, onImported, onBusy }: Props) {
  const [googleReady, setGoogleReady] = useState(false);
  const [connection, setConnection] = useState<{ token: string; expiresAt: number } | null>(null);
  const [account, setAccount] = useState('');
  const [date, setDate] = useState(today());
  const [mode, setMode] = useState<'pending' | 'date'>('pending');
  const [nextPage, setNextPage] = useState('');
  const [history, setHistory] = useState<Receipt[]>([]);
  const [historyError, setHistoryError] = useState('');
  const [showProcessed, setShowProcessed] = useState(true);
  const [receipts, setReceipts] = useState<Map<string, Receipt>>(new Map());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [candidates, setCandidates] = useState<GmailCandidate[]>([]);
  const [done, setDone] = useState<Set<string>>(new Set());
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  async function loadHistory(email = account || gmailAccount) {
    if (!supabase || !userId) return;
    let query = supabase.from('gmail_imports').select('message_id,account_email,subject,received_at,created_at,transaction_id,excerpt').eq('user_id', userId);
    if (email) query = query.eq('account_email', email.toLowerCase());
    const { data, error } = await query.order('created_at', { ascending: false }).order('id', { ascending: false }).limit(5);
    if (!mounted.current) return;
    if (error) setHistoryError('No pudimos cargar el historial de guardados. Puedes reintentar la búsqueda.');
    else { setHistory(data || []); setHistoryError(''); }
  }
  useEffect(() => {
    mounted.current = true;
    void loadHistory();
    if (gmailClientId && userId) void loadGoogle().then(() => { if (mounted.current) setGoogleReady(true); }).catch(e => { if (mounted.current) setError(e.message); });
    return () => { mounted.current = false; controller.current?.abort(); };
  }, [userId]);
  function working(value: boolean) { setBusy(value); onBusy(value); }
  async function review(more = false) {
    if (!userId || !supabase) return;
    working(true); setError(''); setMessage('');
    if (!more) { setCandidates([]); setNextPage(''); }
    controller.current = new AbortController();
    try {
      // Open the popup immediately in this click, before asynchronous work.
      const auth = connection && connection.expiresAt > Date.now() ? connection : await authorizeGmail();
      if (!mounted.current) return;
      setConnection(auth);
      const scan = await scanGmail(auth.token, mode === 'date' ? date : undefined, controller.current.signal, gmailAccount || (more ? account : ''), more ? nextPage : '');
      const imported = new Set<string>();
      const scannedReceipts = new Map<string, Receipt>();
      for (let i = 0; i < scan.candidates.length; i += 100) {
        const { data, error: receiptError } = await supabase.from('gmail_imports').select('message_id,account_email,subject,received_at,created_at,transaction_id,excerpt').eq('user_id', userId).eq('account_email', scan.account.toLowerCase()).in('message_id', scan.candidates.slice(i, i + 100).map(c => c.messageId));
        if (receiptError) throw new Error('No pudimos verificar los movimientos ya importados. Intenta de nuevo.');
        for (const row of data) { imported.add(row.message_id); scannedReceipts.set(row.message_id, row); }
      }
      if (!mounted.current) return;
      setAccount(scan.account);
      setReceipts(previous => more ? new Map([...previous, ...scannedReceipts]) : scannedReceipts);
      setDone(previous => more ? new Set([...previous, ...imported]) : imported);
      setCandidates(previous => more ? [...previous, ...scan.candidates.filter(c => !previous.some(p => p.messageId === c.messageId))] : scan.candidates);
      setNextPage(scan.nextPageToken);
      await loadHistory(scan.account);
      setMessage(`${scan.candidates.length} avisos encontrados. ${scan.candidates.filter(c => !imported.has(c.messageId)).length} pendientes en este lote; ${imported.size} ya guardados.${scan.truncated ? ' Hay más avisos: carga el siguiente lote para seguir revisando.' : ' Llegaste al final de esta búsqueda.'}`);
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
      // Use the durable receipt after saving, including retries that were already imported.
      const { data: receipt } = await supabase.from('gmail_imports').select('message_id,account_email,subject,received_at,created_at,transaction_id,excerpt').eq('user_id', userId).eq('account_email', candidate.account.toLowerCase()).eq('message_id', candidate.messageId).maybeSingle();
      if (receipt) setReceipts(previous => new Map([...previous, [candidate.messageId, receipt]]));
      await loadHistory(candidate.account);
      setMessage(data.duplicate ? 'Ese correo ya fue importado. No se creó otro movimiento.' : 'Movimiento guardado.');
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo guardar.'); }
    finally { working(false); }
  }
  async function disconnect() {
    if (!connection || !window.google) return;
    working(true); setError('');
    try {
      await new Promise<void>((resolve, reject) => window.google!.accounts.oauth2.revoke(connection.token, result => result.successful ? resolve() : reject(new Error('No pudimos desconectar. Puedes retirar el permiso desde tu cuenta de Google.'))));
      setConnection(null); setAccount(''); setCandidates([]); setNextPage(''); setMessage('Gmail desconectado. Los movimientos guardados se conservan.');
    } catch (e) { setError(e instanceof Error ? e.message : 'No pudimos desconectar Gmail.'); }
    finally { working(false); }
  }
  if (!userId) return <p className="modal-copy">Entra a la versión conectada a Supabase para importar movimientos.</p>;
  if (!gmailClientId) return <p className="modal-copy">La conexión con Gmail está en preparación. Mientras tanto puedes registrar tus entradas y salidas.</p>;
  return <div className="gmail-import">
    <p className="modal-copy">Busca avisos de pagos, compras y transferencias. Tú decides qué guardar. {gmailAccount && <>Cuenta: <strong>{gmailAccount}</strong>.</>}</p>
    <section className="gmail-history" aria-label="Últimos correos guardados"><h3>Últimos guardados</h3>
      {historyError ? <p role="alert">{historyError}</p> : history.length ? <><p>Último guardado: <strong>{savedAt(history[0].created_at)}</strong></p><ul>{history.map(receipt => <li key={`${receipt.account_email}:${receipt.message_id}`}><RegisteredReceipt receipt={receipt} items={items} /><small>{receipt.account_email}</small></li>)}</ul></> : <p>Todavía no hay correos guardados en este historial.</p>}
    </section>
    <div className="gmail-controls"><label>Qué revisar<select value={mode} disabled={busy} onChange={e => { setMode(e.target.value as 'pending' | 'date'); setCandidates([]); setNextPage(''); setMessage(''); }}><option value="pending">Continuar con correos pendientes</option><option value="date">Buscar por fecha</option></select></label>
      {mode === 'date' && <label>Fecha de los avisos<input type="date" value={date} max={today()} required disabled={busy} onChange={e => { setDate(e.target.value); setCandidates([]); setNextPage(''); setMessage(''); }} /></label>}
      <button className="primary" disabled={busy || !googleReady || (mode === 'date' && !date)} onClick={() => review()}>{busy ? 'Procesando…' : connection ? 'Revisar movimientos' : 'Conectar Gmail y revisar'}</button>
    </div>
    <p className="form-hint">Continuar revisa los avisos por lotes y reconoce los ya guardados por su ID. También puedes recuperar correos antiguos pendientes, aunque después hayas guardado uno más reciente.</p>
    <p className="form-hint">Los avisos pueden llegar después de la transacción: comprueba la fecha del movimiento. Algunos correos requieren completar monto, moneda o tipo.</p>
    {account && <div className="gmail-account"><span>{account}</span><button disabled={busy} onClick={disconnect}>Desconectar Gmail</button></div>}
    {error && <p className="error" role="alert">{error}</p>}
    {message && <p role="status">{message}</p>}
    {candidates.length > 0 && <label className="checkbox-label"><input type="checkbox" checked={showProcessed} onChange={e => setShowProcessed(e.target.checked)} />Mostrar también los ya guardados ({candidates.filter(c => done.has(c.messageId)).length})</label>}
    <div className="gmail-candidates">{candidates.filter(c => showProcessed || !done.has(c.messageId)).map(candidate => done.has(candidate.messageId) ? <div className="gmail-done" key={candidate.messageId}><RegisteredReceipt receipt={receipts.get(candidate.messageId)} candidate={candidate} items={items} /></div> : <CandidateForm key={`${candidate.account}:${candidate.messageId}`} accounts={accounts} candidate={candidate} sources={sources} items={items} busy={busy} onConfirm={confirm} onSkip={() => setCandidates(previous => previous.filter(c => c.messageId !== candidate.messageId))} />)}</div>
    {candidates.length > 0 && candidates.every(c => done.has(c.messageId)) && <p role="status">Todos los avisos de este lote ya están guardados.</p>}
    {nextPage && <button className="secondary" disabled={busy} onClick={() => review(true)}>Cargar más avisos</button>}
    <p className="form-hint">Google pide permiso de lectura del correo. La app busca los avisos al pulsar el botón. La autorización se mantiene durante esta sesión; al volver puede pedirte conectar otra vez.</p>
  </div>;
}
function RegisteredReceipt({ receipt, candidate, items }: { receipt?: Receipt; candidate?: GmailCandidate; items: Transaction[] }) {
  const transaction = receipt ? items.find(item => item.id === receipt.transaction_id) : undefined;
  const merchant = purchaseMerchant(receipt?.excerpt || '') || candidate?.merchant;
  const description = transaction?.description || (merchant ? purchaseDescription(merchant) : receipt?.subject || candidate?.subject || 'Aviso sin asunto');
  return <><strong>Ya registrado · {description}</strong>{transaction && <span className="gmail-registered-amount">{money(transaction.amount, transaction.currency || 'COP', 'en-US')}</span>}
    {receipt && <small>Guardado el {savedAt(receipt.created_at)}</small>}
    <small>ID: {receipt?.message_id || candidate?.messageId}</small>
    {receipt && !transaction && <small>El comprobante se conserva; el movimiento ya no está en tu lista.</small>}
    {merchant && <small>Comercio en el aviso: {merchant}</small>}
  </>;
}
function CandidateForm({ accounts, candidate, sources, items, busy, onConfirm, onSkip }: {
  accounts: Account[]; candidate: GmailCandidate; sources: IncomeSource[]; items: Transaction[]; busy: boolean;
  onConfirm: (candidate: GmailCandidate, movement: Transaction) => Promise<void>; onSkip: () => void;
}) {
  const [draft, setDraft] = useState(candidate);
  const [accountId, setAccountId] = useState(() => {
    const matches = accounts.filter(a => a.currency === candidate.currency && `${candidate.sender} ${candidate.subject}`.toLowerCase().includes(a.name.toLowerCase()));
    return matches.length === 1 ? matches[0].id : '';
  });
  const [sourceId, setSourceId] = useState(sources.find(s => s.context === 'Personal')?.id || '');
  const [category, setCategory] = useState('Otros');
  const similar = similarMovement(draft, items);
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!draft.kind || !draft.currency) return;
    void onConfirm(candidate, { id: crypto.randomUUID(), date: draft.date, competence_date: draft.date, kind: draft.kind, currency: draft.currency,
      amount: Number(draft.amount), description: draft.description, context: 'Personal', category, source_id: draft.kind === 'income' ? sourceId : null,
      account_id: accountId || null, reserved: 0, from_reserve: false, person_tag: 'diego', flow_type: draft.flowType, reference: `gmail:${candidate.messageId}` });
  }
  return <article className="gmail-candidate"><h3>{candidate.subject || 'Aviso sin asunto'}</h3><p className="gmail-sender">{candidate.sender}</p><p className="gmail-receipt-id">Pendiente · ID: {candidate.messageId}</p>{draft.amount && draft.currency && <strong className="gmail-amount">{money(Number(draft.amount), draft.currency, 'en-US')}</strong>}
    {candidate.merchant && <p className="gmail-merchant">Comercio en el aviso: <strong>{candidate.merchant}</strong></p>}
    <details><summary>Ver texto del aviso</summary><pre>{candidate.excerpt}</pre></details>
    <form className="quick-form" onSubmit={submit}><fieldset disabled={busy}>
      <div className="gmail-fields"><label>Tipo<select required value={draft.kind} onChange={e => { setDraft({ ...draft, kind: e.target.value as GmailCandidate['kind'] }); setCategory('Otros'); }}><option value="">Seleccionar</option><option value="income">Entrada</option><option value="expense">Salida</option></select></label>
        <label>Moneda<select required value={draft.currency} onChange={e => { setDraft({ ...draft, currency: e.target.value as GmailCandidate['currency'] }); setAccountId(''); }}><option value="">Seleccionar</option><option>COP</option><option>USD</option></select></label>
        <label>Monto<MoneyInput commaThousands currency={draft.currency || 'COP'} required min={draft.currency === 'COP' ? 1 : 0.01} max="999999999" step={draft.currency === 'COP' ? 1 : 0.01} value={draft.amount} onValueChange={amount => setDraft({ ...draft, amount })} /></label>
        <label>Fecha del movimiento<input type="date" required max={today()} value={draft.date} onChange={e => setDraft({ ...draft, date: e.target.value })} /></label></div>
      <label>Cuenta del movimiento<select aria-label="Cuenta del movimiento" value={accountId} onChange={e => setAccountId(e.target.value)}><option value="">Sin asignar</option>{accounts.filter(a => a.currency === draft.currency).map(a => <option key={a.id} value={a.id}>{a.name} · {a.currency}</option>)}</select></label>
      {!accountId && <p className="form-hint">Selecciona Bancolombia si este movimiento pertenece a esa cuenta para actualizar su saldo.</p>}
      <label>Concepto<textarea aria-label="Concepto" rows={2} required maxLength={4000} value={draft.description} onChange={e => setDraft({ ...draft, description: e.target.value })} /></label>
      {draft.kind === 'income' && <label>Fuente de ingreso<select required value={sourceId} onChange={e => setSourceId(e.target.value)}>{sources.filter(s => s.context === 'Personal').map(s => <option value={s.id} key={s.id}>{s.name}</option>)}</select></label>}
      <label>Categoría<select value={category} onChange={e => setCategory(e.target.value)}>{(draft.kind === 'income' ? incomeCategories : expenseCategories.filter(c => !['Arriendo consultorio', 'Materiales', 'Laboratorio'].includes(c))).map(c => <option key={c}>{c}</option>)}</select></label>
      <label className="checkbox-label"><input type="checkbox" checked={draft.flowType === 'transfer'} onChange={e => setDraft({ ...draft, flowType: e.target.checked ? 'transfer' : 'operating' })} />Es una transferencia entre mis cuentas</label>
      {similar && <p className="gmail-warning">Ya tienes un movimiento con la misma fecha, monto, moneda y tipo. Revisa si es el mismo antes de guardar.</p>}
      {draft.flowType === 'transfer' && <p className="form-hint">Registra ambos lados de la transferencia para que el saldo total se conserve. No se cuenta como ganancia o gasto en el análisis de resultados.</p>}
    </fieldset><div className="gmail-card-actions"><button className="primary" disabled={busy}>Confirmar y guardar</button><button type="button" className="show-more" disabled={busy} onClick={onSkip}>Omitir</button></div></form>
  </article>;
}

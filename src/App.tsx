import { Notes } from './Notes';
import { people, personForEmail, nameForPerson } from './person';
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { ArrowDownLeft, ArrowUpRight, ArrowRight, Check, Download, LogOut, MoreHorizontal, ShieldCheck, Trash2, X, Pencil, CircleHelp } from 'lucide-react';
import { contexts, defaultSources, demoTransactions, expenseCategories, exportCsv, flowLabels, incomeCategories, money, normalizeTransaction, paymentMethods, spendingByCategory, summarize, today, validateTransaction, type PaymentMethod, type Budgets, type Context, type FlowType, type IncomeSource, type Transaction } from './finance';
import { supabase, supabaseConfigError } from './supabase';
import { loadSources, readSources, readTransactions } from './data';

const LOCAL_ACCESS = 'natalia-access-v1';
function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return <dialog ref={ref} onCancel={e => { e.preventDefault(); onClose(); }} onClose={onClose} aria-labelledby="modal-title"><div className="modal-header"><h2 id="modal-title">{title}</h2><button className="icon-button" onClick={onClose} aria-label="Cerrar"><X size={20} /></button></div>{children}</dialog>;
}
function Login({ onLocalAccess }: { onLocalAccess: (tag: string) => void }) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault(); setMessage('');
    const person = people.find(p => p.code === password);
    if (!person) { setMessage('Esa clave no es correcta. Inténtalo de nuevo.'); return; }
    setBusy(true);
    try {
      if (supabase) {
        const { error } = await supabase.auth.signInWithPassword({ email: person.email, password });
        if (error) setMessage('No pudimos entrar. Inténtalo de nuevo.');
      } else {
        localStorage.setItem(LOCAL_ACCESS, person.tag);
        onLocalAccess(person.tag);
      }
    } catch { setMessage('No pudimos conectarnos. Revisa tu conexión e inténtalo de nuevo.'); }
    finally { setBusy(false); }
  }
  return <main className="login-page"><div className="login-card"><div className="brand-mark">n<span>•</span></div><span className="eyebrow">UN POCO MÁS DE CLARIDAD</span><h1>Tu dinero,<br /><em>en orden.</em></h1><p>Un espacio para cuidar tus finanzas y las de tu consultorio. Un día a la vez.</p><form onSubmit={submit}><label>Clave de acceso<input type="password" inputMode="numeric" required value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" /></label><button className="primary" disabled={busy}>{busy ? 'Entrando…' : 'Entrar'}<ArrowRight size={18} /></button></form><p role="status" className="login-message">{message}</p><small><ShieldCheck size={15} /> Recordaremos tu acceso en este navegador.</small></div></main>;
}
export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [localAccess, setLocalAccess] = useState(() => { const saved = localStorage.getItem(LOCAL_ACCESS); return saved === 'granted' ? 'natalia' : people.find(p => p.tag === saved)?.tag || ''; });
  const [loading, setLoading] = useState(!!supabase);
  const [authError, setAuthError] = useState('');
  useEffect(() => {
    if (!supabase) return;
    let active = true;
    supabase.auth.getSession().then(({ data, error }) => {
      if (active) { setSession(data.session); setLoading(false); if (error) setAuthError(error.message); }
    }).catch(() => { if (active) { setLoading(false); setAuthError('No pudimos verificar tu sesión. Recarga la página.'); } });
    const { data } = supabase.auth.onAuthStateChange((_event, next) => { if (active) { setSession(next); setLoading(false); } });
    return () => { active = false; data.subscription.unsubscribe(); };
  }, []);
  if (supabaseConfigError) return <div className="loading" role="alert">{supabaseConfigError}</div>;
  if (loading) return <div className="loading">Preparando tu espacio…</div>;
  if (authError) return <div className="loading" role="alert">{authError}<button onClick={() => window.location.reload()}>Reintentar</button></div>;
  if (supabase ? !session : !localAccess) return <Login onLocalAccess={setLocalAccess} />;
  const activePerson = session ? personForEmail(session.user.email) : localAccess;
  return <Dashboard key={session?.user.id || activePerson} userId={session?.user.id} personTag={activePerson} />;
}
function Dashboard({ userId, personTag }: { userId?: string; personTag: string }) {
  const personName = nameForPerson(personTag);
  const STORAGE = `${personTag}-finances-v1`;
  const [items, setItems] = useState<Transaction[]>([]);
  const [sources, setSources] = useState<IncomeSource[]>([]);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [spendingOpen, setSpendingOpen] = useState(false);
  // Se conservan los presupuestos existentes aunque ya no formen parte de esta pantalla.
  const [budgets, setBudgets] = useState<Budgets>({});
  const [ready, setReady] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [editing, setEditing] = useState<{ kind: 'income' | 'expense'; transaction: Transaction | null } | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [deleteItem, setDeleteItem] = useState<Transaction | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true;
    async function load() {
      setReady(false); setLoadFailed(false); setError('');
      try {
        if (userId && supabase) {
          async function readBudgets() {
            const rows: { month: string; amount: number }[] = [];
            for (let offset = 0; ; offset += 500) {
              const { data, error } = await supabase!.from('budgets').select('month,amount').eq('user_id', userId!).order('month').range(offset, offset + 499);
              if (error) throw error;
              rows.push(...data);
              if (data.length < 500) return rows;
            }
          }
          const [transactions, savedBudgets, savedSources] = await Promise.all([readTransactions(userId, personTag), readBudgets(), loadSources(userId, personTag)]);
          if (active) { setItems(transactions); setSources(savedSources); setBudgets(Object.fromEntries(savedBudgets.map(b => [b.month, b.amount]))); }
        } else {
          const stored = localStorage.getItem(STORAGE);
          const data = stored ? JSON.parse(stored) : { items: demoTransactions(), budgets: { [today().slice(0, 7)]: 2500000 } };
          if (!Array.isArray(data.items) || typeof data.budgets !== 'object' || !data.budgets || data.items.some((t: Transaction) => validateTransaction(t))) throw new Error('Los datos locales no se pudieron leer. Conserva una copia antes de limpiar el almacenamiento del navegador.');
          const savedSources = data.sources || defaultSources();
          if (!Array.isArray(savedSources) || savedSources.some((s: IncomeSource) => !s.id || typeof s.name !== 'string' || !contexts.includes(s.context))) throw new Error('No pudimos leer tus fuentes de ingreso.');
          const migratedItems = data.items.map((t: Transaction) => normalizeTransaction({ ...t, person_tag: personTag }, savedSources));
          if (active) { localStorage.setItem(STORAGE, JSON.stringify({ items: migratedItems, budgets: data.budgets, sources: savedSources })); setItems(migratedItems); setSources(savedSources); setBudgets(data.budgets); }
        }
      } catch (e) { if (active) { setError(e instanceof Error ? e.message : 'No pudimos cargar tus datos. Revisa la conexión y la configuración de Supabase.'); setLoadFailed(true); } }
      finally { if (active) setReady(true); }
    }
    void load();
    return () => { active = false; };
  }, [userId, personTag, reload]);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(''), 4000); return () => clearTimeout(timer); }, [notice]);
  function persist(nextItems: Transaction[], nextBudgets: Budgets, nextSources = sources) {
    if (!userId) localStorage.setItem(STORAGE, JSON.stringify({ items: nextItems, budgets: nextBudgets, sources: nextSources }));
    setItems(nextItems); setBudgets(nextBudgets); setSources(nextSources);
  }
  async function save(transaction: Transaction) {
    transaction = normalizeTransaction({ ...transaction, person_tag: personTag });
    if (transaction.kind === 'income' && !sources.some(s => s.id === transaction.source_id && s.context === transaction.context)) { setError('Selecciona una fuente de ingreso válida.'); return; }
    const invalid = validateTransaction(transaction); if (invalid) { setError(invalid); return; }
    setBusy(true); setError('');
    try {
      if (userId && supabase) {
        const { error } = await supabase.from('transactions').upsert({ ...transaction, user_id: userId, person_tag: personTag });
        if (error) throw error;
      }
      persist([...items.filter(t => t.id !== transaction.id), transaction], budgets);
      setEditing(null); setNotice('Guardado.');
    } catch { setError('No se guardó el movimiento. Revisa tu conexión y vuelve a intentarlo.'); }
    finally { setBusy(false); }
  }
  async function remove() {
    if (!deleteItem) return;
    setBusy(true); setError('');
    try {
      if (userId && supabase) {
        const { error } = await supabase.from('transactions').delete().eq('id', deleteItem.id).eq('user_id', userId).eq('person_tag', personTag);
        if (error) throw error;
      }
      persist(items.filter(t => t.id !== deleteItem.id), budgets); setDeleteItem(null); setNotice('Movimiento eliminado.');
    } catch { setError('No se pudo eliminar. Inténtalo de nuevo.'); }
    finally { setBusy(false); }
  }
  const received = useMemo(() => items.filter(t => t.date <= today()), [items]);
  const summary = useMemo(() => summarize(received, today().slice(0, 7)), [received]);
  const office = summary.monthly.filter(t => t.context === 'Consultorio');
  const officeIncome = office.filter(t => t.kind === 'income').reduce((s, t) => s + t.amount, 0);
  const officeExpenses = office.filter(t => t.kind === 'expense').reduce((s, t) => s + t.amount, 0);
  const officeGap = Math.max(0, officeExpenses - officeIncome);
  const ordered = items.slice().sort((a, b) => b.date.localeCompare(a.date));
  function open(kind: 'income' | 'expense', transaction: Transaction | null = null) { setError(''); setEditing({ kind, transaction }); }
  async function saveSource(source: IncomeSource) {
    const name = source.name.trim();
    if (!name || name.length > 60) { setError('Escribe un nombre de hasta 60 caracteres.'); return; }
    if (sources.some(s => s.id !== source.id && s.name.toLocaleLowerCase('es') === name.toLocaleLowerCase('es'))) { setError('Ya existe una fuente con ese nombre.'); return; }
    setBusy(true); setError('');
    try {
      if (userId && supabase) {
        const { error } = await supabase.from('income_sources').upsert({ ...source, name, user_id: userId, person_tag: personTag });
        if (error) throw error;
      }
      persist(items, budgets, [...sources.filter(s => s.id !== source.id), { ...source, name }]);
      setNotice('Fuente guardada.');
      return true;
    } catch { setError('No pudimos guardar la fuente. Revisa tu conexión e inténtalo otra vez.'); }
    finally { setBusy(false); }
    return false;
  }
  async function download() {
    setBusy(true); setError('');
    try {
      // Se vuelve a leer Supabase completo; no se exporta una copia local posiblemente desactualizada.
      const [rows, savedSources] = userId ? await Promise.all([readTransactions(userId, personTag), readSources(userId, personTag)]) : [ordered, sources];
      const url = URL.createObjectURL(new Blob([exportCsv(rows, savedSources, userId)], { type: 'text/csv;charset=utf-8;' }));
      const a = document.createElement('a'); a.href = url; a.download = `${personTag}-movimientos.csv`; a.click(); URL.revokeObjectURL(url);
    } catch { setError('No pudimos descargar los datos. Revisa tu conexión e inténtalo otra vez.'); }
    finally { setBusy(false); }
  }
  return <main className="daily-page">
    <header className="daily-header"><a href="#" className="daily-brand" onClick={e => e.preventDefault()}>{personName}<span>Mi dinero, día a día.</span></a><details className="options-menu"><summary aria-label="Opciones"><MoreHorizontal size={24} /></summary><div><button onClick={() => setHelpOpen(true)}><CircleHelp size={17} />Cómo funciona</button><button onClick={() => { setError(''); setSourcesOpen(true); }} disabled={!ready || loadFailed}>Fuentes de ingreso</button><button onClick={download} disabled={busy || !ready || loadFailed}><Download size={17} />Descargar movimientos</button>{!userId && <button onClick={() => { setError(''); setResetOpen(true); }} disabled={!ready || loadFailed}><Trash2 size={17} />Empezar desde cero</button>}{<button onClick={async () => { if (!userId) { localStorage.removeItem(LOCAL_ACCESS); window.location.reload(); return; } const { error } = await supabase!.auth.signOut({ scope: 'local' }); if (error) setError('No pudimos cerrar tu sesión. Inténtalo otra vez.'); }}><LogOut size={17} />Salir</button>}</div></details></header>
    {!userId && <p className="demo-note">Modo demo · Datos de ejemplo. Tus cambios se guardan en este navegador.</p>}
    {error && !editing && !deleteItem && !resetOpen && !sourcesOpen && <p className="error" role="alert">{error}{loadFailed && <button onClick={() => setReload(r => r + 1)}>Reintentar</button>}</p>}
    {notice && <div className="toast" role="status"><Check size={17} />{notice}</div>}
    {!ready ? <p className="loading">Cargando…</p> : loadFailed ? <p className="loading">No pudimos cargar tus movimientos.</p> : <>
      <section className="daily-balance"><p>Hoy tienes disponible</p><h1>{money(summary.available)}</h1><span>Según lo que has registrado.</span>{summary.reserved > 0 && <small>{money(summary.reserved)} aparte para tratamientos.</small>}</section>
      <div className="quick-actions"><button className="quick-action received" onClick={() => open('income')}><ArrowDownLeft size={24} /><span>Recibí dinero</span></button><button className="quick-action paid" onClick={() => open('expense')}><ArrowUpRight size={24} /><span>Pagué algo</span></button></div>
      <p className="payment-hint">¿Te pagaron hoy? Regístralo hoy, sin importar cuándo te paguen las otras clínicas.</p>
      <section className="office-note"><div className="office-heading"><h2>¿Cómo va el consultorio?</h2><span>Este mes</span></div><div className="office-totals"><span>Recibió <strong>{money(officeIncome)}</strong></span><span>Gastó <strong>{money(officeExpenses)}</strong></span></div><p>{officeGap > 0 ? <>Le faltan <strong>{money(officeGap)}</strong> para cubrir sus gastos con lo que recibió.</> : office.length ? 'Sus ingresos cubren los gastos que has registrado.' : 'Aquí verás si lo que recibe alcanza para sus gastos.'}</p></section>
      <details className="spending-summary" open={spendingOpen} onToggle={e => setSpendingOpen(e.currentTarget.open)}><summary>¿En qué se fue el dinero? <span>Este mes</span></summary><SpendingBreakdown rows={received} /></details>
      <section className="recent-section"><h2>Lo último que registraste</h2>{ordered.length ? <ul className="recent-list">{(showAll ? ordered : ordered.slice(0, 5)).map(t => <li key={t.id}><button className="recent-edit" aria-label={`Editar ${t.description}`} onClick={() => open(t.kind, t)}><span className={`entry-icon ${t.kind}`}>{t.kind === 'income' ? <ArrowDownLeft size={19} /> : <ArrowUpRight size={19} />}</span><span className="entry-copy"><strong>{t.description}</strong><span>{t.kind === 'income' ? sources.find(s => s.id === t.source_id)?.name || t.context : `${t.context} · ${t.category}`} · {new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'short' }).format(new Date(`${t.date}T12:00:00`))}{t.date > today() ? ' · Fecha futura, aún no cuenta en el saldo' : ''}</span></span><span className={`entry-amount ${t.kind}`}>{t.kind === 'income' ? '+' : '−'}{money(t.amount)}</span><Pencil className="edit-hint" size={13} /></button></li>)}</ul> : <p className="empty-note">Empieza con un ingreso o un gasto. Solo necesitas el monto y de dónde viene o para qué fue.</p>}{ordered.length > 5 && <button className="show-more" onClick={() => setShowAll(!showAll)}>{showAll ? 'Ver menos' : 'Ver anteriores'}</button>}</section>
      <Notes userId={userId} personTag={personTag} />
      <footer className="daily-footer">Un registro a la vez.</footer>
    </>}
    {editing && <Modal title={editing.transaction ? 'Corregir movimiento' : editing.kind === 'income' ? '¿Cuánto recibiste?' : '¿Cuánto pagaste?'} onClose={() => { if (!busy) { setEditing(null); setError(''); } }}><QuickForm personTag={personTag} sources={sources} kind={editing.kind} transaction={editing.transaction} onSave={save} busy={busy} error={error} />{editing.transaction && <button className="delete-link" disabled={busy} onClick={() => { setDeleteItem(editing.transaction); setEditing(null); setError(''); }}>Eliminar este movimiento</button>}</Modal>}
    {deleteItem && <Modal title="Eliminar movimiento" onClose={() => { if (!busy) { setDeleteItem(null); setError(''); } }}><p className="modal-copy">Se quitará «{deleteItem.description}» por {money(deleteItem.amount)} de tus movimientos.{userId && ' Su historial quedará guardado.'}</p>{error && <p className="error" role="alert">{error}</p>}<div className="modal-actions"><button className="secondary" disabled={busy} onClick={() => setDeleteItem(null)}>Cancelar</button><button className="danger" disabled={busy} onClick={remove}>{busy ? 'Eliminando…' : 'Eliminar movimiento'}</button></div></Modal>}
    {resetOpen && <Modal title="Empezar desde cero" onClose={() => { setResetOpen(false); setError(''); }}><p className="modal-copy">Se borrarán los datos de demo guardados en este navegador. Puedes descargarlos desde Opciones antes de continuar.</p>{error && <p className="error" role="alert">{error}</p>}<div className="modal-actions"><button className="secondary" onClick={() => setResetOpen(false)}>Cancelar</button><button className="danger" onClick={() => { try { persist([], {}, sources); setResetOpen(false); setNotice('Listo para empezar.'); } catch { setError('No pudimos guardar el cambio.'); } }}>Borrar y empezar</button></div></Modal>}
    {sourcesOpen && <Modal title="Tus fuentes de ingreso" onClose={() => { if (!busy) { setSourcesOpen(false); setError(''); } }}><SourcesForm sources={sources} busy={busy} error={error} onSave={saveSource} /></Modal>}
    {helpOpen && <Modal title="Así de sencillo" onClose={() => setHelpOpen(false)}><div className="help-content"><h3>Una rutina que ayuda</h3><p>Separa Personal y Consultorio aunque pagues desde la misma cuenta. Usa conceptos claros y revisa los movimientos contra tus recibos una vez por semana. Cada mes revisa los gastos del consultorio antes de decidir cuánto sacar para ti.</p><h3>Recibí dinero</h3><p>Registra cada pago cuando llegue: un abono del consultorio, el pago de una clínica o cualquier otro ingreso. Las fechas pueden ser diferentes.</p><h3>Pagué algo</h3><p>Escribe el monto, toca Personal o Consultorio y elige una categoría si quieres. La nota y la fecha son opcionales; por defecto se guarda con la fecha de hoy.</p><h3>Fuentes y periodos</h3><p>En Opciones puedes poner los nombres de tus clínicas y agregar otras fuentes. En los detalles de un movimiento puedes indicar cuándo se generó: por ejemplo, un trabajo de septiembre cobrado en octubre. El disponible siempre usa la fecha de pago.</p><h3>Tu disponible</h3><p>Lo recibido hasta hoy menos lo pagado y el dinero apartado para tratamientos. Empiezas desde cero: registra lo que ya tienes como un ingreso y elige «Saldo inicial» en sus detalles. Así no se cuenta como ganancia.</p><h3>Tu consultorio</h3><p>Compara lo que recibió y gastó este mes. Si gastó más, verás cuánto le falta cubrir con otros ingresos.</p><p>Para corregir algo, toca el movimiento. Las correcciones y eliminaciones quedan en el historial de Supabase desde que se habilitó esta función. Dentalink se lleva aparte; puedes usar la referencia para relacionar un caso con sus abonos y gastos.</p></div></Modal>}
  </main>;
}
function QuickForm({ kind, transaction, sources, onSave, busy, error, personTag }: { personTag: string; kind: 'income' | 'expense'; transaction: Transaction | null; sources: IncomeSource[]; onSave: (t: Transaction) => Promise<void>; busy: boolean; error: string }) {
  const [context, setContext] = useState<Context>(transaction?.context || (kind === 'income' ? sources.find(s => s.context === 'Consultorio')?.context || sources[0]?.context || 'Personal' : 'Personal'));
  const [sourceId, setSourceId] = useState(transaction?.source_id || sources.find(s => s.context === (transaction?.context || 'Consultorio'))?.id || sources[0]?.id || '');
  const [category, setCategory] = useState(transaction?.category || (kind === 'income' && context.startsWith('Clínica') ? 'Honorarios' : 'Otros'));
  const [amount, setAmount] = useState(transaction?.amount.toString() || '');
  const [description, setDescription] = useState(transaction?.description || '');
  const [counterparty, setCounterparty] = useState(transaction?.counterparty || '');
  const [reference, setReference] = useState(transaction?.reference || '');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(transaction?.payment_method || 'unspecified');
  const [date, setDate] = useState(transaction?.date || today());
  const [competence, setCompetence] = useState(transaction?.competence_date || '');
  const [flowType, setFlowType] = useState<FlowType>(transaction?.flow_type || 'operating');
  const [reserved, setReserved] = useState(transaction?.reserved.toString() || '');
  const [fromReserve, setFromReserve] = useState(transaction?.from_reserve || false);
  const choices: readonly Context[] = [...new Set<Context>(['Personal', 'Consultorio', ...(transaction ? [transaction.context] : [])])];
  function changeContext(next: Context) {
    setContext(next);
    if (next === 'Personal') { setReserved(''); setFromReserve(false); }
  }
  function submit(e: FormEvent) {
    e.preventDefault();
    const sourceName = sources.find(s => s.id === sourceId)?.name || context;
    const fallback = kind === 'income' ? `Pago de ${sourceName}` : category !== 'Otros' ? category : context === 'Personal' ? 'Gasto personal' : `Gasto del ${context.toLocaleLowerCase('es')}`;
    void onSave({ id: transaction?.id || crypto.randomUUID(), kind, context, person_tag: personTag, counterparty: counterparty.trim(), reference: reference.trim(), payment_method: paymentMethod, source_id: kind === 'income' ? sourceId : null, competence_date: competence || date, flow_type: flowType, amount: Number(amount), description: description.trim() || fallback, date, category, reserved: kind === 'income' && context !== 'Personal' ? Number(reserved || 0) : 0, from_reserve: kind === 'expense' && context !== 'Personal' && fromReserve });
  }
  return <form className="quick-form" onSubmit={submit}><fieldset disabled={busy}><label className="amount-label">Monto en pesos<div className="quick-amount"><span>$</span><input name="amount" aria-label="Monto en pesos" type="number" inputMode="numeric" placeholder="0" required min="1" max="999999999" step="1" value={amount} onChange={e => setAmount(e.target.value)} autoFocus /></div></label><fieldset className="context-fieldset"><legend>{kind === 'income' ? '¿Quién te pagó?' : '¿Para qué fue?'}</legend><div className="context-choices">{kind === 'income' ? sources.map(source => <button key={source.id} type="button" aria-pressed={sourceId === source.id} className={sourceId === source.id ? 'selected' : ''} onClick={() => { setSourceId(source.id); changeContext(source.context); if (!transaction) setCategory(source.context.startsWith('Clínica') ? 'Honorarios' : 'Otros'); }}>{source.name}</button>) : choices.map(c => <button key={c} type="button" aria-pressed={context === c} className={context === c ? 'selected' : ''} onClick={() => changeContext(c)}>{c}</button>)}</div></fieldset>{kind === 'expense' && <label className="category-picker">¿En qué lo gastaste? <span>Opcional</span><select name="category" value={category} onChange={e => setCategory(e.target.value)}>{expenseCategories.map(c => <option key={c}>{c}</option>)}</select></label>}<details className="optional-details" open={transaction ? true : undefined}><summary>Agregar nota o cambiar fecha <span>Opcional</span></summary><div><label>Nota<input name="description" value={description} maxLength={120} onChange={e => setDescription(e.target.value)} placeholder="Ej. Materiales, almuerzo, abono…" /></label><label>¿A quién pagaste o quién te pagó?<input name="counterparty" maxLength={120} value={counterparty} onChange={e => setCounterparty(e.target.value)} placeholder="Ej. Laboratorio, clínica…" /></label><label>Referencia<input name="reference" maxLength={120} value={reference} onChange={e => setReference(e.target.value)} placeholder="Ej. Caso Dentalink, recibo o factura" /></label><label>Medio de pago<select name="payment_method" value={paymentMethod} onChange={e => setPaymentMethod(e.target.value as PaymentMethod)}>{Object.entries(paymentMethods).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select><small>Una compra con tarjeta crédito no indica cuánto queda por pagar de la tarjeta.</small></label><label>{kind === 'income' ? 'Fecha en que recibiste el dinero' : 'Fecha en que pagaste'}<input name="date" type="date" required max={today()} value={date} onChange={e => setDate(e.target.value)} /></label><label>¿A qué fecha corresponde?<input name="competence_date" type="date" value={competence} onChange={e => setCompetence(e.target.value)} /><small>Opcional. Por ejemplo, el día del trabajo que cobraste hoy. Si no lo cambias, usamos la fecha de pago.</small></label><label>Tipo de movimiento<select name="flow_type" value={flowType} onChange={e => setFlowType(e.target.value as FlowType)}>{Object.entries(flowLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>{kind === 'income' && <label>Tipo de ingreso<select name="category" value={category} onChange={e => setCategory(e.target.value)}>{incomeCategories.map(c => <option key={c}>{c}</option>)}</select></label>}{context !== 'Personal' && (kind === 'income' ? <label>Dinero apartado para laboratorio o materiales<input name="reserved" type="number" inputMode="numeric" min="0" max={amount || 0} step="1" placeholder="0" value={reserved} onChange={e => setReserved(e.target.value)} /><small>Si no necesitas apartar nada, déjalo en cero.</small></label> : <label className="checkbox-label"><input type="checkbox" checked={fromReserve} onChange={e => setFromReserve(e.target.checked)} />Lo pagué con dinero apartado para tratamientos</label>)}</div></details></fieldset>{error && <p className="error" role="alert">{error}</p>}<button className="primary form-submit" disabled={busy}>{busy ? 'Guardando…' : kind === 'income' ? 'Guardar ingreso' : 'Guardar gasto'}<Check size={18} /></button></form>;
}
function SourcesForm({ sources, busy, error, onSave }: { sources: IncomeSource[]; busy: boolean; error: string; onSave: (s: IncomeSource) => Promise<boolean | undefined> }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [context, setContext] = useState<Context>('Personal');
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (await onSave({ id: editing || crypto.randomUUID(), name, context })) { setEditing(null); setName(''); setContext('Personal'); }
  }
  return <div><p className="modal-copy">Pon el nombre de cada clínica o agrega otra fuente. Así sabrás de dónde viene el dinero.</p><ul className="source-list">{sources.map(s => <li key={s.id}><span>{s.name}<small>{s.context}</small></span><button className="icon-button" aria-label={`Cambiar nombre de ${s.name}`} disabled={busy} onClick={() => { setEditing(s.id); setName(s.name); setContext(s.context); }}><Pencil size={17} /></button></li>)}</ul><form className="quick-form source-form" onSubmit={submit}><fieldset disabled={busy}><label>{editing ? 'Cambiar nombre' : 'Nueva fuente'}<input name="source_name" required maxLength={60} value={name} onChange={e => setName(e.target.value)} placeholder="Ej. Clínica Sonrisa" /></label><label>Espacio<select name="source_context" value={context} disabled={!!editing} onChange={e => setContext(e.target.value as Context)}>{contexts.map(c => <option key={c}>{c}</option>)}</select></label></fieldset>{error && <p className="error" role="alert">{error}</p>}<button className="primary form-submit" disabled={busy}>{busy ? 'Guardando…' : editing ? 'Guardar nombre' : 'Agregar fuente'}</button>{editing && <button className="show-more" type="button" disabled={busy} onClick={() => { setEditing(null); setName(''); setContext('Personal'); }}>Cancelar cambio</button>}</form></div>;
}
function SpendingBreakdown({ rows }: { rows: Transaction[] }) {
  const [context, setContext] = useState('Todos');
  const totals = spendingByCategory(rows, today().slice(0, 7), context);
  return <div className="spending-content"><select aria-label="Ver gastos de" value={context} onChange={e => setContext(e.target.value)}><option value="Todos">Todos mis gastos</option>{contexts.map(c => <option key={c}>{c}</option>)}</select>{totals.length ? <ul>{totals.map(t => <li key={t.category}><span>{t.category === 'Otros' ? 'Otros / sin clasificar' : t.category}</span><strong>{money(t.amount)}</strong></li>)}</ul> : <p className="empty-note">Todavía no hay gastos de este mes en este espacio.</p>}</div>;
}

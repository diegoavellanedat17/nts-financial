import { people, personForEmail, nameForPerson } from './person';
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { ArrowDownLeft, ArrowUpRight, ArrowRight, Check, Download, LogOut, MoreHorizontal, ShieldCheck, Trash2, X, Pencil, CircleHelp } from 'lucide-react';
import { contexts, defaultSources, demoTransactions, expenseCategories, exportCsv, flowLabels, incomeCategories, money, normalizeTransaction, paymentMethods, spendingByCategory, summarize, today, validateTransaction, type Currency, type PaymentMethod, type Budgets, type Context, type FlowType, type IncomeSource, type Transaction } from './finance';
import { supabase, supabaseConfigError } from './supabase';
import { loadSources, readSources, readTransactions } from './data';
import GmailImport from './GmailImport';
import { useTrm } from './useTrm';
import { trmSourcePage } from '../lib/trm';
import { rowsInCop, summarizeInCop } from './finance';

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
  return <main className="login-page"><div className="login-card"><div className="brand-mark" aria-hidden="true">pf</div><p className="login-brand-name">Personal Finance</p><span className="eyebrow">UN POCO MÁS DE CLARIDAD</span><h1>Tu dinero,<br /><em>en orden.</em></h1><p>Un espacio para cuidar tus finanzas. Un día a la vez.</p><form onSubmit={submit}><label>Clave de acceso<input type="password" inputMode="numeric" required value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" /></label><button className="primary" disabled={busy}>{busy ? 'Entrando…' : 'Entrar'}<ArrowRight size={18} /></button></form><p role="status" className="login-message">{message}</p><small><ShieldCheck size={15} /> Recordaremos tu acceso en este navegador.</small></div></main>;
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
  const isDental = personTag !== 'diego';
  const STORAGE = `${personTag}-finances-v1`;
  const [balanceView, setBalanceView] = useState<Currency | 'total'>(isDental ? 'COP' : 'total');
  const currency: Currency = balanceView === 'USD' ? 'USD' : 'COP';
  const consolidated = balanceView === 'total';
  const trm = useTrm(consolidated);
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
  const [view, setView] = useState<'list' | 'table'>('list');
  const [showAll, setShowAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [reload, setReload] = useState(0);
  const [gmailOpen, setGmailOpen] = useState(false);
  const [gmailBusy, setGmailBusy] = useState(false);
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
          const data = stored ? JSON.parse(stored) : { items: isDental ? demoTransactions() : [], budgets: { [today().slice(0, 7)]: 2500000 } };
          if (!Array.isArray(data.items) || typeof data.budgets !== 'object' || !data.budgets || data.items.some((t: Transaction) => validateTransaction(t))) throw new Error('Los datos locales no se pudieron leer. Conserva una copia antes de limpiar el almacenamiento del navegador.');
          const savedSources = (data.sources || defaultSources(personTag)).filter((s: IncomeSource) => isDental || s.context === 'Personal');
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
  const hasUsd = received.some(t => t.currency === 'USD');
  const totalReady = !consolidated || !hasUsd || !!trm.rate;
  const summary = useMemo(() => consolidated && trm.rate ? summarizeInCop(received, today().slice(0, 7), trm.rate.cop_per_usd) : summarize(received, today().slice(0, 7), currency), [received, currency, consolidated, trm.rate]);
  const spendingRows = useMemo(() => consolidated && trm.rate ? rowsInCop(received, trm.rate.cop_per_usd) : received, [received, consolidated, trm.rate]);
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
    <header className="daily-header"><a href="#" className="daily-brand" onClick={e => e.preventDefault()}>Personal Finance<span>{personName} · Mi dinero, día a día.</span></a><details className="options-menu"><summary aria-label="Opciones"><MoreHorizontal size={24} /></summary><div><button onClick={() => setHelpOpen(true)}><CircleHelp size={17} />Cómo funciona</button><button onClick={() => { setError(''); setSourcesOpen(true); }} disabled={!ready || loadFailed}>Fuentes de ingreso</button><button onClick={download} disabled={busy || !ready || loadFailed}><Download size={17} />Descargar movimientos</button>{!userId && <button onClick={() => { setError(''); setResetOpen(true); }} disabled={!ready || loadFailed}><Trash2 size={17} />Empezar desde cero</button>}{<button onClick={async () => { if (!userId) { localStorage.removeItem(LOCAL_ACCESS); window.location.reload(); return; } const { error } = await supabase!.auth.signOut({ scope: 'local' }); if (error) setError('No pudimos cerrar tu sesión. Inténtalo otra vez.'); }}><LogOut size={17} />Salir</button>}</div></details></header>
    {!userId && <p className="demo-note">Modo demo · Datos de ejemplo. Tus cambios se guardan en este navegador.</p>}
    {error && !editing && !deleteItem && !resetOpen && !sourcesOpen && <p className="error" role="alert">{error}{loadFailed && <button onClick={() => setReload(r => r + 1)}>Reintentar</button>}</p>}
    {notice && <div className="toast" role="status"><Check size={17} />{notice}</div>}
    {!ready ? <p className="loading">Cargando…</p> : loadFailed ? <p className="loading">No pudimos cargar tus movimientos.</p> : <>
      <section className="daily-balance"><div className="currency-switch" role="group" aria-label="Moneda del saldo">{(['total','COP','USD'] as const).map(c => <button key={c} aria-pressed={balanceView === c} onClick={() => setBalanceView(c)}>{c === 'total' ? 'Total en COP' : c}</button>)}</div><p>{consolidated ? 'Todo tu dinero, en pesos' : 'Hoy tienes disponible'}</p><h1>{totalReady ? money(summary.available, currency) : '—'}</h1><span>{consolidated ? 'Equivalente estimado de lo que has registrado.' : 'Según lo que has registrado.'}</span>{consolidated && <div className="trm-note">{trm.rate ? <><a href={trmSourcePage} target="_blank" rel="noreferrer">TRM: 1 USD = {new Intl.NumberFormat('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(trm.rate.cop_per_usd)} COP</a><span>Vigente {new Intl.DateTimeFormat('es-CO').format(new Date(`${trm.rate.date}T12:00:00`))} · Los totales usan esta tasa de hoy.</span></> : trm.error ? <><span role="status">{trm.error}</span><button onClick={trm.retry}>Reintentar TRM</button></> : <span>Cargando TRM de hoy…</span>}</div>}{isDental && totalReady && summary.reserved > 0 && <small>{money(summary.reserved, currency)} aparte para tratamientos.</small>}</section>
      <div className="movement-totals" aria-label="Totales de este mes"><div><span>Ingresos · este mes</span><strong className="income-total">{totalReady ? money(summary.income, currency) : '—'}</strong></div><div><span>Gastos · este mes</span><strong className="expense-total">{totalReady ? money(summary.expenses, currency) : '—'}</strong></div></div>
      <div className="quick-actions"><button className="quick-action received" onClick={() => open('income')}><ArrowDownLeft size={24} /><span>{isDental ? 'Recibí dinero' : 'Entrada'}</span></button><button className="quick-action paid" onClick={() => open('expense')}><ArrowUpRight size={24} /><span>{isDental ? 'Pagué algo' : 'Salida'}</span></button></div>
      <p className="payment-hint">{isDental ? '¿Te pagaron hoy? Regístralo hoy, sin importar cuándo te paguen las otras clínicas.' : 'Registra lo que entra y lo que sale. Describe el concepto al registrar cada movimiento.'}</p>
      {!isDental && <button className="gmail-open" onClick={() => setGmailOpen(true)}>Revisar Gmail</button>}
      {isDental && totalReady && <section className="office-note"><div className="office-heading"><h2>¿Cómo va el consultorio?</h2><span>Este mes</span></div><div className="office-totals"><span>Recibió <strong>{money(officeIncome, currency)}</strong></span><span>Gastó <strong>{money(officeExpenses, currency)}</strong></span></div><p>{officeGap > 0 ? <>Le faltan <strong>{money(officeGap, currency)}</strong> para cubrir sus gastos con lo que recibió.</> : office.length ? 'Sus ingresos cubren los gastos que has registrado.' : 'Aquí verás si lo que recibe alcanza para sus gastos.'}</p></section>}
      <details className="spending-summary" open={spendingOpen} onToggle={e => setSpendingOpen(e.currentTarget.open)}><summary>¿En qué se fue el dinero? <span>Este mes</span></summary>{totalReady ? <SpendingBreakdown currency={currency} rows={spendingRows} isDental={isDental} /> : <p className="empty-note">Necesitamos la TRM de hoy para sumar los gastos en ambas monedas.</p>}</details>
      <section className="recent-section"><div className="movements-heading"><h2>Movimientos</h2><div role="group" aria-label="Vista de movimientos"><button aria-pressed={view === 'list'} onClick={() => setView('list')}>Lista</button><button aria-pressed={view === 'table'} onClick={() => setView('table')}>Tabla</button></div></div>{ordered.length ? view === 'table' ? <div className="movements-table-wrap" role="region" aria-label="Tabla de movimientos" tabIndex={0}><table className="movements-table"><thead><tr><th>Fecha</th><th>Concepto</th><th>Tipo</th><th>Moneda</th><th>Monto</th></tr></thead><tbody>{ordered.map(t => <tr key={t.id}><td><time dateTime={t.date}>{new Intl.DateTimeFormat('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(`${t.date}T12:00:00`))}</time></td><td><button onClick={() => open(t.kind, t)} aria-label={`Editar ${t.description}`}>{t.description}</button></td><td>{t.kind === 'income' ? 'Ingreso' : 'Gasto'}</td><td>{t.currency || 'COP'}</td><td className={`entry-amount ${t.kind}`}>{t.kind === 'income' ? '+' : '−'}{money(t.amount, t.currency || 'COP')}</td></tr>)}</tbody></table></div> : <ul className="recent-list">{(showAll ? ordered : ordered.slice(0, 5)).map(t => <li key={t.id}><button className="recent-edit" aria-label={`Editar ${t.description}`} onClick={() => open(t.kind, t)}><span className={`entry-icon ${t.kind}`}>{t.kind === 'income' ? <ArrowDownLeft size={19} /> : <ArrowUpRight size={19} />}</span><span className="entry-copy"><strong>{t.description}</strong><span>{t.kind === 'income' ? sources.find(s => s.id === t.source_id)?.name || t.context : `${t.context} · ${t.category}`} · {new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'short' }).format(new Date(`${t.date}T12:00:00`))}{t.date > today() ? ' · Fecha futura, aún no cuenta en el saldo' : ''}</span></span><span className={`entry-amount ${t.kind}`}>{t.kind === 'income' ? '+' : '−'}{money(t.amount, t.currency || 'COP')}</span><Pencil className="edit-hint" size={13} /></button></li>)}</ul> : <p className="empty-note">Empieza con un ingreso o un gasto. Solo necesitas el monto y de dónde viene o para qué fue.</p>}{view === 'list' && ordered.length > 5 && <button className="show-more" onClick={() => setShowAll(!showAll)}>{showAll ? 'Ver menos' : 'Ver anteriores'}</button>}</section>
      <footer className="daily-footer">Un registro a la vez.</footer>
    </>}
    {editing && <Modal title={editing.transaction ? 'Corregir movimiento' : editing.kind === 'income' ? '¿Cuánto recibiste?' : '¿Cuánto pagaste?'} onClose={() => { if (!busy) { setEditing(null); setError(''); } }}><QuickForm defaultCurrency={currency} personTag={personTag} sources={sources} kind={editing.kind} transaction={editing.transaction} onSave={save} busy={busy} error={error} />{editing.transaction && <button className="delete-link" disabled={busy} onClick={() => { setDeleteItem(editing.transaction); setEditing(null); setError(''); }}>Eliminar este movimiento</button>}</Modal>}
    {deleteItem && <Modal title="Eliminar movimiento" onClose={() => { if (!busy) { setDeleteItem(null); setError(''); } }}><p className="modal-copy">Se quitará «{deleteItem.description}» por {money(deleteItem.amount, deleteItem.currency || 'COP')} de tus movimientos.{userId && ' Su historial quedará guardado.'}</p>{error && <p className="error" role="alert">{error}</p>}<div className="modal-actions"><button className="secondary" disabled={busy} onClick={() => setDeleteItem(null)}>Cancelar</button><button className="danger" disabled={busy} onClick={remove}>{busy ? 'Eliminando…' : 'Eliminar movimiento'}</button></div></Modal>}
    {resetOpen && <Modal title="Empezar desde cero" onClose={() => { setResetOpen(false); setError(''); }}><p className="modal-copy">Se borrarán los datos de demo guardados en este navegador. Puedes descargarlos desde Opciones antes de continuar.</p>{error && <p className="error" role="alert">{error}</p>}<div className="modal-actions"><button className="secondary" onClick={() => setResetOpen(false)}>Cancelar</button><button className="danger" onClick={() => { try { persist([], {}, sources); setResetOpen(false); setNotice('Listo para empezar.'); } catch { setError('No pudimos guardar el cambio.'); } }}>Borrar y empezar</button></div></Modal>}
    {sourcesOpen && <Modal title="Tus fuentes de ingreso" onClose={() => { if (!busy) { setSourcesOpen(false); setError(''); } }}><SourcesForm isDental={isDental} sources={sources} busy={busy} error={error} onSave={saveSource} /></Modal>}
    {helpOpen && <Modal title="Así de sencillo" onClose={() => setHelpOpen(false)}><div className="help-content">{!isDental ? <><h3>Entradas y salidas</h3><p>Registra el monto cuando el dinero entre o salga. Puedes añadir el concepto, la fecha y el medio de pago.</p><h3>Conceptos y tabla</h3><p>Describe de dónde vino el dinero, a qué cuenta llegó o por qué lo gastaste en el concepto del movimiento. En Tabla puedes revisar fechas, conceptos, ingresos y gastos. Total en COP reúne ambas monedas con la TRM de hoy. COP y USD permiten verlas por separado. Los movimientos conservan su moneda original.</p><h3>Tu disponible</h3><p>Las entradas menos las salidas registradas hasta hoy. Si registras lo que ya tenías, elige «Saldo inicial». En Opciones puedes cambiar tus fuentes de ingreso.</p><p>Toca un movimiento para corregirlo. Su historial queda guardado en Supabase.</p></> : <><h3>Una rutina que ayuda</h3><p>Separa Personal y Consultorio aunque pagues desde la misma cuenta. Usa conceptos claros y revisa los movimientos contra tus recibos una vez por semana. Cada mes revisa los gastos del consultorio antes de decidir cuánto sacar para ti.</p><h3>Recibí dinero</h3><p>Registra cada pago cuando llegue: un abono del consultorio, el pago de una clínica o cualquier otro ingreso. Las fechas pueden ser diferentes.</p><h3>Pagué algo</h3><p>Escribe el monto, toca Personal o Consultorio y elige una categoría si quieres. La nota y la fecha son opcionales; por defecto se guarda con la fecha de hoy.</p><h3>Fuentes y periodos</h3><p>En Opciones puedes poner los nombres de tus clínicas y agregar otras fuentes. En los detalles de un movimiento puedes indicar cuándo se generó: por ejemplo, un trabajo de septiembre cobrado en octubre. El disponible siempre usa la fecha de pago.</p><h3>Tu disponible</h3><p>Lo recibido hasta hoy menos lo pagado y el dinero apartado para tratamientos. Empiezas desde cero: registra lo que ya tienes como un ingreso y elige «Saldo inicial» en sus detalles. Así no se cuenta como ganancia.</p><h3>Tu consultorio</h3><p>Compara lo que recibió y gastó este mes. Si gastó más, verás cuánto le falta cubrir con otros ingresos.</p><p>Para corregir algo, toca el movimiento. Las correcciones y eliminaciones quedan en el historial de Supabase desde que se habilitó esta función. Dentalink se lleva aparte; puedes usar la referencia para relacionar un caso con sus abonos y gastos.</p></>}</div></Modal>}
    {gmailOpen && !isDental && <Modal title="Movimientos desde Gmail" onClose={() => { if (!gmailBusy) setGmailOpen(false); }}><GmailImport userId={userId} sources={sources} items={items} onBusy={setGmailBusy} onImported={transaction => { setItems(previous => [...previous.filter(t => t.id !== transaction.id), transaction]); setNotice('Movimiento importado.'); }} /></Modal>}
  </main>;
}
function QuickForm({ kind, transaction, sources, onSave, busy, error, personTag, defaultCurrency }: { defaultCurrency: Currency; personTag: string; kind: 'income' | 'expense'; transaction: Transaction | null; sources: IncomeSource[]; onSave: (t: Transaction) => Promise<void>; busy: boolean; error: string }) {
  const isDental = personTag !== 'diego';
  const [currency, setCurrency] = useState<Currency>(transaction?.currency || defaultCurrency);
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
  const choices: readonly Context[] = isDental ? [...new Set<Context>(['Personal', 'Consultorio', ...(transaction ? [transaction.context] : [])])] : ['Personal'];
  const categories = isDental ? expenseCategories : expenseCategories.filter(c => !['Arriendo consultorio', 'Materiales', 'Laboratorio'].includes(c));
  function changeContext(next: Context) {
    setContext(next);
    if (next === 'Personal') { setReserved(''); setFromReserve(false); }
  }
  function submit(e: FormEvent) {
    e.preventDefault();
    const sourceName = sources.find(s => s.id === sourceId)?.name || context;
    const fallback = kind === 'income' ? `Pago de ${sourceName}` : category !== 'Otros' ? category : context === 'Personal' ? 'Gasto personal' : `Gasto del ${context.toLocaleLowerCase('es')}`;
    void onSave({ id: transaction?.id || crypto.randomUUID(), kind, context, currency, person_tag: personTag, counterparty: counterparty.trim(), reference: reference.trim(), payment_method: paymentMethod, source_id: kind === 'income' ? sourceId : null, competence_date: competence || date, flow_type: flowType, amount: Number(amount), description: description.trim() ? description : fallback, date, category, reserved: kind === 'income' && context !== 'Personal' ? Number(reserved || 0) : 0, from_reserve: kind === 'expense' && context !== 'Personal' && fromReserve });
  }
  return <form className="quick-form" onSubmit={submit}><fieldset disabled={busy}><label>Moneda<select name="currency" aria-label="Moneda del movimiento" value={currency} onChange={e => setCurrency(e.target.value as Currency)}><option>COP</option><option>USD</option></select></label><label className="amount-label">{currency === 'COP' ? 'Monto en pesos' : 'Monto en dólares'}<div className="quick-amount"><span>$</span><input name="amount" aria-label={currency === 'COP' ? 'Monto en pesos' : 'Monto en dólares'} type="number" inputMode="decimal" placeholder="0" required min={currency === 'COP' ? 1 : 0.01} max="999999999" step={currency === 'COP' ? 1 : 0.01} value={amount} onChange={e => setAmount(e.target.value)} autoFocus /></div></label><label className="concept-label">Concepto<textarea name="description" rows={2} maxLength={4000} value={description} onChange={e => setDescription(e.target.value)} placeholder="Ej. Entró el pago de septiembre a Bancolombia, o pagué el mercado…" /></label>{(isDental || kind === 'income') && <fieldset className="context-fieldset"><legend>{kind === 'income' ? '¿Quién te pagó?' : '¿Para qué fue?'}</legend><div className="context-choices">{kind === 'income' ? sources.map(source => <button key={source.id} type="button" aria-pressed={sourceId === source.id} className={sourceId === source.id ? 'selected' : ''} onClick={() => { setSourceId(source.id); changeContext(source.context); if (!transaction) setCategory(source.context.startsWith('Clínica') ? 'Honorarios' : 'Otros'); }}>{source.name}</button>) : choices.map(c => <button key={c} type="button" aria-pressed={context === c} className={context === c ? 'selected' : ''} onClick={() => changeContext(c)}>{c}</button>)}</div></fieldset>}{kind === 'expense' && <label className="category-picker">¿En qué lo gastaste? <span>Opcional</span><select name="category" value={category} onChange={e => setCategory(e.target.value)}>{categories.map(c => <option key={c}>{c}</option>)}</select></label>}<details className="optional-details" open={transaction ? true : undefined}><summary>Cambiar fecha o agregar detalles <span>Opcional</span></summary><div><label>¿A quién pagaste o quién te pagó?<input name="counterparty" maxLength={120} value={counterparty} onChange={e => setCounterparty(e.target.value)} placeholder={isDental ? 'Ej. Laboratorio, clínica…' : 'Ej. Empresa, cliente, tienda…'} /></label><label>Referencia<input name="reference" maxLength={120} value={reference} onChange={e => setReference(e.target.value)} placeholder={isDental ? 'Ej. Caso Dentalink, recibo o factura' : 'Ej. Recibo o factura'} /></label><label>Medio de pago<select name="payment_method" value={paymentMethod} onChange={e => setPaymentMethod(e.target.value as PaymentMethod)}>{Object.entries(paymentMethods).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select><small>Una compra con tarjeta crédito no indica cuánto queda por pagar de la tarjeta.</small></label><label>{kind === 'income' ? 'Fecha en que recibiste el dinero' : 'Fecha en que pagaste'}<input name="date" type="date" required max={today()} value={date} onChange={e => setDate(e.target.value)} /></label><label>¿A qué fecha corresponde?<input name="competence_date" type="date" value={competence} onChange={e => setCompetence(e.target.value)} /><small>Opcional. Por ejemplo, el día del trabajo que cobraste hoy. Si no lo cambias, usamos la fecha de pago.</small></label><label>Tipo de movimiento<select name="flow_type" value={flowType} onChange={e => setFlowType(e.target.value as FlowType)}>{Object.entries(flowLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>{isDental && kind === 'income' && <label>Tipo de ingreso<select name="category" value={category} onChange={e => setCategory(e.target.value)}>{incomeCategories.map(c => <option key={c}>{c}</option>)}</select></label>}{isDental && context !== 'Personal' && (kind === 'income' ? <label>Dinero apartado para laboratorio o materiales<input name="reserved" type="number" inputMode="numeric" min="0" max={amount || 0} step={currency === 'COP' ? 1 : 0.01} placeholder="0" value={reserved} onChange={e => setReserved(e.target.value)} /><small>Si no necesitas apartar nada, déjalo en cero.</small></label> : <label className="checkbox-label"><input type="checkbox" checked={fromReserve} onChange={e => setFromReserve(e.target.checked)} />Lo pagué con dinero apartado para tratamientos</label>)}</div></details></fieldset>{error && <p className="error" role="alert">{error}</p>}<button className="primary form-submit" disabled={busy}>{busy ? 'Guardando…' : kind === 'income' ? 'Guardar ingreso' : 'Guardar gasto'}<Check size={18} /></button></form>;
}
function SourcesForm({ sources, busy, error, onSave, isDental }: { isDental: boolean; sources: IncomeSource[]; busy: boolean; error: string; onSave: (s: IncomeSource) => Promise<boolean | undefined> }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [context, setContext] = useState<Context>('Personal');
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (await onSave({ id: editing || crypto.randomUUID(), name, context })) { setEditing(null); setName(''); setContext('Personal'); }
  }
  return <div><p className="modal-copy">{isDental ? 'Pon el nombre de cada clínica o agrega otra fuente. Así sabrás de dónde viene el dinero.' : 'Agrega fuentes como salario, trabajo independiente u otros ingresos.'}</p><ul className="source-list">{sources.map(s => <li key={s.id}><span>{s.name}<small>{s.context}</small></span><button className="icon-button" aria-label={`Cambiar nombre de ${s.name}`} disabled={busy} onClick={() => { setEditing(s.id); setName(s.name); setContext(s.context); }}><Pencil size={17} /></button></li>)}</ul><form className="quick-form source-form" onSubmit={submit}><fieldset disabled={busy}><label>{editing ? 'Cambiar nombre' : 'Nueva fuente'}<input name="source_name" required maxLength={60} value={name} onChange={e => setName(e.target.value)} placeholder={isDental ? 'Ej. Clínica Sonrisa' : 'Ej. Salario'} /></label>{isDental && <label>Espacio<select name="source_context" value={context} disabled={!!editing} onChange={e => setContext(e.target.value as Context)}>{contexts.map(c => <option key={c}>{c}</option>)}</select></label>}</fieldset>{error && <p className="error" role="alert">{error}</p>}<button className="primary form-submit" disabled={busy}>{busy ? 'Guardando…' : editing ? 'Guardar nombre' : 'Agregar fuente'}</button>{editing && <button className="show-more" type="button" disabled={busy} onClick={() => { setEditing(null); setName(''); setContext('Personal'); }}>Cancelar cambio</button>}</form></div>;
}
function SpendingBreakdown({ rows, isDental, currency }: { rows: Transaction[]; isDental: boolean; currency: Currency }) {
  const [context, setContext] = useState('Todos');
  const totals = spendingByCategory(rows, today().slice(0, 7), context, currency);
  return <div className="spending-content">{isDental && <select aria-label="Ver gastos de" value={context} onChange={e => setContext(e.target.value)}><option value="Todos">Todos mis gastos</option>{contexts.map(c => <option key={c}>{c}</option>)}</select>}{totals.length ? <ul>{totals.map(t => <li key={t.category}><span>{t.category === 'Otros' ? 'Otros / sin clasificar' : t.category}</span><strong>{money(t.amount, currency)}</strong></li>)}</ul> : <p className="empty-note">Todavía no hay gastos de este mes en este espacio.</p>}</div>;
}

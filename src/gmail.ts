import type { Currency, Transaction } from './finance';

export type GmailMessage = { id: string; internalDate?: string; snippet?: string; payload?: GmailPart };
type GmailPart = { mimeType?: string; headers?: { name: string; value: string }[]; body?: { data?: string }; parts?: GmailPart[] };
export type GmailCandidate = {
  messageId: string; account: string; receivedAt: string; sender: string; subject: string; excerpt: string;
  date: string; amount: string; currency: Currency | ''; kind: 'income' | 'expense' | '';
  description: string; flowType: 'operating' | 'transfer';
};
export const gmailScope = 'https://www.googleapis.com/auth/gmail.readonly';
export const gmailClientId = import.meta.env.VITE_GOOGLE_GMAIL_CLIENT_ID?.trim() || '';
export const gmailAccount = import.meta.env.VITE_GOOGLE_GMAIL_ACCOUNT?.trim().toLowerCase() || '';

// Colombia has no daylight-saving time. Epoch boundaries avoid Gmail's PST date interpretation.
export function bogotaDay(date: string) {
  const parsed = new Date(`${date}T12:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) throw new Error('Selecciona una fecha válida.');
  const start = Date.parse(`${date}T00:00:00-05:00`) / 1000;
  return { start, end: start + 86400 };
}
export function gmailQuery(date: string) {
  const { start, end } = bogotaDay(date);
  return `after:${start - 1} before:${end} -in:spam -in:trash -in:sent -in:drafts -category:promotions {"compra realizada" "compraste" "pagaste" "pago exitoso" "pago recibido" "transferencia exitosa" "transferencia realizada" "transferencia recibida" "recibiste" "retiro realizado" "transaction alert" "purchase" "payment received" "payment successful" "deposit received" "Bancolombia" "Davivienda" "Nequi" "Nu Colombia"}`;
}
function decode(data: string) {
  try { return new TextDecoder().decode(Uint8Array.from(atob(data.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0))); }
  catch { return ''; }
}
function body(part?: GmailPart): string {
  if (!part) return '';
  if (part.mimeType === 'text/plain' && part.body?.data) return decode(part.body.data);
  if (part.mimeType === 'multipart/alternative') {
    const preferred = part.parts?.find(p => p.mimeType === 'text/plain') || part.parts?.find(p => p.mimeType === 'text/html') || part.parts?.[0];
    return body(preferred);
  }
  const children = (part.parts || []).map(body).filter(Boolean);
  if (children.length) return children.join('\n');
  if (part.mimeType === 'text/html' && part.body?.data) {
    // Never render untrusted email HTML or load remote images.
    return decode(part.body.data).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/gi, ' ').replace(/&amp;/gi, '&').replace(/\s+/g, ' ');
  }
  return '';
}
function parseAmount(raw: string, currency: Currency | ''): string {
  const value = raw.replace(/\s/g, '');
  if (currency === 'USD' && /^[0-9]+\.[0-9]{3}$/.test(value)) return '';
  let normalized = value;
  if (value.includes('.') && value.includes(',')) {
    const decimal = value.lastIndexOf('.') > value.lastIndexOf(',') ? '.' : ',';
    normalized = value.replaceAll(decimal === '.' ? ',' : '.', '').replace(decimal, '.');
  } else if (/^[0-9]+(?:[.,][0-9]{3})+$/.test(value)) normalized = value.replace(/[.,]/g, '');
  else if (/^[0-9]+[.,][0-9]{1,2}$/.test(value)) normalized = value.replace(',', '.');
  else if (/[.,]/.test(value)) return '';
  const amount = Number(normalized);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 999999999 || (currency === 'COP' && !Number.isInteger(amount))) return '';
  return String(amount);
}
export function candidateFromMessage(message: GmailMessage, account: string): GmailCandidate {
  const header = (name: string) => message.payload?.headers?.find(h => h.name.toLowerCase() === name)?.value || '';
  const subject = header('subject').slice(0, 500);
  const text = `${subject}\n${body(message.payload) || message.snippet || ''}`.slice(0, 6000);
  const normalized = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const rejected = /rechazad|declinad|no (?:se )?(?:realizo|pudo)|failed|declined|intento|pendiente|por pagar|pago pendiente/.test(normalized);
  const income = /recibiste|recibido|recibida|te envi[oó]|abono realizado|consignacion recibida|payment received|deposit received/.test(normalized);
  const expense = /compraste|pagaste|compra realizada|pago exitoso|transferencia (?:exitosa|realizada)|retiro realizado|purchase|payment successful/.test(normalized);
  const currencies = [...text.matchAll(/(?:USD|US\$|COP|\$)\s*([0-9]+(?:[.,][0-9]+)*)(?:\s*(USD|COP)\b)?|([0-9]+(?:[.,][0-9]+)*)\s*(USD|COP)\b/gi)].map(m => ({
    value: (m[1] || m[3]).trim(), currency: /USD|US\$/i.test(m[0]) ? 'USD' as const : /COP/i.test(m[0]) ? 'COP' as const : '' as const,
  }));
  // Multiple amounts can be a balance, fees or an invoice: require explicit review instead of choosing one.
  const single = currencies.length === 1 ? currencies[0] : null;
  const receivedAt = new Date(Number(message.internalDate)).toISOString();
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(receivedAt));
  return { messageId: message.id, account, receivedAt, sender: header('from').slice(0, 500), subject,
    excerpt: text.slice(0, 6000), date, currency: single?.currency || '', amount: single ? parseAmount(single.value, single.currency) : '',
    kind: !rejected && income !== expense ? income ? 'income' : 'expense' : '',
    description: subject.slice(0, 4000), flowType: 'operating' };
}
export function similarMovement(candidate: GmailCandidate, rows: Transaction[]) {
  return rows.some(t => t.date === candidate.date && t.kind === candidate.kind && t.amount === Number(candidate.amount) && (t.currency || 'COP') === candidate.currency);
}
export class GmailAuthExpired extends Error { constructor() { super('La conexión con Gmail venció. Vuelve a conectar para continuar.'); } }
async function gmailGet<T>(token: string, path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, { headers: { Authorization: `Bearer ${token}` }, signal });
  if (response.status === 401) throw new GmailAuthExpired();
  if (!response.ok) throw new Error(response.status === 403 ? 'Google no permitió leer el correo. Revisa que hayas autorizado la lectura y que Gmail esté habilitado.' : 'No pudimos leer Gmail. Intenta de nuevo en unos minutos.');
  return response.json();
}
export async function scanGmail(token: string, date: string, signal?: AbortSignal, expectedAccount = gmailAccount) {
  const { emailAddress: account } = await gmailGet<{ emailAddress: string }>(token, 'profile', signal);
  if (expectedAccount && account.toLowerCase() !== expectedAccount.toLowerCase()) throw new Error(`Conectaste otra cuenta. Selecciona ${expectedAccount}.`);
  const ids: string[] = [];
  let pageToken = '';
  do {
    const params = new URLSearchParams({ q: gmailQuery(date), maxResults: '100' });
    if (pageToken) params.set('pageToken', pageToken);
    const page = await gmailGet<{ messages?: { id: string }[]; nextPageToken?: string }>(token, `messages?${params}`, signal);
    ids.push(...(page.messages || []).map(m => m.id)); pageToken = page.nextPageToken || '';
  } while (pageToken && ids.length < 500);
  const candidates: GmailCandidate[] = [];
  const { start, end } = bogotaDay(date);
  // Limit concurrent requests; an interrupted/failed scan never looks like an empty result.
  for (let i = 0; i < ids.length; i += 5) {
    const batch = await Promise.all(ids.slice(i, i + 5).map(id => gmailGet<GmailMessage>(token, `messages/${encodeURIComponent(id)}?format=full`, signal)));
    for (const message of batch) {
      const ts = Number(message.internalDate) / 1000;
      if (ts >= start && ts < end) candidates.push(candidateFromMessage(message, account));
    }
  }
  return { account, candidates, truncated: !!pageToken };
}

type TokenResponse = { access_token?: string; expires_in?: number; error?: string; scope?: string };
type GoogleOAuth = {
  initTokenClient: (config: { client_id: string; scope: string; hint?: string; include_granted_scopes: boolean; callback: (response: TokenResponse) => void; error_callback: () => void }) => { requestAccessToken: (options: { prompt: string }) => void };
  hasGrantedAllScopes: (response: TokenResponse, scope: string) => boolean;
  revoke: (token: string, callback: (result: { successful: boolean }) => void) => void;
};
declare global { interface Window { google?: { accounts: { oauth2: GoogleOAuth } } } }
let loadingGoogle: Promise<void> | undefined;
export function loadGoogle() {
  if (window.google?.accounts.oauth2) return Promise.resolve();
  if (!loadingGoogle) loadingGoogle = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script'); script.src = 'https://accounts.google.com/gsi/client'; script.async = true;
    const timer = setTimeout(() => { loadingGoogle = undefined; script.remove(); reject(new Error('Google no respondió. Intenta de nuevo.')); }, 15000);
    script.onload = () => { clearTimeout(timer); resolve(); };
    script.onerror = () => { clearTimeout(timer); loadingGoogle = undefined; script.remove(); reject(new Error('No pudimos cargar la conexión de Google.')); };
    document.head.appendChild(script);
  });
  return loadingGoogle;
}
// Call only from a user click; the Google script is prepared before enabling the button.
export function authorizeGmail(): Promise<{ token: string; expiresAt: number }> {
  return new Promise((resolve, reject) => {
    const oauth = window.google?.accounts.oauth2;
    if (!oauth || !gmailClientId) return reject(new Error('La conexión de Gmail aún no está configurada.'));
    oauth.initTokenClient({ client_id: gmailClientId, scope: gmailScope, hint: gmailAccount || undefined, include_granted_scopes: false,
      callback: response => {
        if (!response.access_token || response.error || !oauth.hasGrantedAllScopes(response, gmailScope)) reject(new Error('Necesitas autorizar la lectura de Gmail para revisar los movimientos.'));
        else resolve({ token: response.access_token, expiresAt: Date.now() + (Number(response.expires_in) || 3600) * 1000 - 60000 });
      }, error_callback: () => reject(new Error('Se cerró la conexión de Google. Puedes intentar de nuevo.')),
    }).requestAccessToken({ prompt: 'select_account' });
  });
}

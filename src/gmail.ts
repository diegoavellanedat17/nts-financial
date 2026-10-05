import type { Currency, Transaction } from './finance';

import { bogotaDay, candidateFromMessage, gmailQuery, type GmailCandidate, type GmailMessage } from '../lib/gmailParsing';
export { bogotaDay, candidateFromMessage, gmailQuery, type GmailCandidate, type GmailMessage } from '../lib/gmailParsing';
export const gmailScope = 'https://www.googleapis.com/auth/gmail.readonly';
export const gmailClientId = import.meta.env.VITE_GOOGLE_GMAIL_CLIENT_ID?.trim() || '';
export const gmailAccount = import.meta.env.VITE_GOOGLE_GMAIL_ACCOUNT?.trim().toLowerCase() || '';

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

import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createClient } from '@supabase/supabase-js';
import { diegoEmail, gmailReadScope, personalGmail } from './gmailAutomatic.ts';

export function serverDb() {
  const url = process.env.VITE_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw Error('server_configuration');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
export function googleConfig() {
  const clientId = process.env.GOOGLE_GMAIL_CLIENT_ID || process.env.VITE_GOOGLE_GMAIL_CLIENT_ID;
  const secret = process.env.GOOGLE_GMAIL_CLIENT_SECRET;
  const origin = process.env.GMAIL_APP_ORIGIN || 'https://nts-financial.vercel.app';
  if (!clientId || !secret || !/^https:\/\//.test(origin)) throw Error('google_configuration');
  return { clientId, secret, origin, redirectUri: `${origin}/api/gmail/callback` };
}
function encryptionKey() {
  const value = process.env.GMAIL_TOKEN_ENCRYPTION_KEY || '';
  if (!/^[a-f0-9]{64}$/i.test(value)) throw Error('encryption_configuration');
  return Buffer.from(value, 'hex');
}
export function sealToken(value: string, owner: string) {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  cipher.setAAD(Buffer.from(owner));
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map(b => b.toString('base64url')).join('.');
}
export function openToken(value: string, owner: string) {
  const [iv, tag, ciphertext] = value.split('.').map(b => Buffer.from(b, 'base64url'));
  if (!iv || !tag || !ciphertext || iv.length !== 12 || tag.length !== 16) throw Error('invalid_ciphertext');
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), iv);
  decipher.setAAD(Buffer.from(owner)); decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
export const hash = (text: string) => createHash('sha256').update(text).digest('hex');
export const randomToken = () => randomBytes(32).toString('base64url');
export function validCron(header?: string) {
  const expected = process.env.CRON_SECRET;
  if (!expected || !header) return false;
  const a = Buffer.from(header), b = Buffer.from(`Bearer ${expected}`);
  return a.length === b.length && timingSafeEqual(a, b);
}
export function send(res: ServerResponse, status: number, body: unknown) {
  res.setHeader('Cache-Control', 'no-store'); res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.statusCode = status; res.end(JSON.stringify(body));
}
export async function ownerForRequest(req: IncomingMessage) {
  const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
  if (!token) throw Error('unauthorized');
  const db = serverDb();
  const { data: { user }, error } = await db.auth.getUser(token);
  if (error || !user) throw Error('unauthorized');
  if (user.email !== diegoEmail) throw Error('forbidden');
  return { db, user };
}
export async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const body = (req as IncomingMessage & { body?: unknown }).body;
  if (body !== undefined) {
    const encoded = typeof body === 'string' ? body : JSON.stringify(body);
    if (encoded.length > 5000) throw Error('invalid_body');
    return JSON.parse(encoded);
  }
  let text = ''; for await (const part of req) { text += part.toString(); if (text.length > 5000) throw Error('invalid_body'); }
  return text ? JSON.parse(text) : {};
}
export async function googleTokens(params: Record<string, string>) {
  const { clientId, secret } = googleConfig();
  const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: clientId, client_secret: secret, ...params }), signal: AbortSignal.timeout(15000) });
  const result = await response.json();
  if (!response.ok || !result.access_token) throw Error(result.error === 'invalid_grant' ? 'reauthorize' : 'google_unavailable');
  if (result.scope && !result.scope.split(' ').includes(gmailReadScope)) throw Error('missing_scope');
  return result as { access_token: string; refresh_token?: string; scope?: string };
}
export async function gmailGet<T>(token: string, path: string): Promise<T> {
  const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw Error(r.status === 401 ? 'reauthorize' : 'gmail_unavailable');
  return r.json();
}
export async function verifyPersonalGmail(token: string) {
  const profile = await gmailGet<{ emailAddress: string }>(token, 'profile');
  if (profile.emailAddress.toLowerCase() !== personalGmail) throw Error('wrong_account');
}

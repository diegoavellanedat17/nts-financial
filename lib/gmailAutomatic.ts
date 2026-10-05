import { candidateFromMessage, type GmailMessage } from './gmailParsing.ts';
import type { Transaction } from '../src/finance.ts';

export const personalGmail = 'diego.avellaneda1733@gmail.com';
export const diegoEmail = 'diego-access@nts-financial.example.com';
export const gmailReadScope = 'https://www.googleapis.com/auth/gmail.readonly';
export function senderAddress(sender: string) {
  return sender.match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+/i)?.[0].toLowerCase() || '';
}
export function isBankSender(sender: string) {
  const domain = senderAddress(sender).split('@')[1] || '';
  return domain === 'notificacionesbancolombia.com' || domain.endsWith('.notificacionesbancolombia.com');
}
export function automaticCandidate(message: GmailMessage) {
  const candidate = candidateFromMessage(message, personalGmail);
  const text = candidate.excerpt;
  // Account/card-specific alerts only. A $ alone is COP only within this verified bank format.
  const purchase = text.match(/Compraste\s+\$\s*([\d.,]+)\s+en\s+(.+?)\s+con\s+tu\s+T\.?Deb\s*\*?4946\b/i);
  const stamp = text.match(/\bel\s+(\d{2})\/(\d{2})\/(\d{4})\s+(?:a las\s+)?(\d{2}:\d{2})(?::\d{2})?/i);
  if (isBankSender(candidate.sender) && purchase && stamp && !/rechazad|declinad|intento|USD|US\$/i.test(text)) {
    const normalized = purchase[1].includes(',') && purchase[1].includes('.')
      ? purchase[1].lastIndexOf(',') > purchase[1].lastIndexOf('.') ? purchase[1].replaceAll('.', '').replace(',', '.') : purchase[1].replaceAll(',', '')
      : /^[\d]+(?:[.,]\d{3})+$/.test(purchase[1]) ? purchase[1].replace(/[.,]/g, '') : purchase[1].replace(',', '.');
    const amount = Number(normalized);
    const date = `${stamp[3]}-${stamp[2]}-${stamp[1]}`;
    const parsed = new Date(`${date}T${stamp[4]}:00-05:00`);
    const time = Date.parse(candidate.receivedAt);
    const difference = time - parsed.getTime();
    if (Number.isInteger(amount) && amount > 0 && amount <= 999999999 && Number.isFinite(parsed.getTime()) && new Date(`${date}T12:00:00Z`).toISOString().slice(0,10) === date && difference >= -300000 && difference <= 7 * 86400000) {
      return { ...candidate, date, amount: String(amount), currency: 'COP' as const, kind: 'expense' as const, description: purchase[2].trim().slice(0, 4000), automatic: true };
    }
  }
  return { ...candidate, automatic: false };
}
export function categoryForMerchant(description: string) {
  if (/\b(?:uber|didi|parqueadero|parqueo)\b/i.test(description)) return 'Transporte';
  if (/\b(?:spotify|netflix)\b/i.test(description)) return 'Servicios';
  // Rappi/OXXO and unknown merchants stay unclassified until the person describes the purchase.
  return 'Otros';
}
export function automaticMovement(message: GmailMessage, accountId: string): Partial<Transaction> | null {
  const c = automaticCandidate(message);
  return c.automatic ? { date: c.date, kind: 'expense', amount: Number(c.amount), currency: 'COP', category: categoryForMerchant(c.description), description: c.description, context: 'Personal', flow_type: 'operating', account_id: accountId, payment_method: 'debit_card', counterparty: c.description } : null;
}

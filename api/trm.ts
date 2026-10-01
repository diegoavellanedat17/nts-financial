import type { IncomingMessage, ServerResponse } from 'node:http';
import { createClient } from '@supabase/supabase-js';
import { bogotaToday, officialTrm, trmUrl, validTrm } from '../lib/trm.ts';

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); res.statusCode = 405; res.end(JSON.stringify({ error: 'Método no permitido.' })); return; }
  try {
    const url = process.env.VITE_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error('TRM unavailable');
    const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const date = bogotaToday();
    const { data: cached, error: readError } = await db.from('exchange_rates').select('*').eq('date', date).maybeSingle();
    if (readError) throw readError;
    if (validTrm(cached, date)) { res.end(JSON.stringify(cached)); return; }
    const response = await fetch(trmUrl(date), { signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error('Official source unavailable');
    const rate = officialTrm(await response.json(), date);
    const { error: writeError } = await db.from('exchange_rates').upsert(rate, { onConflict: 'date', ignoreDuplicates: true });
    if (writeError) throw writeError;
    // Return the persisted value, including when two devices fetched simultaneously.
    const { data: stored, error: storedError } = await db.from('exchange_rates').select('*').eq('date', date).single();
    if (storedError || !validTrm(stored, date)) throw new Error('TRM persistence failed');
    res.end(JSON.stringify(stored));
  } catch {
    res.statusCode = 503;
    res.end(JSON.stringify({ error: 'No pudimos consultar la TRM vigente. Puedes ver COP y USD por separado e intentar de nuevo.' }));
  }
}

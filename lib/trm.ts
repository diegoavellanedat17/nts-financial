export const trmSource = 'https://www.datos.gov.co/resource/32sa-8pi3.json';
export const trmSourcePage = 'https://www.datos.gov.co/Econom-a-y-Finanzas/Tasa-de-Cambio-Representativa-del-Mercado-TRM/32sa-8pi3';
export type Trm = { date: string; cop_per_usd: number; valid_from: string; valid_to: string; source: string; fetched_at: string };
export function bogotaToday(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
export function validTrm(value: unknown, date: string): value is Trm {
  if (!value || typeof value !== 'object') return false;
  const r = value as Trm;
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && r.date === date && r.source === trmSource &&
    Number.isFinite(r.cop_per_usd) && r.cop_per_usd > 0 && r.cop_per_usd < 100000 &&
    /^\d{4}-\d{2}-\d{2}$/.test(r.valid_from) && /^\d{4}-\d{2}-\d{2}$/.test(r.valid_to) && r.valid_from <= date && r.valid_to >= date &&
    Number.isFinite(Date.parse(r.fetched_at));
}
export function officialTrm(rows: unknown, date: string, fetchedAt = new Date().toISOString()): Trm {
  if (!Array.isArray(rows)) throw new Error('No se recibió la TRM oficial.');
  for (const row of rows) {
    if (!row || row.unidad !== 'COP') continue;
    const rate: Trm = { date, cop_per_usd: Number(row.valor), valid_from: String(row.vigenciadesde || '').slice(0, 10), valid_to: String(row.vigenciahasta || '').slice(0, 10), source: trmSource, fetched_at: fetchedAt };
    if (validTrm(rate, date)) return rate;
  }
  throw new Error('Todavía no está disponible la TRM oficial vigente para hoy.');
}
export function trmUrl(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Fecha inválida.');
  const url = new URL(trmSource);
  url.searchParams.set('$where', `vigenciadesde <= '${date}T00:00:00' AND vigenciahasta >= '${date}T00:00:00'`);
  url.searchParams.set('$order', 'vigenciadesde DESC'); url.searchParams.set('$limit', '1');
  return url.toString();
}

import { afterEach, expect, it, vi } from 'vitest';
import { bogotaDay, candidateFromMessage, gmailQuery, GmailAuthExpired, scanGmail, type GmailMessage } from '../src/gmail';
const email = 'test@example.com';
const message = (text: string, subject = 'Aviso del banco'): GmailMessage => ({ id: 'abcd1234', internalDate: String(Date.parse('2026-10-01T10:00:00-05:00')), payload: { mimeType: 'text/plain', headers: [{ name: 'Subject', value: subject }, { name: 'From', value: 'Banco <avisos@example.com>' }], body: { data: Buffer.from(text).toString('base64url') } } });
afterEach(() => vi.unstubAllGlobals());
it('interpreta avisos claros sin asumir la moneda de un signo dólar', () => {
 expect(candidateFromMessage(message('Compraste COP 1.234.567,00 en Mercado'),email)).toMatchObject({ kind:'expense', amount:'1234567', currency:'COP', date:'2026-10-01' });
 expect(candidateFromMessage(message('Payment received USD 1,234.56'),email)).toMatchObject({ kind:'income', amount:'1234.56', currency:'USD' });
 expect(candidateFromMessage(message('Recibiste $800.000 COP'),email)).toMatchObject({ kind:'income', amount:'800000', currency:'COP' });
 expect(candidateFromMessage(message('Compraste $50.000'),email)).toMatchObject({ amount:'50000', currency:'' });
});
it('deja para revisión montos múltiples, pagos pendientes y movimientos rechazados', () => {
 expect(candidateFromMessage(message('Compraste COP 20.000. Saldo COP 100.000'),email)).toMatchObject({ amount:'', currency:'' });
 expect(candidateFromMessage(message('Compra realizada COP 25.000 - transacción rechazada'),email).kind).toBe('');
 expect(candidateFromMessage(message('Factura pendiente por pagar COP 25.000'),email).kind).toBe('');
 expect(candidateFromMessage(message('Saldo USD 100.001'),email).amount).toBe('');
});
it('usa el día de Colombia, recupera todas las páginas y excluye avisos fuera del día', async () => {
 const {start,end}=bogotaDay('2026-10-01');
 expect(start).toBe(Date.parse('2026-10-01T00:00:00-05:00')/1000); expect(end-start).toBe(86400);
 expect(gmailQuery('2026-10-01')).toContain(`after:${start-1}`);
 expect(()=>bogotaDay('2026-02-30')).toThrow(); expect(()=>bogotaDay('2026-99-99')).toThrow();
 const fetcher=vi.fn(async (url: string) => {
  if(url.endsWith('/profile'))return Response.json({emailAddress:email});
  if(url.includes('/messages?'))return Response.json(url.includes('pageToken=next')?{messages:[{id:'b'}]}:{messages:[{id:'a'}],nextPageToken:'next'});
  if(url.includes('/messages/a'))return Response.json({...message('Compraste COP 10.000'),id:'a',internalDate:String(start*1000)});
  return Response.json({...message('Compraste COP 20.000'),id:'b',internalDate:String(end*1000)});
 });
 vi.stubGlobal('fetch',fetcher);
 const result=await scanGmail('temporary-token','2026-10-01',undefined,email);
 expect(result.candidates).toHaveLength(1);expect(result.candidates[0].messageId).toBe('a');expect(result.truncated).toBe(false);
});
it('no muestra un fallo de Gmail como si no hubiera movimientos', async () => {
 vi.stubGlobal('fetch',vi.fn(async()=>new Response('',{status:401})));
 await expect(scanGmail('expired','2026-10-01')).rejects.toBeInstanceOf(GmailAuthExpired);
});
it('no lee mensajes de una cuenta distinta de la configurada',async()=>{
 const fetcher=vi.fn(async()=>Response.json({emailAddress:'wrong@example.com'}));
 vi.stubGlobal('fetch',fetcher);
 await expect(scanGmail('token','2026-10-01',undefined,'personal@example.com')).rejects.toThrow('Conectaste otra cuenta');
 expect(fetcher).toHaveBeenCalledTimes(1);
});
it('no cuenta dos veces el mismo texto en un correo multipart',()=>{
 const source=message('Compraste COP 50.000');
 source.payload={headers:source.payload!.headers,mimeType:'multipart/alternative',parts:[{mimeType:'text/plain',body:source.payload!.body},{mimeType:'text/html',body:{data:Buffer.from('<p>Compraste COP 50.000</p>').toString('base64url')}}]};
 expect(candidateFromMessage(source,email)).toMatchObject({amount:'50000',currency:'COP'});
});

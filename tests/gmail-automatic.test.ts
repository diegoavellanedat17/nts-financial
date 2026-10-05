import { afterEach, expect, it, vi } from 'vitest';
import { automaticCandidate, automaticMovement, isBankSender } from '../lib/gmailAutomatic';
import { openToken, sealToken, validCron } from '../lib/gmailServer';
import type { GmailMessage } from '../lib/gmailParsing';
const message=(text:string,sender='Alertas <alertasynotificaciones@an.notificacionesbancolombia.com>'):GmailMessage=>({id:'abc123',internalDate:String(Date.parse('2026-10-02T23:52:00-05:00')),payload:{mimeType:'text/plain',headers:[{name:'From',value:sender},{name:'Subject',value:'Alertas y Notificaciones'}],body:{data:Buffer.from(text).toString('base64url')}}});
afterEach(()=>vi.unstubAllEnvs());
it('importa compras inequívocas de la tarjeta correcta con fecha y moneda nativas',()=>{
 const m=message('Compraste $17.900,00 en Didi con tu T.Deb *4946, el 02/10/2026 a las 23:51.');
 expect(automaticCandidate(m)).toMatchObject({automatic:true,date:'2026-10-02',currency:'COP',amount:'17900',description:'Didi'});
 expect(automaticMovement(m,'bank')).toMatchObject({amount:17900,account_id:'bank',category:'Transporte',payment_method:'debit_card'});
 expect(automaticCandidate(message('Compraste $6,500.00 en MERCADO con tu T.Deb *4946, el 02/10/2026 a las 23:51.'))).toMatchObject({automatic:true,amount:'6500'});
 expect(automaticMovement(message('Compraste $30.000,00 en OXXO con tu T.Deb *4946, el 02/10/2026 a las 23:51.'),'bank')?.category).toBe('Otros');
});
it('no automatiza remitentes ajenos, otra tarjeta, transferencias, fechas o montos ambiguos',()=>{
 const clear='Compraste $17.900,00 en Didi con tu T.Deb *4946, el 02/10/2026 a las 23:51.';
 for(const m of [message(clear,'banco@evil.notificacionesbancolombia.com.evil.com'),message(clear.replace('4946','1111')),message(clear+' Transacción rechazada'),message(clear.replace('17.900,00','17.900,50')),message(clear.replace('02/10/2026','31/02/2026')),message('transferiste $380,000.00 desde tu cuenta *5012'),message('Recibiste $9700000 en tu cuenta *5012')])expect(automaticMovement(m,'bank')).toBeNull();
 expect(isBankSender('notificacionesbancolombia.com <evil@example.com>')).toBe(false);
});
it('cifra tokens por propietario y rechaza cambios y solicitudes sin el secreto del cron',()=>{
 vi.stubEnv('GMAIL_TOKEN_ENCRYPTION_KEY','12'.repeat(32));vi.stubEnv('CRON_SECRET','secret-for-test');
 const token=sealToken('refresh-secret','owner');expect(token).not.toContain('refresh-secret');expect(openToken(token,'owner')).toBe('refresh-secret');
 expect(()=>openToken(token,'other-owner')).toThrow();expect(()=>openToken(token.slice(0,-2)+'ab','owner')).toThrow();
 expect(validCron('Bearer secret-for-test')).toBe(true);expect(validCron()).toBe(false);expect(validCron('Bearer wrong')).toBe(false);
 vi.stubEnv('CRON_SECRET','');expect(validCron('Bearer ')).toBe(false);
});

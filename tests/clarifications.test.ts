import { describe, expect, it } from 'vitest';
import { clarificationQuestion } from '../lib/clarifications';
import { officeAfterReserves } from '../lib/insights';
import { summarize, today, type Transaction } from '../src/finance';

const movement: Transaction = { id: 'patient-payment', date: today(), kind: 'income', amount: 1520876, reserved: 0, from_reserve: false, context: 'Consultorio', category: 'Otros', description: 'Pacientes', person_tag: 'natalia' };
describe('Aclaraciones sin cambiar el dinero recibido', () => {
  it('pregunta por cobros sin aclarar y omite Diego, ajustes, transferencias y respuestas resueltas', () => {
    expect(clarificationQuestion(movement, 'natalia')).toContain('anticipados');
    expect(clarificationQuestion(movement, 'diego')).toBeNull();
    expect(clarificationQuestion({ ...movement, flow_type: 'opening_balance' }, 'natalia')).toBeNull();
    expect(clarificationQuestion({ ...movement, transfer_id: 'transfer' }, 'natalia')).toBeNull();
    expect(clarificationQuestion({ ...movement, category: 'Tratamiento' }, 'natalia')).toBeNull();
    expect(clarificationQuestion({ ...movement, kind: 'expense', context: 'Personal', description: 'Compra lunia' }, 'natalia')).toContain('compraste');
  });
  it('aparta un pago pendiente sin duplicar ingresos ni alterar caja', () => {
    const before = summarize([movement], today().slice(0,7));
    const after = summarize([{ ...movement, category: 'Tratamiento', patient_advance: true, reserved: movement.amount }], today().slice(0,7));
    expect(after.cash).toBe(before.cash);
    expect(after.income).toBe(before.income);
    expect(after.available).toBe(0);
  });
  it('muestra el déficit del consultorio descontando abonos pendientes y permite liberarlos', () => {
    const advance = { ...movement, id: 'advance', amount: 1650000, reserved: 1650000, patient_advance: true };
    const paid = { ...movement, id: 'paid', kind: 'expense' as const, amount: 3030000 };
    expect(officeAfterReserves([movement, advance, paid], today())).toEqual({ reserved: 1650000, net: -1509124 });
    expect(officeAfterReserves([movement, { ...advance, reserve_release_date: today() }, paid], today())).toEqual({ reserved: 0, net: 140876 });
  });
  it('no usa anticipos protegidos para descontar pagos de laboratorio de varios casos', () => {
    const advance = { ...movement, amount: 1650000, reserved: 1650000, patient_advance: true };
    const partial = { ...movement, amount: 500000, reserved: 200000 };
    const paid = { ...movement, kind: 'expense' as const, amount: 300000, from_reserve: true };
    expect(officeAfterReserves([advance, partial, paid], today()).reserved).toBe(1650000);
  });
});

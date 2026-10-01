import { describe, expect, it } from 'vitest';
import { exportCsv, spendingByCategory, summarize, validateTransaction, type Transaction } from '../src/finance';
const income: Transaction = { id: '1', date: '2026-09-15', kind: 'income', amount: 1000000, reserved: 400000, context: 'Consultorio', category: 'Tratamiento', description: 'Abono', from_reserve: false };
const expense: Transaction = { ...income, id: '2', date: '2026-10-01', kind: 'expense', amount: 150000, reserved: 0, from_reserve: true, category: 'Laboratorio', description: 'Laboratorio' };
describe('Disponible y reservas', () => {
  it('conserva las reservas de meses anteriores y no descuenta el laboratorio dos veces', () => {
    const result = summarize([income, expense], '2026-10');
    expect(result.income).toBe(0);
    expect(result.expenses).toBe(150000);
    expect(result.cash).toBe(850000);
    expect(result.reserved).toBe(250000);
    expect(result.available).toBe(600000);
  });
  it('no usa reservas de otra clínica y no incluye movimientos de meses futuros', () => {
    const other = { ...expense, context: 'Clínica 1' as const };
    const future = { ...income, date: '2026-11-01' };
    expect(summarize([income, other, future], '2026-10').available).toBe(450000);
    expect(summarize([income, other, future], '2026-10').reserved).toBe(400000);
  });
  it('el exceso de un gasto de tratamiento sale del disponible', () => {
    const result = summarize([income, { ...expense, amount: 500000 }], '2026-10');
    expect(result.reserved).toBe(0);
    expect(result.available).toBe(500000);
  });
  it('permite saldo negativo y calcula un mes vacío sin NaN', () => {
    expect(summarize([expense], '2026-10').available).toBe(-150000);
    expect(summarize([], '2026-10').available).toBe(0);
  });
});
describe('Validación y exportación', () => {
  it('rechaza dinero fraccionario, reservas excesivas y fechas inválidas', () => {
    expect(validateTransaction(income)).toBeNull();
    expect(validateTransaction({ ...income, amount: 1.5 })).not.toBeNull();
    expect(validateTransaction({ ...income, reserved: 1000001 })).not.toBeNull();
    expect(validateTransaction({ ...income, date: '2026-02-30' })).not.toBeNull();
    expect(validateTransaction({ ...income, context: 'Personal' })).not.toBeNull();
  });
  it('escapa comillas y evita fórmulas en un CSV', () => {
    const csv = exportCsv([{ ...income, description: '=1+1;"test"' }]);
    expect(csv).toContain('"\'=1+1;""test"""');
    expect(csv).toContain('Monto COP');
  });
});

describe('Datos para futuros reportes', () => {
  it('el CSV incluye propietario, periodo, fuente y flujo neto numérico', () => {
    const csv = exportCsv([{ ...expense, user_id: 'persona-1', competence_date: '2026-09-20', flow_type: 'operating' }]);
    expect(csv).toContain('ID persona');
    expect(csv).toContain('Fecha pago');
    expect(csv).toContain('Fecha periodo');
    expect(csv).toContain('"persona-1"');
    expect(csv).toContain('"2026-09-20"');
    expect(csv).toContain('"-150000"');
    expect(csv).not.toContain("'-150000");
  });
  it('exporta el nombre de la fuente sin perder el ID estable', () => {
    const csv = exportCsv([{ ...income, source_id: 'source-1' }], [{ id: 'source-1', name: 'Clínica Natalia', context: 'Consultorio' }]);
    expect(csv).toContain('"source-1"');
    expect(csv).toContain('"Clínica Natalia"');
  });
});

describe('Desglose de gastos', () => {
  it('filtra espacio y mes y excluye financiación y transferencias', () => {
    const personal = { ...expense, id: '3', context: 'Personal' as const, category: 'Alimentación', amount: 30000, from_reserve: false };
    const result = spendingByCategory([expense, personal, { ...personal, flow_type: 'financing' }, { ...personal, flow_type: 'transfer' }, { ...personal, date: '2026-09-01' }], '2026-10', 'Personal');
    expect(result).toEqual([{ category: 'Alimentación', amount: 30000 }]);
  });
});

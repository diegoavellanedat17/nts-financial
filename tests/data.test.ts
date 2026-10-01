import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readSources, readTransactions } from '../src/data';
import { supabase } from '../src/supabase';
vi.mock('../src/supabase', () => ({ supabase: { from: vi.fn() } }));
const calls: { table: string; owner: string; person: string; from: number; to: number }[] = [];
function mockRows(table: string, count: number, failAt?: number) {
  vi.mocked(supabase!.from).mockImplementation((actualTable: string) => {
    let owner = '';
    let person = '';
    const query = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn((column: string, value: string) => { if (column === 'user_id') owner = value; else { expect(column).toBe('person_tag'); person = value; } return query; }),
      order: vi.fn().mockReturnThis(),
      range: vi.fn(async (from: number, to: number) => {
        expect(actualTable).toBe(table);
        calls.push({ table: actualTable, owner, person, from, to });
        if (from === failAt) return { data: null, error: new Error('connection lost') };
        const data = Array.from({ length: Math.min(500, Math.max(0, count - from)) }, (_, i) => table === 'income_sources'
          ? { id: `${from + i}`, name: `Fuente ${from + i}`, context: 'Personal' }
          : { id: `${from + i}`, user_id: owner, date: '2026-10-01', kind: 'income', amount: 100, reserved: 0, from_reserve: false, category: 'Otros', description: 'Ingreso', context: 'Personal' });
        return { data, error: null };
      }),
    };
    return query as never;
  });
}
beforeEach(() => { vi.clearAllMocks(); calls.length = 0; });
describe('Lectura completa para CSV', () => {
  it('lee más de 1000 movimientos sin truncar y siempre filtra por la persona', async () => {
    mockRows('transactions', 1001);
    const rows = await readTransactions('persona-1');
    expect(rows).toHaveLength(1001);
    expect(rows[1000].id).toBe('1000');
    expect(rows[0].competence_date).toBe('2026-10-01');
    expect(calls.map(c => c.from)).toEqual([0, 500, 1000]);
    expect(calls.every(c => c.owner === 'persona-1' && c.person === 'natalia')).toBe(true);
  });
  it('la misma tabla filtra el tag de Diego', async () => {
    mockRows('transactions', 1);
    await readTransactions('cuenta-diego', 'diego');
    expect(calls[0].owner).toBe('cuenta-diego');
    expect(calls[0].person).toBe('diego');
  });
  it('también pagina las fuentes y conserva sus IDs', async () => {
    mockRows('income_sources', 501);
    const rows = await readSources('persona-2');
    expect(rows).toHaveLength(501);
    expect(rows[500].id).toBe('500');
    expect(calls.every(c => c.owner === 'persona-2')).toBe(true);
  });
  it('un fallo en una página impide devolver un CSV parcial', async () => {
    mockRows('transactions', 1001, 500);
    await expect(readTransactions('persona-1')).rejects.toThrow('connection lost');
  });
});

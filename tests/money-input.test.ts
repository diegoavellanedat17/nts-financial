import { expect, it } from 'vitest';
import { formatMoneyInput, parseMoneyInput } from '../lib/moneyInput';
import { money } from '../src/finance';
it('muestra pesos sin decimales y conserva precisión al ingresar saldos', () => {
  expect(money(359776)).toBe('$359.776 COP');
  expect(money(10059779.93)).toBe('$10.059.779 COP');
  expect(money(1462388.73)).toBe('$1.462.388 COP');
  expect(money(4.65,'USD')).toBe('US$4,65 USD');
  expect(formatMoneyInput('359776')).toBe('359.776');
  expect(formatMoneyInput('10059779.93')).toBe('10.059.779,93');
  expect(parseMoneyInput('$10.059.779,93 COP',true)).toBe('10059779.93');
  expect(parseMoneyInput('150.25',true)).toBe('150.25');
  expect(parseMoneyInput('359.776',false)).toBe('359776');
  expect(parseMoneyInput('1.00',true,false)).toBe('100');
  expect(parseMoneyInput('1,23',false)).toBeNull();
  expect(parseMoneyInput('-100',true)).toBeNull();
});

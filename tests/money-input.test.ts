import { expect, it } from 'vitest';
import { formatMoneyInput, parseMoneyInput, formatCommaMoneyInput, parseCommaMoneyInput } from '../lib/moneyInput';
import { money } from '../src/finance';
it('formatea pesos y conserva los centavos del saldo observado', () => {
  expect(money(359776)).toBe('$359.776 COP');
  expect(money(10059779.93)).toBe('$10.059.779,93 COP');
  expect(formatMoneyInput('359776')).toBe('359.776');
  expect(formatMoneyInput('10059779.93')).toBe('10.059.779,93');
  expect(parseMoneyInput('$10.059.779,93 COP',true)).toBe('10059779.93');
  expect(parseMoneyInput('150.25',true)).toBe('150.25');
  expect(parseMoneyInput('359.776',false)).toBe('359776');
  expect(parseMoneyInput('1.00',true,false)).toBe('100');
  expect(parseMoneyInput('1,23',false)).toBeNull();
  expect(parseMoneyInput('-100',true)).toBeNull();
});

it('muestra miles con comas sin cambiar el valor guardado y admite centavos', () => {
 expect(formatCommaMoneyInput('17000')).toBe('17,000');
 expect(parseCommaMoneyInput('$17,000',false)).toBe('17000');
 expect(formatCommaMoneyInput('1030003.93')).toBe('1,030,003.93');
 expect(parseCommaMoneyInput('1,030,003.93',true)).toBe('1030003.93');
 expect(parseCommaMoneyInput('1.030.003,93',true)).toBe('1030003.93');
 expect(parseCommaMoneyInput('17.25',false)).toBeNull();
 expect(parseCommaMoneyInput('-17000',false)).toBeNull();
 expect(parseCommaMoneyInput('17,00',true)).toBe('1700');
 expect(parseCommaMoneyInput('17,00',false)).toBe('1700');
 expect(money(17000,'COP','en-US')).toBe('$17,000 COP');
});

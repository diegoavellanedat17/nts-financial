import { useEffect, useLayoutEffect, useRef, type InputHTMLAttributes } from 'react';
import { formatMoneyInput, parseMoneyInput, formatCommaMoneyInput, parseCommaMoneyInput } from '../lib/moneyInput';
import type { Currency } from './finance';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> & {
  value: string; onValueChange: (value: string) => void; currency: Currency; allowCents?: boolean; commaThousands?: boolean;
};
export function MoneyInput({ value, onValueChange, currency, commaThousands = false, allowCents = currency === 'USD', min = 0, max = 999999999, step, ...props }: Props) {
  const format = commaThousands ? formatCommaMoneyInput : formatMoneyInput;
  const input = useRef<HTMLInputElement>(null);
  const caret = useRef<number | null>(null);
  useLayoutEffect(() => { if (caret.current !== null) { input.current?.setSelectionRange(caret.current,caret.current); caret.current = null; } }, [value]);
  useEffect(() => {
    const amount = Number(value);
    input.current?.setCustomValidity(value && (!Number.isFinite(amount) || amount < Number(min) || amount > Number(max) || (!allowCents && !Number.isInteger(amount))) ? 'Revisa el monto.' : '');
  }, [value, min, max, allowCents]);
  return <span className="money-input"><span aria-hidden="true" data-symbol={currency === 'USD' ? 'US$' : '$'} /><input {...props} ref={input} type="text" inputMode="decimal" role="spinbutton" aria-valuemin={Number(min)} aria-valuemax={Number(max)} aria-valuenow={value ? Number(value) : undefined} value={format(value)} onChange={e => { const native = e.nativeEvent as InputEvent; const raw = commaThousands ? parseCommaMoneyInput(e.target.value,allowCents) : parseMoneyInput(e.target.value,allowCents,!native.inputType?.startsWith('delete')); if (raw !== null) { caret.current = Math.max(0,(e.target.selectionStart || 0) + format(raw).length - e.target.value.length); onValueChange(raw); } }} onKeyDown={e => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); const increment = Number(step || (allowCents ? 0.01 : 1)); const next = Math.min(Number(max), Math.max(Number(min), Math.round((Number(value || 0) + (e.key === 'ArrowUp' ? increment : -increment)) * 100) / 100)); onValueChange(String(next)); }
  }} /></span>;
}

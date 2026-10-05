import type { Transaction } from '../src/finance';

export function clarificationQuestion(t: Transaction, person: string): string | null {
  if (t.balance_check_id || t.transfer_id || (t.flow_type || 'operating') !== 'operating' || t.category !== 'Otros') return null;
  if (t.kind === 'income') return person === 'natalia' && t.context === 'Consultorio' && !t.reserved && !t.patient_advance
    ? '¿Ya entregaste los tratamientos o hay pagos anticipados?' : null;
  if (/rappi/i.test(t.description)) return '¿Qué compraste en Rappi?';
  if (/compra|lunia/i.test(t.description)) return '¿Qué compraste y para qué fue?';
  return '¿Para qué fue este gasto?';
}

export function suggestedExpenseCategory(t: Transaction): string {
  if (/laboratorio/i.test(t.description) && t.context === 'Consultorio') return 'Laboratorio';
  if (/arriendo/i.test(t.description) && t.context === 'Consultorio') return 'Arriendo consultorio';
  if (/almuerzo|desayuno|comida/i.test(t.description)) return 'Alimentación';
  if (/cejas/i.test(t.description)) return 'Bienestar';
  return t.category;
}

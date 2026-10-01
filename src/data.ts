import { personTag } from './person';
import { supabase } from './supabase';
import { contexts, normalizeTransaction, type IncomeSource, type Transaction } from './finance';
export async function readTransactions(userId: string) {
  if (!supabase) throw new Error('Supabase no está conectado.');
  const rows: Transaction[] = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await supabase.from('transactions').select('id,user_id,date,competence_date,flow_type,source_id,kind,amount,context,category,description,reserved,from_reserve,person_tag,counterparty,reference,payment_method').eq('user_id', userId).eq('person_tag', personTag).order('date', { ascending: false }).order('id').range(offset, offset + 499);
    if (error) throw error;
    rows.push(...data.map(t => normalizeTransaction(t as Transaction)));
    if (data.length < 500) return rows;
  }
}
export async function readSources(userId: string): Promise<IncomeSource[]> {
  if (!supabase) throw new Error('Supabase no está conectado.');
  const rows: IncomeSource[] = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await supabase.from('income_sources').select('id,name,context').eq('user_id', userId).eq('person_tag', personTag).order('created_at').order('id').range(offset, offset + 499);
    if (error) throw error;
    rows.push(...data as IncomeSource[]);
    if (data.length < 500) return rows;
  }
}
export async function loadSources(userId: string) {
  const sources = await readSources(userId);
  if (sources.length) return sources;
  // La restricción única hace seguro el primer acceso simultáneo desde varios dispositivos.
  const { error } = await supabase!.from('income_sources').upsert(contexts.map(context => ({ user_id: userId, person_tag: personTag, name: context === 'Personal' ? 'Otro ingreso' : context, context })), { onConflict: 'user_id,person_tag,name', ignoreDuplicates: true });
  if (error) throw error;
  return readSources(userId);
}

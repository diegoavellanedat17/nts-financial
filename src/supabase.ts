import { createClient } from '@supabase/supabase-js';
const url = import.meta.env.VITE_SUPABASE_URL?.trim();
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
const validUrl = url && /^https?:\/\//.test(url) && URL.canParse(url);
export const supabaseConfigError = (url || key) && (!validUrl || !key)
  ? 'La configuración de Supabase está incompleta. Revisa VITE_SUPABASE_URL y VITE_SUPABASE_PUBLISHABLE_KEY, y reinicia o vuelve a desplegar.'
  : '';
export const supabase = validUrl && key ? createClient(url!, key) : null;

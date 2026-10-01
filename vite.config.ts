import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  if (process.env.VERCEL === '1' && (!env.VITE_SUPABASE_URL?.trim() || !env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim())) {
    throw new Error('Configura VITE_SUPABASE_URL y VITE_SUPABASE_PUBLISHABLE_KEY en Vercel antes de desplegar. La versión cloud requiere persistencia en Supabase.');
  }
  return { plugins: [react()] };
});

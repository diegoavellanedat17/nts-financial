import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import trmHandler from './api/trm.ts';
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const serverEnv = loadEnv(mode, process.cwd(), 'SUPABASE_');
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY && serverEnv.SUPABASE_SERVICE_ROLE_KEY) process.env.SUPABASE_SERVICE_ROLE_KEY = serverEnv.SUPABASE_SERVICE_ROLE_KEY;
  if (!process.env.VITE_SUPABASE_URL && env.VITE_SUPABASE_URL) process.env.VITE_SUPABASE_URL = env.VITE_SUPABASE_URL;
  if (process.env.VERCEL === '1' && (!env.VITE_SUPABASE_URL?.trim() || !env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim())) {
    throw new Error('Configura VITE_SUPABASE_URL y VITE_SUPABASE_PUBLISHABLE_KEY en Vercel antes de desplegar. La versión cloud requiere persistencia en Supabase.');
  }
  return { plugins: [react(), { name: 'local-trm-api', configureServer(server) { server.middlewares.use('/api/trm', (req, res) => { void trmHandler(req, res); }); } }] };
});

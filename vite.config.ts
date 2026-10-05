import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import trmHandler from './api/trm.ts';
import chatHandler from './api/chat.ts';
import gmailConnection from './api/gmail/connection.ts';
import gmailCallback from './api/gmail/callback.ts';
import gmailCron from './api/gmail/cron.ts';
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  for (const prefix of ['GOOGLE_', 'GMAIL_', 'CRON_']) for (const [name,value] of Object.entries(loadEnv(mode,process.cwd(),prefix))) if (!process.env[name]) process.env[name]=value;
  const aiEnv = loadEnv(mode, process.cwd(), 'OPENAI_');
  for (const [name, value] of Object.entries(aiEnv)) if (!process.env[name]) process.env[name] = value;
  if (!process.env.VITE_SUPABASE_PUBLISHABLE_KEY && env.VITE_SUPABASE_PUBLISHABLE_KEY) process.env.VITE_SUPABASE_PUBLISHABLE_KEY = env.VITE_SUPABASE_PUBLISHABLE_KEY;
  const serverEnv = loadEnv(mode, process.cwd(), 'SUPABASE_');
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY && serverEnv.SUPABASE_SERVICE_ROLE_KEY) process.env.SUPABASE_SERVICE_ROLE_KEY = serverEnv.SUPABASE_SERVICE_ROLE_KEY;
  if (!process.env.VITE_SUPABASE_URL && env.VITE_SUPABASE_URL) process.env.VITE_SUPABASE_URL = env.VITE_SUPABASE_URL;
  if (process.env.VERCEL === '1' && (!env.VITE_SUPABASE_URL?.trim() || !env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim())) {
    throw new Error('Configura VITE_SUPABASE_URL y VITE_SUPABASE_PUBLISHABLE_KEY en Vercel antes de desplegar. La versión cloud requiere persistencia en Supabase.');
  }
  return { plugins: [react(), { name: 'local-trm-api', configureServer(server) { server.middlewares.use('/api/gmail/connection',(req,res)=>{void gmailConnection(req,res);}); server.middlewares.use('/api/gmail/callback',(req,res)=>{void gmailCallback(req,res);}); server.middlewares.use('/api/gmail/cron',(req,res)=>{void gmailCron(req,res);}); server.middlewares.use('/api/chat', (req, res) => { void chatHandler(req, res); }); server.middlewares.use('/api/trm', (req, res) => { void trmHandler(req, res); }); } }] };
});

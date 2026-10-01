import { spawn } from 'node:child_process';
import { setTimeout } from 'node:timers/promises';
import { mkdir } from 'node:fs/promises';
const origin = 'http://127.0.0.1:4173';
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '4173', '--strictPort'], { stdio: 'ignore', env: process.env });
try {
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null) throw new Error('Vite no pudo iniciar en el puerto 4173.');
    try { ready = (await fetch(origin)).ok; } catch { /* El servidor está iniciando. */ }
    if (ready) break;
    await setTimeout(200);
  }
  if (!ready) throw new Error('Vite no respondió en 20 segundos.');
  await mkdir('artifacts', { recursive: true });
  const test = spawn(process.execPath, ['tests/browser.mjs'], { stdio: 'inherit', env: { ...process.env, APP_URL: origin } });
  const code = await new Promise(resolve => test.on('exit', resolve));
  process.exitCode = code === 0 ? 0 : 1;
} finally { server.kill('SIGTERM'); }

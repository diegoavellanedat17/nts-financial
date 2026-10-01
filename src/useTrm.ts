import { useEffect, useState } from 'react';
import { bogotaToday, validTrm, type Trm } from '../lib/trm';

export function useTrm(enabled: boolean) {
  const [date, setDate] = useState(bogotaToday);
  const [rate, setRate] = useState<Trm | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => { const timer = setInterval(() => setDate(bogotaToday()), 60000); return () => clearInterval(timer); }, []);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    setRate(null); setError('');
    void fetch('/api/trm', { signal: controller.signal, cache: 'no-store' }).then(async response => {
      if (!response.ok) throw new Error('La TRM no está disponible.');
      const next = await response.json();
      if (!validTrm(next, date)) throw new Error('No se recibió una TRM vigente para hoy.');
      if (!controller.signal.aborted) setRate(next);
    }).catch(() => { if (!controller.signal.aborted) setError('No pudimos cargar la TRM de hoy. Puedes ver COP y USD por separado.'); });
    return () => controller.abort();
  }, [enabled, date, attempt]);
  return { rate: rate && rate.date === date ? rate : null, error, retry: () => setAttempt(n => n + 1) };
}

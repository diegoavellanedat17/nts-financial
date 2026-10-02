import { useState, type ReactNode } from 'react';

const brands: Record<string, { file: string; dark?: boolean }> = {
  dentica: { file: 'dentica.png', dark: true },
  sedato: { file: 'sedato.png' },
  bancolombia: { file: 'bancolombia.svg' },
  arq: { file: 'arq.svg', dark: true },
};

// Keep financial names and identifiers intact; branding is presentation only.
export function BrandName({ name = '', compact = false, fallback }: { name?: string; compact?: boolean; fallback?: ReactNode }) {
  const key = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
  const brand = brands[key];
  const [failed, setFailed] = useState('');
  if (!brand || failed === brand.file) return <>{fallback ?? name}</>;
  return <span className={`brand-name${brand.dark ? ' brand-name-dark' : ''}${compact ? ' brand-name-compact' : ''}`}>
    <img src={`/brands/${brand.file}`} alt="" onError={() => setFailed(brand.file)} />
    <span className="brand-accessible-name">{name}</span>
  </span>;
}

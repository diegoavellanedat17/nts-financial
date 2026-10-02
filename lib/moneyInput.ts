export function parseMoneyInput(text: string, decimals: boolean, acceptDotDecimals = true): string | null {
  const clean = text.replace(/(?:US\$|\$|COP|USD|\s)/gi, '');
  if (!clean) return '';
  if (!/^[\d.,]+$/.test(clean)) return null;
  let raw: string;
  if (clean.includes(',')) {
    if (clean.split(',').length > 2) return null;
    raw = clean.replace(/\./g, '').replace(',', '.');
  } else if (decimals && acceptDotDecimals && /^\d+\.\d{0,2}$/.test(clean)) {
    raw = clean;
  } else {
    raw = clean.replace(/\./g, '');
  }
  if (!/^\d+(?:\.\d{0,2})?$/.test(raw) || (!decimals && raw.includes('.'))) return null;
  return raw.replace(/^0+(?=\d)/, '');
}

export function formatMoneyInput(raw: string): string {
  if (!raw) return '';
  const [integer, fraction] = raw.split('.');
  return integer.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + (fraction !== undefined ? ',' + fraction : '');
}

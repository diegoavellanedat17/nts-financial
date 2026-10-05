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

// Comma-grouped input for Diego's Gmail and bank balances. Values remain canonical decimals.
export function parseCommaMoneyInput(text: string, decimals: boolean): string | null {
  const clean = text.replace(/(?:US\$|\$|COP|USD|\s)/gi, '');
  if (!clean) return '';
  if (!/^[\d,.]+$/.test(clean)) return null;
  // Accept pasted Colombian amounts when their decimal comma is unambiguous.
  if (/^\d{1,3}(?:\.\d{3})+,\d{1,2}$/.test(clean) || /^\d{1,3}(?:\.\d{3}){2,}$/.test(clean))
    return parseMoneyInput(clean, decimals);
  const raw = clean.replaceAll(',', '');
  if (!/^\d+(?:\.\d{0,2})?$/.test(raw) || (!decimals && raw.includes('.'))) return null;
  return raw.replace(/^0+(?=\d)/, '');
}
export function formatCommaMoneyInput(raw: string): string {
  if (!raw) return '';
  const [integer, fraction] = raw.split('.');
  return integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (fraction !== undefined ? '.' + fraction : '');
}

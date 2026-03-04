export function formatCurrency(value: unknown): string {
  const num = Number(value);
  if (isNaN(num)) return '$0.00';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num);
}

export function formatPercent(value: unknown): string {
  const num = Number(value);
  if (isNaN(num)) return '0.0%';
  return `${num.toFixed(1)}%`;
}

export function formatNumber(value: unknown): string {
  const num = Number(value);
  if (isNaN(num)) return '0';
  return new Intl.NumberFormat('en-US').format(num);
}

export function formatDate(value: unknown): string {
  if (!value) return 'N/A';
  const str = String(value);
  try {
    const date = new Date(str);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return str;
  }
}

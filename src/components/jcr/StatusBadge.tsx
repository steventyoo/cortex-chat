'use client';

interface StatusBadgeProps {
  variancePct: number | null;
  label?: string;
}

export function getVarianceStatus(variancePct: number | null): {
  label: string;
  className: string;
} {
  if (variancePct == null) return { label: 'N/A', className: 'bg-gray-100 text-gray-500' };

  const abs = Math.abs(variancePct);
  if (abs < 5) return { label: 'ON BUDGET', className: 'bg-emerald-100 text-emerald-700' };
  if (variancePct < -50) return { label: 'CRITICAL', className: 'bg-red-100 text-red-700' };
  if (variancePct > 50) return { label: 'CRITICAL', className: 'bg-red-100 text-red-700' };
  if (variancePct < -5) return { label: 'UNDER', className: 'bg-slate-100 text-slate-600' };
  if (variancePct > 5) return { label: 'OVER', className: 'bg-amber-100 text-amber-700' };
  return { label: 'ON BUDGET', className: 'bg-emerald-100 text-emerald-700' };
}

export default function StatusBadge({ variancePct, label }: StatusBadgeProps) {
  const status = getVarianceStatus(variancePct);
  const displayLabel = label || status.label;

  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold tracking-wide ${status.className}`}>
      {displayLabel}
    </span>
  );
}

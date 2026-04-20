'use client';

const TIER_STYLES: Record<string, string> = {
  'Superintendent': 'bg-gray-800 text-white',
  'Lead Journeyman': 'bg-teal-600 text-white',
  'Journeyman': 'bg-blue-600 text-white',
  'Apprentice': 'bg-amber-500 text-white',
  'Helper': 'bg-gray-300 text-gray-700',
};

interface TierBadgeProps {
  tier: string;
}

export default function TierBadge({ tier }: TierBadgeProps) {
  const style = TIER_STYLES[tier] || 'bg-gray-200 text-gray-600';

  return (
    <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-semibold tracking-wide ${style}`}>
      {tier.toUpperCase()}
    </span>
  );
}

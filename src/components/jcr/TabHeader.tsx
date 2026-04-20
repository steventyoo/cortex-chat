'use client';

interface TabHeaderProps {
  category: string;
  title: string;
  subtitle: string;
  count?: number;
}

export default function TabHeader({ category, title, subtitle, count }: TabHeaderProps) {
  return (
    <div className="mb-4">
      <p className="text-[10px] font-semibold text-[#999] uppercase tracking-widest mb-0.5">{category}</p>
      <h3 className="text-lg font-bold text-[#1a1a1a]">
        {title}
        {count != null && <span className="ml-2 text-sm font-normal text-[#999]">({count})</span>}
      </h3>
      <p className="text-[12px] text-[#888] mt-0.5">{subtitle}</p>
    </div>
  );
}

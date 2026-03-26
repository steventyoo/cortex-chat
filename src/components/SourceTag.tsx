'use client';

import { useState, useRef, useEffect } from 'react';
import { SourceRef } from '@/lib/types';

interface SourceTagProps {
  tag: string;
  source?: SourceRef;
}

export default function SourceTag({ tag, source }: SourceTagProps) {
  const [showTooltip, setShowTooltip] = useState(false);
  const tagRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  const isExtracted = tag.startsWith('V');

  useEffect(() => {
    if (!showTooltip || !tooltipRef.current || !tagRef.current) return;
    const tagRect = tagRef.current.getBoundingClientRect();
    const tooltip = tooltipRef.current;
    const tooltipRect = tooltip.getBoundingClientRect();

    if (tagRect.left + tooltipRect.width > window.innerWidth - 16) {
      tooltip.style.left = 'auto';
      tooltip.style.right = '0';
    }
  }, [showTooltip]);

  return (
    <span className="relative inline-block">
      <span
        ref={tagRef}
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
        className={`
          inline-flex items-center px-[5px] py-[1px] rounded-[4px] text-[11px] font-medium
          leading-[16px] cursor-default align-baseline mx-[1px]
          transition-colors duration-150
          ${isExtracted
            ? 'bg-[#e8f0fe] text-[#1a73e8] hover:bg-[#d2e3fc]'
            : 'bg-[#f0f0f0] text-[#5f6368] hover:bg-[#e4e4e4]'
          }
        `}
      >
        {tag}
      </span>
      {showTooltip && source && (
        <div
          ref={tooltipRef}
          className="absolute bottom-full left-0 mb-1.5 px-2.5 py-1.5 rounded-lg bg-[#1a1a1a] text-white text-[11px] leading-[16px] whitespace-nowrap z-50 shadow-lg pointer-events-none"
        >
          <div className="font-medium">{source.label}</div>
          {source.similarity != null && (
            <div className="text-[#aeaeb2] mt-0.5">
              {(source.similarity * 100).toFixed(0)}% similarity match
            </div>
          )}
          {source.table && (
            <div className="text-[#aeaeb2] mt-0.5">Source: {source.table} table</div>
          )}
        </div>
      )}
    </span>
  );
}

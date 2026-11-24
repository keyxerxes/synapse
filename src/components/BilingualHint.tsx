import React from 'react';
import type { BilingualCopy } from '../engine/bilingual';

interface BilingualHintProps {
  copy: BilingualCopy;
  className?: string;
  compact?: boolean;
}

export const BilingualHint: React.FC<BilingualHintProps> = ({ copy, className = '', compact = false }) => {
  return (
    <div
      className={`flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 leading-snug ${
        compact ? 'text-[11px]' : 'text-[11.5px]'
      } ${className}`}
    >
      <span className="text-[#929CB2]">{copy.en}</span>
      <span dir="rtl" lang="fa" className="font-fa text-[#A8B2C7] text-right">
        {copy.fa}
      </span>
    </div>
  );
};

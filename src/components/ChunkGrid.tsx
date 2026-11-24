import React from 'react';

interface ChunkGridProps {
  totalBlocks: number;
  blockStates: Uint8Array; // 0 = missing, 1 = direct, 2 = XOR-peeled
  solvedCount: number;
  directCount: number;
  peeledCount: number;
  complete: boolean;
  modeLabel?: string;
}

export const ChunkGrid: React.FC<ChunkGridProps> = ({
  totalBlocks,
  blockStates,
  solvedCount,
  directCount,
  peeledCount,
  complete,
  modeLabel = 'Fountain-XOR Block Matrix',
}) => {
  const displayCount = Math.max(1, Math.min(totalBlocks || 32, 256));
  const pct = totalBlocks > 0 ? Math.min(100, (solvedCount / totalBlocks) * 100) : 0;

  // Compress large block arrays (>256 blocks) evenly into 256 visual buckets so rendering stays instant
  const cells: Array<{ state: number; indexLabel: string }> = [];
  if (totalBlocks === 0) {
    for (let i = 0; i < 48; i++) {
      cells.push({ state: 0, indexLabel: `#${i}` });
    }
  } else if (totalBlocks <= 256) {
    for (let i = 0; i < totalBlocks; i++) {
      cells.push({ state: blockStates[i] ?? 0, indexLabel: `Block #${i}` });
    }
  } else {
    const stride = totalBlocks / 256;
    for (let b = 0; b < 256; b++) {
      const start = Math.floor(b * stride);
      const end = Math.min(totalBlocks, Math.floor((b + 1) * stride));
      let hasMissing = false;
      let hasPeeled = false;
      for (let k = start; k < end; k++) {
        const s = blockStates[k] ?? 0;
        if (s === 0) hasMissing = true;
        if (s === 2) hasPeeled = true;
      }
      const state = hasMissing ? 0 : hasPeeled ? 2 : 1;
      cells.push({ state, indexLabel: `Blocks #${start}–${end - 1}` });
    }
  }

  return (
    <section
      className="bg-[#12141A] border border-[#242834] p-4 flex flex-col justify-between"
      aria-label="Chunk reception grid"
      data-testid="chunk-reception-grid"
    >
      <div>
        <div className="mb-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-xs font-semibold text-[#E6E8EE] tracking-wide">{modeLabel}</h3>
            <div className="font-mono-tech text-sm font-semibold text-[#E6E8EE]">
              {solvedCount}
              <span className="text-[#6F788E]"> / {totalBlocks}</span>
              <span className="ml-2 text-xs text-cyan-400">{pct.toFixed(1)}%</span>
            </div>
          </div>
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-[11px] mt-0.5">
            <span className="text-[#8E97AB]">Order-independent erasure recovery</span>
            <span dir="rtl" lang="fa" className="font-fa text-[#A2ACC0]">
              جدول دریافت بسته‌های Fountain-XOR
            </span>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="h-1.5 w-full bg-[#0A0B0E] border border-[#242834] mb-3 overflow-hidden">
          <div
            className={`h-full transition-all duration-150 ${
              complete ? 'bg-emerald-500' : 'bg-cyan-500'
            }`}
            style={{ width: `${pct}%` }}
          />
        </div>

        {/* Discrete 1px Matrix */}
        <div
          className="grid gap-[2px] bg-[#0A0B0E] border border-[#242834] p-2"
          style={{
            gridTemplateColumns: `repeat(${displayCount <= 32 ? 16 : 24}, minmax(0, 1fr))`,
          }}
        >
          {cells.map((cell, idx) => {
            let colorClass = 'bg-[#191D26]';
            if (complete && totalBlocks > 0) {
              colorClass = cell.state === 2 ? 'bg-amber-400/90' : 'bg-emerald-500';
            } else if (cell.state === 1) {
              colorClass = 'bg-cyan-500';
            } else if (cell.state === 2) {
              colorClass = 'bg-amber-500';
            }
            return (
              <div
                key={idx}
                title={cell.indexLabel}
                className={`h-2.5 w-full transition-colors duration-100 ${colorClass}`}
              />
            );
          })}
        </div>
      </div>

      {/* Unboxed Precision Legend */}
      <div className="mt-3 pt-2.5 border-t border-[#242834] flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono-tech text-[#929CB2]">
        <div className="flex items-center gap-4">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block w-2.5 h-2.5 bg-cyan-500" aria-hidden="true" />
            Direct {directCount}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block w-2.5 h-2.5 bg-amber-500" aria-hidden="true" />
            XOR-Peeled {peeledCount}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block w-2.5 h-2.5 bg-[#191D26] border border-[#2E3444]" aria-hidden="true" />
            Missing {Math.max(0, totalBlocks - solvedCount)}
          </span>
        </div>
        <span className={complete ? 'text-emerald-400 font-semibold' : 'text-[#8E97AB]'}>
          {complete ? 'CRC-32 VERIFIED COMPLETE' : totalBlocks > 0 ? 'ACQUIRING DROPLETS' : 'STANDBY'}
        </span>
      </div>
    </section>
  );
};

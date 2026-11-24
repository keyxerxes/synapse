import React from 'react';
import { DENSITY_PROFILES, DensityProfileId } from '../engine/profiles';

interface ChromaCalibrationStripProps {
  profileId: DensityProfileId;
  calibratedPalette?: Array<[number, number, number]> | null;
  meanColorDistance?: number;
}

export const ChromaCalibrationStrip: React.FC<ChromaCalibrationStripProps> = ({
  profileId,
  calibratedPalette,
  meanColorDistance,
}) => {
  const profile = DENSITY_PROFILES[profileId];

  return (
    <div className="border-t border-[#242834] pt-3">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <div className="text-xs text-[#A8B2C7]">
          <span className="font-medium text-[#D6DCE8]">Chroma-Palette Border Calibration</span>
          <span className="mx-2 text-[#454D62]" aria-hidden="true">·</span>
          <span className="font-mono-tech text-[#8E97AB]">{profile.colorCount} Swatches ({profile.bitsPerCell}-bit)</span>
        </div>
        <div className="flex items-center gap-3 text-[11px] font-mono-tech">
          {calibratedPalette ? (
            <span className="text-cyan-400">
              Live Ambient Lock {meanColorDistance !== undefined ? `· ΔE ${meanColorDistance.toFixed(1)}` : ''}
            </span>
          ) : (
            <span className="text-[#8E97AB]">Reference Border Strip</span>
          )}
        </div>
      </div>

      <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${profile.colorCount}, minmax(0, 1fr))` }}>
        {profile.palette.map((nominal, idx) => {
          const cal = calibratedPalette?.[idx];
          const nomCss = `rgb(${nominal[0]}, ${nominal[1]}, ${nominal[2]})`;
          const calCss = cal ? `rgb(${Math.round(cal[0])}, ${Math.round(cal[1])}, ${Math.round(cal[2])})` : nomCss;
          return (
            <div key={idx} className="flex flex-col border border-[#242834]" title={`Symbol ${idx.toString(16).toUpperCase()}`}>
              <div className="h-2.5 w-full" style={{ backgroundColor: nomCss }} />
              {calibratedPalette && (
                <div className="h-2.5 w-full border-t border-black/40" style={{ backgroundColor: calCss }} />
              )}
            </div>
          );
        })}
      </div>
      <div className="mt-1.5 flex items-center justify-between text-[11px] text-[#7D869B]">
        <span>Top: Nominal TX reference · {calibratedPalette ? 'Bottom: Ambient-adapted RX centroids' : 'Embedded along top & bottom optical edges'}</span>
        <span dir="rtl" lang="fa" className="font-fa text-[#929CB2]">
          نوار کالیبراسیون زنده رنگ برای تطبیق با نور محیط
        </span>
      </div>
    </div>
  );
};

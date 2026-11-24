import React from 'react';
import { Play, Square, ShieldCheck, Download, RefreshCw } from 'lucide-react';
import { DensityProfileId, DENSITY_PROFILES } from '../engine/profiles';
import { BILINGUAL } from '../engine/bilingual';
import { BilingualHint } from './BilingualHint';
import { ChromaCalibrationStrip } from './ChromaCalibrationStrip';
import type { RecoveredFileInfo } from './ReceiveStage';

interface LoopbackStageProps {
  profileId: DensityProfileId;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  isRunning: boolean;
  simTint: number;
  simDropPct: number;
  simTearPct: number;
  onChangeSimTint: (v: number) => void;
  onChangeSimDropPct: (v: number) => void;
  onChangeSimTearPct: (v: number) => void;
  onStartLoopback: () => void;
  onStopLoopback: () => void;
  calibratedPalette: Array<[number, number, number]> | null;
  meanColorDistance: number;
  tearGuardRejects: number;
  framesSimulated: number;
  droppedSimulated: number;
  lastFrameOutcome: string;
  txSha256: string | null;
  recoveredFile: RecoveredFileInfo | null;
  verificationMatch: boolean | null;
}

export const LoopbackStage: React.FC<LoopbackStageProps> = ({
  profileId,
  canvasRef,
  isRunning,
  simTint,
  simDropPct,
  simTearPct,
  onChangeSimTint,
  onChangeSimDropPct,
  onChangeSimTearPct,
  onStartLoopback,
  onStopLoopback,
  calibratedPalette,
  meanColorDistance,
  tearGuardRejects,
  framesSimulated,
  droppedSimulated,
  lastFrameOutcome,
  txSha256,
  recoveredFile,
  verificationMatch,
}) => {
  const profile = DENSITY_PROFILES[profileId];

  return (
    <section className="bg-[#12141A] border border-[#242834] p-4 flex flex-col gap-3.5">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#242834] pb-3">
        <div>
          <div className="flex items-center gap-2.5">
            <h2 className="text-sm font-semibold text-[#E6E8EE] tracking-wide">
              End-to-End Air-Gap Loopback Bench
            </h2>
            <span className="text-xs font-mono-tech text-cyan-400">
              {profile.label} ({profile.cols}×{profile.rows})
            </span>
          </div>
          <p className="text-[11px] text-[#8E97AB] mt-0.5 flex flex-wrap items-center gap-x-2">
            <span>Live TX → Ambient Tint / Tear / Packet Drop → Chroma Calibrated RX → Peel &amp; SHA-256 Verify</span>
            <span aria-hidden="true">·</span>
            <span dir="rtl" lang="fa" className="font-fa text-[#A2ACC0]">
              آزمون زنده کل زنجیره ارسال، نویز، کالیبراسیون رنگ و رمزگشایی
            </span>
          </p>
        </div>

        <div className="flex items-center gap-2">
          {!isRunning ? (
            <button
              type="button"
              onClick={onStartLoopback}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-amber-500 text-[#0A0B0E] hover:bg-amber-400 transition-colors whitespace-nowrap shrink-0"
            >
              <Play className="w-3.5 h-3.5" aria-hidden="true" />
              Run Loopback Test
            </button>
          ) : (
            <button
              type="button"
              onClick={onStopLoopback}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-rose-500/20 border border-rose-500/60 text-rose-200 hover:bg-rose-500/30 transition-colors whitespace-nowrap shrink-0"
            >
              <Square className="w-3.5 h-3.5" aria-hidden="true" />
              Halt Test
            </button>
          )}
        </div>
      </div>

      {/* Interactive Channel Impairment Sliders */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="bg-[#0A0B0E] border border-[#242834] p-3">
          <div className="flex items-center justify-between text-xs mb-1.5">
            <label htmlFor="sim-tint" className="font-medium text-[#D6DCE8]">
              Ambient Color Shift
            </label>
            <span className="font-mono-tech text-amber-400">
              {simTint > 0 ? `+${Math.round(simTint * 100)}% Warm` : simTint < 0 ? `${Math.round(simTint * 100)}% Cool` : '0% Neutral'}
            </span>
          </div>
          <input
            id="sim-tint"
            type="range"
            min={-0.75}
            max={0.75}
            step={0.05}
            value={simTint}
            onChange={(e) => onChangeSimTint(Number(e.target.value))}
            className="w-full accent-amber-500"
          />
          <BilingualHint copy={BILINGUAL.settingSimTint} compact className="mt-1" />
        </div>

        <div className="bg-[#0A0B0E] border border-[#242834] p-3">
          <div className="flex items-center justify-between text-xs mb-1.5">
            <label htmlFor="sim-drop" className="font-medium text-[#D6DCE8]">
              Packet Loss Rate
            </label>
            <span className="font-mono-tech text-cyan-400">{simDropPct}%</span>
          </div>
          <input
            id="sim-drop"
            type="range"
            min={0}
            max={40}
            step={5}
            value={simDropPct}
            onChange={(e) => onChangeSimDropPct(Number(e.target.value))}
            className="w-full accent-cyan-500"
          />
          <BilingualHint copy={BILINGUAL.settingSimDrop} compact className="mt-1" />
        </div>

        <div className="bg-[#0A0B0E] border border-[#242834] p-3">
          <div className="flex items-center justify-between text-xs mb-1.5">
            <label htmlFor="sim-tear" className="font-medium text-[#D6DCE8]">
              Rolling-Shutter Tear
            </label>
            <span className="font-mono-tech text-rose-400">{simTearPct}%</span>
          </div>
          <input
            id="sim-tear"
            type="range"
            min={0}
            max={25}
            step={5}
            value={simTearPct}
            onChange={(e) => onChangeSimTearPct(Number(e.target.value))}
            className="w-full accent-rose-500"
          />
          <BilingualHint copy={BILINGUAL.settingSimTear} compact className="mt-1" />
        </div>
      </div>

      {/* Live Channel-Impaired Frame Viewport */}
      <div className="relative w-full aspect-[16/9] bg-[#050608] border border-[#2E3444] overflow-hidden flex items-center justify-center">
        <canvas
          ref={canvasRef}
          width={960}
          height={540}
          data-testid="loopback-canvas"
          className="w-full h-full object-contain pixel-canvas"
        />

        {!isRunning && framesSimulated === 0 && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#07080B]/85 p-6 text-center">
            <RefreshCw className="w-7 h-7 text-amber-400 mb-2.5" aria-hidden="true" />
            <p className="text-sm font-medium text-[#E6E8EE]">Ready for End-to-End Air-Gap Verification</p>
            <p className="text-xs text-[#929CB2] mt-1 max-w-lg">
              Click <strong className="text-amber-300">Run Loopback Test</strong> to encrypt, Gzip-compress, Fountain-encode, apply simulated ambient light &amp; rolling-shutter tears, calibrate, peel, and verify SHA-256 integrity live.
            </p>
          </div>
        )}

        <div className="pointer-events-none absolute inset-x-3 bottom-3 flex flex-wrap items-center justify-between gap-2 bg-[#0A0B0E]/92 border border-[#242834] px-3 py-1.5 text-[11px] font-mono-tech">
          <span className="text-[#C2C9D9]">
            FRAMES: {framesSimulated} · DROPPED: {droppedSimulated} · TEAR GUARD REJECTS:{' '}
            <strong className="text-amber-400">{tearGuardRejects}</strong>
          </span>
          <span className="text-cyan-400">{lastFrameOutcome}</span>
        </div>
      </div>

      {/* Cryptographic Byte-for-Byte Match Banner */}
      {verificationMatch !== null && recoveredFile && (
        <div
          data-testid="loopback-verified-banner"
          className={`p-4 border flex flex-wrap items-center justify-between gap-4 ${
            verificationMatch
              ? 'bg-emerald-500/10 border-emerald-500/45'
              : 'bg-rose-500/10 border-rose-500/45'
          }`}
        >
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-sm font-semibold text-emerald-300">
              <ShieldCheck className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>
                {verificationMatch
                  ? `100% Byte-for-Byte SHA-256 Match Verified (${recoveredFile.fileName})`
                  : 'Checksum Mismatch Detected'}
              </span>
            </div>
            <div className="text-[11px] font-mono-tech text-[#C2C9D9] space-y-0.5">
              <div>TX SHA-256: {txSha256?.slice(0, 32)}…</div>
              <div>RX SHA-256: {recoveredFile.sha256.slice(0, 32)}…</div>
            </div>
            <p dir="rtl" lang="fa" className="font-fa text-[11px] text-emerald-200/90">
              فایل پس از عبور از نویز و کالیبراسیون زنده رنگ، بیت‌به‌بیت مطابق با نسخه اصلی بازیابی شد و سیگنال فراصوت Whisper-ACK ارسال گردید.
            </p>
          </div>
          <a
            href={recoveredFile.blobUrl}
            download={recoveredFile.fileName}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold bg-emerald-500 text-[#0A0B0E] hover:bg-emerald-400 transition-colors whitespace-nowrap shrink-0"
          >
            <Download className="w-3.5 h-3.5" aria-hidden="true" />
            Save Verified File
          </a>
        </div>
      )}

      <ChromaCalibrationStrip
        profileId={profileId}
        calibratedPalette={calibratedPalette}
        meanColorDistance={meanColorDistance}
      />
    </section>
  );
};

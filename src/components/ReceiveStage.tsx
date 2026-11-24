import React, { useRef } from 'react';
import { Camera, Mic, Square, Upload, Volume2, Download, ShieldCheck, AlertTriangle } from 'lucide-react';
import { DensityProfileId, DENSITY_PROFILES, TransferMode } from '../engine/profiles';
import { BILINGUAL } from '../engine/bilingual';
import { BilingualHint } from './BilingualHint';
import { ChromaCalibrationStrip } from './ChromaCalibrationStrip';

export interface RecoveredFileInfo {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  blobUrl: string;
}

interface ReceiveStageProps {
  mode: TransferMode;
  profileId: DensityProfileId;
  cameraActive: boolean;
  micActive: boolean;
  samplerBackend: 'webgl2' | 'canvas2d';
  videoRef: React.RefObject<HTMLVideoElement | null>;
  tearGuardRejects: number;
  lastTearStatus: 'IDLE' | 'PASS' | 'REJECTED';
  calibratedPalette: Array<[number, number, number]> | null;
  meanColorDistance: number;
  rxError: string | null;
  recoveredFile: RecoveredFileInfo | null;
  onStartCamera: () => void;
  onStartMic: () => void;
  onStopRx: () => void;
  onEmitWhisperAck: () => void;
  onImportFrameFile: (file: File) => void;
  onResetDecoder: () => void;
}

export const ReceiveStage: React.FC<ReceiveStageProps> = ({
  mode,
  profileId,
  cameraActive,
  micActive,
  samplerBackend,
  videoRef,
  tearGuardRejects,
  lastTearStatus,
  calibratedPalette,
  meanColorDistance,
  rxError,
  recoveredFile,
  onStartCamera,
  onStartMic,
  onStopRx,
  onEmitWhisperAck,
  onImportFrameFile,
  onResetDecoder,
}) => {
  const frameInputRef = useRef<HTMLInputElement | null>(null);
  const profile = DENSITY_PROFILES[profileId];

  return (
    <section className="bg-[#12141A] border border-[#242834] p-4 flex flex-col gap-3.5">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#242834] pb-3">
        <div>
          <div className="flex items-center gap-2.5">
            <h2 className="text-sm font-semibold text-[#E6E8EE] tracking-wide">
              Optical &amp; Acoustic Receiver Stage
            </h2>
            <span className="text-xs font-mono-tech text-[#8E97AB]">
              Sampler: {samplerBackend.toUpperCase()} · {profile.cols}×{profile.rows}
            </span>
          </div>
          <p className="text-[11px] text-[#8E97AB] mt-0.5 flex flex-wrap items-center gap-x-2">
            <span>Align TX matrix corners inside reticle for live Chroma-Palette lock</span>
            <span aria-hidden="true">·</span>
            <span dir="rtl" lang="fa" className="font-fa text-[#A2ACC0]">
              چهار گوشه ماتریس فرستنده را داخل کادر تراز قرار دهید
            </span>
          </p>
        </div>

        <button
          type="button"
          onClick={onResetDecoder}
          className="px-3 py-1.5 text-xs font-medium bg-[#171A22] border border-[#2E3444] text-[#C2C9D9] hover:text-white hover:border-[#4A536A] transition-colors whitespace-nowrap shrink-0"
        >
          Reset Session
        </button>
      </div>

      {/* RX Controls Bar with Bilingual Hints */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
        <div className="bg-[#0A0B0E] border border-[#242834] p-3 flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            {mode !== 'AUDIO' && (
              <button
                type="button"
                onClick={onStartCamera}
                disabled={cameraActive}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold bg-cyan-500 text-[#0A0B0E] hover:bg-cyan-400 disabled:opacity-45 transition-colors whitespace-nowrap shrink-0"
              >
                <Camera className="w-3.5 h-3.5" aria-hidden="true" />
                {cameraActive ? 'Camera Locked' : 'Start Camera RX'}
              </button>
            )}
            <button
              type="button"
              onClick={onStartMic}
              disabled={micActive}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-[#171A22] border border-[#2E3444] text-[#E6E8EE] hover:border-cyan-500/60 disabled:opacity-45 transition-colors whitespace-nowrap shrink-0"
            >
              <Mic className="w-3.5 h-3.5" aria-hidden="true" />
              {micActive ? 'Mic Listening' : 'Start Mic RX'}
            </button>
            {(cameraActive || micActive) && (
              <button
                type="button"
                onClick={onStopRx}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-rose-500/15 border border-rose-500/50 text-rose-300 hover:bg-rose-500/25 transition-colors whitespace-nowrap shrink-0"
              >
                <Square className="w-3.5 h-3.5" aria-hidden="true" />
                Stop RX
              </button>
            )}
          </div>
          <BilingualHint copy={mode === 'AUDIO' ? BILINGUAL.btnStartRxMic : BILINGUAL.btnStartRxCamera} compact />
        </div>

        <div className="bg-[#0A0B0E] border border-[#242834] p-3 flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={frameInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) onImportFrameFile(file);
                e.target.value = '';
              }}
            />
            <button
              type="button"
              onClick={() => frameInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-[#171A22] border border-[#2E3444] text-[#E6E8EE] hover:border-cyan-500/60 transition-colors whitespace-nowrap shrink-0"
            >
              <Upload className="w-3.5 h-3.5" aria-hidden="true" />
              Import Frame Image
            </button>
            <button
              type="button"
              onClick={onEmitWhisperAck}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-amber-500/15 border border-amber-500/50 text-amber-300 hover:bg-amber-500/25 transition-colors whitespace-nowrap shrink-0"
            >
              <Volume2 className="w-3.5 h-3.5" aria-hidden="true" />
              Emit Whisper-ACK
            </button>
          </div>
          <BilingualHint copy={BILINGUAL.btnEmitAck} compact />
        </div>
      </div>

      {rxError && (
        <div
          role="alert"
          className="flex items-start gap-2.5 bg-rose-500/10 border border-rose-500/40 px-3.5 py-2.5 text-xs text-rose-200"
        >
          <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" aria-hidden="true" />
          <div>
            <p className="font-medium">{rxError}</p>
            <p dir="rtl" lang="fa" className="font-fa text-[11px] text-rose-300/90 mt-0.5">
              در صورت نبود دوربین یا دسترسی، می‌توانید از گزینه Import Frame Image یا تب Loopback استفاده کنید.
            </p>
          </div>
        </div>
      )}

      {/* Camera / Alignment Reticle Viewport */}
      <div className="relative w-full aspect-[16/9] bg-[#07080B] border border-[#2E3444] overflow-hidden flex items-center justify-center scope-grid-bg">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className={`w-full h-full object-cover ${cameraActive ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        />

        {/* 4-Corner Optical Alignment Reticles */}
        <div className="pointer-events-none absolute inset-4">
          <div className="absolute top-0 left-0 w-8 h-8 border-t-2 border-l-2 border-amber-400" />
          <div className="absolute top-0 right-0 w-8 h-8 border-t-2 border-r-2 border-cyan-400" />
          <div className="absolute bottom-0 left-0 w-8 h-8 border-b-2 border-l-2 border-cyan-400" />
          <div className="absolute bottom-0 right-0 w-8 h-8 border-b-2 border-r-2 border-amber-400" />
        </div>

        {!cameraActive && (
          <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center">
            <p className="text-sm font-medium text-[#D6DCE8]">
              {micActive
                ? 'Acoustic Mini-OFDM & Ultrasonic Monitor Active'
                : 'Receiver Optical Viewport Standby'}
            </p>
            <p className="text-xs text-[#8E97AB] mt-1 max-w-md">
              Start rear camera to sample live optical frames, or import a captured PNG frame to test direct Fountain-XOR ingestion.
            </p>
            <p dir="rtl" lang="fa" className="font-fa text-xs text-[#9AA3B8] mt-1.5">
              دوربین را فعال کنید یا یک تصویر فریم ذخیره شده را برای رمزگشایی وارد نمایید
            </p>
          </div>
        )}

        {/* Tear Guard HUD Strip */}
        <div className="pointer-events-none absolute inset-x-3 bottom-3 flex items-center justify-between bg-[#0A0B0E]/90 border border-[#242834] px-3 py-1.5 text-[11px] font-mono-tech">
          <span className="text-[#929CB2]">
            TEAR GUARD:{' '}
            <strong
              className={
                lastTearStatus === 'PASS'
                  ? 'text-emerald-400'
                  : lastTearStatus === 'REJECTED'
                    ? 'text-rose-400'
                    : 'text-[#C2C9D9]'
              }
            >
              {lastTearStatus}
            </strong>
          </span>
          <span className="text-[#929CB2]">
            REJECTED TORN FRAMES: <strong className="text-amber-400">{tearGuardRejects}</strong>
          </span>
        </div>
      </div>

      {/* Reconstructed Verified File Card */}
      {recoveredFile && (
        <div className="bg-emerald-500/10 border border-emerald-500/45 p-4 flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-emerald-300 font-semibold text-sm">
              <ShieldCheck className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>File Reconstructed &amp; CRC-32 Verified: {recoveredFile.fileName}</span>
            </div>
            <div className="text-xs font-mono-tech text-[#C2C9D9]">
              {recoveredFile.sizeBytes.toLocaleString()} bytes · SHA-256 {recoveredFile.sha256.slice(0, 24)}…
            </div>
            <BilingualHint copy={BILINGUAL.btnDownloadRecovered} compact />
          </div>
          <a
            href={recoveredFile.blobUrl}
            download={recoveredFile.fileName}
            className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-semibold bg-emerald-500 text-[#0A0B0E] hover:bg-emerald-400 transition-colors whitespace-nowrap shrink-0"
          >
            <Download className="w-4 h-4" aria-hidden="true" />
            Download Recovered File
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

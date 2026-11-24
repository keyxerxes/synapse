import React, { useEffect, useRef } from 'react';
import { Maximize2, Camera, Radio, ShieldCheck, Play, Square } from 'lucide-react';
import { DENSITY_PROFILES, DensityProfileId, getFrameGeometry, TransferMode } from '../engine/profiles';
import { encodeOpticalCells, renderOpticalMatrixToRGBA } from '../engine/optical';
import { BILINGUAL } from '../engine/bilingual';
import { BilingualHint } from './BilingualHint';
import { ChromaCalibrationStrip } from './ChromaCalibrationStrip';

interface TransmitStageProps {
  mode: TransferMode;
  profileId: DensityProfileId;
  isTransmitting: boolean;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  currentSeq: number;
  ringBufferFill: number;
  ringBufferCapacity: number;
  currentDropletId: number;
  ofdmWord: number;
  whisperAckReceived: { freqHz: number; snrDb: number } | null;
  fileName: string | null;
  onStartTx: () => void;
  onStopTx: () => void;
  onExportSnapshotFrame: () => void;
}

export const TransmitStage: React.FC<TransmitStageProps> = ({
  mode,
  profileId,
  isTransmitting,
  canvasRef,
  currentSeq,
  ringBufferFill,
  ringBufferCapacity,
  currentDropletId,
  ofdmWord,
  whisperAckReceived,
  fileName,
  onStartTx,
  onStopTx,
  onExportSnapshotFrame,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const profile = DENSITY_PROFILES[profileId];
  const geom = getFrameGeometry(profileId);

  // Render a genuine deterministic calibration pattern whenever TX is idle so profile changes are immediately visible
  useEffect(() => {
    if (isTransmitting || mode === 'AUDIO') return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const previewBytes = new Uint8Array(geom.rawBytesPerFrame);
    for (let i = 0; i < previewBytes.length; i++) {
      previewBytes[i] = ((i * 53 + 17) ^ (i >> 2)) & 0xff;
    }
    const matrix = encodeOpticalCells(previewBytes, profileId, 0x0a);
    const { rgba, width, height } = renderOpticalMatrixToRGBA(matrix, 1);

    const off = document.createElement('canvas');
    off.width = width;
    off.height = height;
    const offCtx = off.getContext('2d');
    if (!offCtx) return;
    offCtx.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0);

    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(off, 0, 0, canvas.width, canvas.height);
  }, [isTransmitting, mode, profileId, geom.rawBytesPerFrame, canvasRef]);

  const handleFullscreen = () => {
    const el = containerRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else if (el.requestFullscreen) {
      el.requestFullscreen().catch(() => {});
    }
  };

  const seq4 = currentSeq & 0x0f;
  const inv4 = (~seq4) & 0x0f;

  return (
    <section className="bg-[#12141A] border border-[#242834] p-4 flex flex-col gap-3.5">
      {/* Stage Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#242834] pb-3">
        <div>
          <div className="flex items-center gap-2.5">
            <h2 className="text-sm font-semibold text-[#E6E8EE] tracking-wide">
              {mode === 'AUDIO' ? 'Acoustic Mini-OFDM & Chirp Emitter' : 'Optical Matrix Emitter Stage'}
            </h2>
            <span className="text-xs font-mono-tech text-[#8E97AB]">
              {mode === 'AUDIO' ? '16 Subcarriers · 1.6–5.2 kHz' : `${profile.cols}×${profile.rows} · ${profile.colorCount}-Color`}
            </span>
          </div>
          <p className="text-[11px] text-[#8E97AB] mt-0.5 flex flex-wrap items-center gap-x-2">
            <span>
              {fileName ? `Loaded: ${fileName}` : 'Calibration preview · load a file or sample payload to transmit'}
            </span>
            <span aria-hidden="true">·</span>
            <span dir="rtl" lang="fa" className="font-fa text-[#A2ACC0]">
              {isTransmitting ? 'در حال ارسال پیوسته ماتریس نوری' : 'آماده ارسال — پیش‌نمایش الگوی کالیبراسیون'}
            </span>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {!isTransmitting ? (
            <button
              type="button"
              onClick={onStartTx}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold bg-amber-500 text-[#0A0B0E] hover:bg-amber-400 transition-colors whitespace-nowrap shrink-0"
            >
              <Play className="w-3.5 h-3.5" aria-hidden="true" />
              Start TX
            </button>
          ) : (
            <button
              type="button"
              onClick={onStopTx}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold bg-rose-500/20 border border-rose-500 text-rose-200 hover:bg-rose-500/30 transition-colors whitespace-nowrap shrink-0"
            >
              <Square className="w-3.5 h-3.5" aria-hidden="true" />
              Stop TX
            </button>
          )}
          {mode !== 'AUDIO' && (
            <>
              <button
                type="button"
                onClick={onExportSnapshotFrame}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-[#171A22] border border-[#2E3444] text-[#D6DCE8] hover:border-cyan-500/60 hover:text-cyan-300 transition-colors whitespace-nowrap shrink-0"
              >
                <Camera className="w-3.5 h-3.5" aria-hidden="true" />
                Save Frame PNG
              </button>
              <button
                type="button"
                onClick={handleFullscreen}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-[#171A22] border border-[#2E3444] text-[#D6DCE8] hover:border-amber-500/60 hover:text-amber-300 transition-colors whitespace-nowrap shrink-0"
              >
                <Maximize2 className="w-3.5 h-3.5" aria-hidden="true" />
                Fullscreen
              </button>
            </>
          )}
        </div>
      </div>

      {/* Whisper-ACK Confirmation Banner (only shown when detected) */}
      {whisperAckReceived && (
        <div className="flex flex-wrap items-center justify-between gap-2 bg-emerald-500/10 border border-emerald-500/40 px-3.5 py-2 text-xs">
          <div className="flex items-center gap-2 text-emerald-300 font-medium">
            <ShieldCheck className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>
              Whisper-ACK Ultrasonic Lock Confirmed at{' '}
              <span className="font-mono-tech">{(whisperAckReceived.freqHz / 1000).toFixed(2)} kHz</span> (SNR +
              {whisperAckReceived.snrDb} dB)
            </span>
          </div>
          <span dir="rtl" lang="fa" className="font-fa text-emerald-200 text-[11px]">
            تاییدیه فراصوت گیرنده دریافت شد
          </span>
        </div>
      )}

      {/* Main Viewport */}
      {mode === 'AUDIO' ? (
        <div
          className="relative aspect-[16/9] w-full bg-[#07080B] border border-[#242834] scope-grid-bg p-5 flex flex-col justify-between"
          data-testid="tx-audio-constellation"
        >
          <div className="flex items-center justify-between text-xs font-mono-tech text-[#929CB2]">
            <span className="inline-flex items-center gap-2 text-cyan-400">
              <Radio className="w-4 h-4" aria-hidden="true" />
              MINI-OFDM 16-TONE BANK
            </span>
            <span>WORD: 0x{ofdmWord.toString(16).toUpperCase().padStart(4, '0')} · DROPLET #{currentDropletId}</span>
          </div>

          <div className="grid grid-cols-16 gap-1.5 items-end h-44 px-2 py-4 border-y border-[#1E2330]">
            {Array.from({ length: 16 }).map((_, bit) => {
              const active = ((ofdmWord >> bit) & 1) === 1;
              const freqHz = 1600 + bit * 240;
              return (
                <div key={bit} className="flex flex-col items-center gap-1.5 h-full justify-end">
                  <div
                    className={`w-full transition-all duration-100 ${
                      active && isTransmitting
                        ? 'bg-cyan-400 h-[85%]'
                        : active
                          ? 'bg-cyan-500/45 h-[48%]'
                          : 'bg-[#1D222F] h-[14%]'
                    }`}
                  />
                  <span className="font-mono-tech text-[9px] text-[#7D869B]">{(freqHz / 1000).toFixed(1)}k</span>
                </div>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono-tech text-[#8E97AB]">
            <span>Preamble: LoRa Linear FM Up-Chirp (1.1 → 3.9 kHz)</span>
            <span dir="rtl" lang="fa" className="font-fa text-[#A2ACC0]">
              پخش آکوردهای چندفرکانسی OFDM بدون نیاز به دوربین
            </span>
          </div>
        </div>
      ) : (
        <div
          ref={containerRef}
          className="relative w-full aspect-[16/9] bg-[#050608] border border-[#2E3444] overflow-hidden flex items-center justify-center"
        >
          <canvas
            ref={canvasRef}
            width={960}
            height={540}
            data-testid="tx-optical-canvas"
            className="w-full h-full object-contain pixel-canvas"
          />

          {/* Subtle Corner Instrument Telemetry Overlay when Idle */}
          {!isTransmitting && (
            <div className="pointer-events-none absolute inset-x-3 bottom-3 flex items-center justify-between bg-[#0A0B0E]/88 border border-[#242834] px-3 py-1.5 text-[11px] font-mono-tech text-[#C2C9D9]">
              <span>
                CALIBRATION PREVIEW · {geom.dataCells.length.toLocaleString()} DATA CELLS ·{' '}
                {geom.netPayloadBytesPerFrame.toLocaleString()} B/FRAME
              </span>
              <span className="text-amber-400">STANDBY</span>
            </div>
          )}
        </div>
      )}

      {/* Optical Engine Telemetry Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[11px] font-mono-tech">
        <div className="bg-[#0A0B0E] border border-[#242834] px-3 py-2 flex items-center justify-between">
          <span className="text-[#7D869B]">TEAR GUARD PARITY</span>
          <span className="text-[#E6E8EE]">
            TL 0x{seq4.toString(16).toUpperCase()} / BR 0x{inv4.toString(16).toUpperCase()}
          </span>
        </div>
        <div className="bg-[#0A0B0E] border border-[#242834] px-3 py-2 flex items-center justify-between">
          <span className="text-[#7D869B]">IMAGEBITMAP RING</span>
          <span className="text-cyan-400">
            {ringBufferFill} / {ringBufferCapacity} FRAMES
          </span>
        </div>
        <div className="bg-[#0A0B0E] border border-[#242834] px-3 py-2 flex items-center justify-between">
          <span className="text-[#7D869B]">ANCHOR GRID</span>
          <span className="text-[#E6E8EE]">
            4 FIDUCIALS + {geom.internalAnchors.length} INTERNAL
          </span>
        </div>
      </div>

      {mode !== 'AUDIO' && <ChromaCalibrationStrip profileId={profileId} />}

      <BilingualHint copy={BILINGUAL.btnFullscreen} compact />
    </section>
  );
};

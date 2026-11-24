import React, { useEffect, useRef } from 'react';
import { SynapseAudioEngine, detectWhisperAckFromFFT, WHISPER_ACK_BAND } from '../engine/audio';

interface AudioOscilloscopeProps {
  audioEngine: SynapseAudioEngine | null;
  activeMode: 'OPTICAL' | 'AUDIO' | 'HYBRID';
  isActive: boolean;
  whisperAckActive: boolean;
  simulatedOfdmPulse?: number;
  simulatedAckPulse?: number;
  onAckDetected?: (freqHz: number, snrDb: number) => void;
}

export const AudioOscilloscope: React.FC<AudioOscilloscopeProps> = ({
  audioEngine,
  activeMode,
  isActive,
  whisperAckActive,
  simulatedOfdmPulse = 0,
  simulatedAckPulse = 0,
  onAckDetected,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const propsRef = useRef({
    audioEngine,
    activeMode,
    isActive,
    whisperAckActive,
    simulatedOfdmPulse,
    simulatedAckPulse,
    onAckDetected,
  });
  propsRef.current = {
    audioEngine,
    activeMode,
    isActive,
    whisperAckActive,
    simulatedOfdmPulse,
    simulatedAckPulse,
    onAckDetected,
  };

  useEffect(() => {
    let rafId = 0;
    let lastDraw = 0;
    let phase = 0;
    const synthFreq = new Uint8Array(1024);

    const draw = (now: number) => {
      rafId = requestAnimationFrame(draw);
      // Throttle oscilloscope redraw to ~24 FPS to keep CPU lean during 30 FPS optical TX
      if (now - lastDraw < 42) return;
      lastDraw = now;
      phase += 0.14;

      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const {
        audioEngine: engine,
        activeMode: mode,
        isActive: running,
        whisperAckActive: ackListen,
        simulatedOfdmPulse: simOfdm,
        simulatedAckPulse: simAck,
        onAckDetected: notifyAck,
      } = propsRef.current;

      const w = canvas.width;
      const h = canvas.height;
      ctx.fillStyle = '#07080B';
      ctx.fillRect(0, 0, w, h);

      const maxFreqHz = 20_000;
      const freqToX = (hz: number) => Math.round((hz / maxFreqHz) * w);

      // 1. Highlight Mini-OFDM Band (1.4 - 5.6 kHz)
      const ofdmX0 = freqToX(1400);
      const ofdmX1 = freqToX(5600);
      ctx.fillStyle = 'rgba(6, 182, 212, 0.08)';
      ctx.fillRect(ofdmX0, 0, ofdmX1 - ofdmX0, h);

      // 2. Highlight Whisper-ACK Ultrasonic Band (14 - 18 kHz)
      const ackX0 = freqToX(WHISPER_ACK_BAND.minHz);
      const ackX1 = freqToX(WHISPER_ACK_BAND.maxHz);
      ctx.fillStyle = ackListen ? 'rgba(245, 158, 11, 0.12)' : 'rgba(245, 158, 11, 0.05)';
      ctx.fillRect(ackX0, 0, ackX1 - ackX0, h);

      // 3. Coordinate Graticule
      ctx.strokeStyle = 'rgba(46, 52, 68, 0.55)';
      ctx.lineWidth = 1;
      const hzTicks = [2000, 4000, 6000, 10000, 14000, 18000];
      for (const hz of hzTicks) {
        const x = freqToX(hz) + 0.5;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }
      for (let gy = 1; gy <= 3; gy++) {
        const y = Math.round((h * gy) / 4) + 0.5;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }

      // 4. Acquire Live Web Audio FFT or Calibrated Noise Floor + Active Carriers
      const live = engine ? engine.getSpectrum() : null;
      let hasLiveEnergy = false;
      if (live) {
        for (let i = 4; i < live.freq.length; i += 8) {
          if (live.freq[i] > 6) {
            hasLiveEnergy = true;
            break;
          }
        }
      }

      const sampleRate = live?.sampleRate ?? 48_000;
      const fftSize = live?.fftSize ?? 2048;
      const nyquist = sampleRate / 2;
      let freqData = live?.freq ?? synthFreq;

      if (!hasLiveEnergy) {
        // Render low ambient receiver noise floor + visual carrier envelope when actively transmitting in audio/hybrid or loopback
        for (let i = 0; i < synthFreq.length; i++) {
          const hz = (i / synthFreq.length) * nyquist;
          let mag = 12 + Math.sin(i * 0.7 + phase) * 4 + ((i * 17) % 7);

          if ((running && mode !== 'OPTICAL') || simOfdm > 0) {
            // 16 Mini-OFDM harmonic peaks between 1.6 kHz and 5.2 kHz
            if (hz >= 1400 && hz <= 5400) {
              const carrierPos = (hz - 1600) / 240;
              const dist = Math.abs(carrierPos - Math.round(carrierPos));
              const idx = Math.round(carrierPos);
              const activeBit = ((Math.floor(phase * 2 + simOfdm) + idx * 3) & 1) === 1;
              if (dist < 0.18 && activeBit) {
                mag += 145 + Math.sin(phase * 3 + idx) * 28;
              }
            }
          }

          if (simAck > 0 && hz >= 15_200 && hz <= 17_400) {
            const center = 16_300 + Math.sin(phase * 2.5) * 650;
            const d = Math.abs(hz - center);
            if (d < 420) {
              mag += (1 - d / 420) * 195;
            }
          }

          synthFreq[i] = Math.max(0, Math.min(255, Math.round(mag)));
        }
        freqData = synthFreq;
      }

      // Check real ultrasonic Whisper-ACK when listening
      if (ackListen && hasLiveEnergy && notifyAck) {
        const res = detectWhisperAckFromFFT(freqData, sampleRate, fftSize);
        if (res.detected) {
          notifyAck(res.peakFreqHz, res.snrDb);
        }
      }

      // 5. Render Spectrum Trace & Bars (0..20 kHz)
      const bars = 128;
      const barW = w / bars;
      for (let b = 0; b < bars; b++) {
        const hz = ((b + 0.5) / bars) * maxFreqHz;
        const bin = Math.min(freqData.length - 1, Math.floor((hz / nyquist) * freqData.length));
        const val = freqData[bin] / 255;
        const barH = Math.max(1, val * (h - 24));
        const inAckBand = hz >= WHISPER_ACK_BAND.minHz && hz <= WHISPER_ACK_BAND.maxHz;
        const inOfdmBand = hz >= 1400 && hz <= 5600;

        if (inAckBand) {
          ctx.fillStyle = val > 0.38 ? '#F59E0B' : 'rgba(245, 158, 11, 0.55)';
        } else if (inOfdmBand) {
          ctx.fillStyle = val > 0.35 ? '#06B6D4' : 'rgba(6, 182, 212, 0.55)';
        } else {
          ctx.fillStyle = 'rgba(148, 163, 184, 0.42)';
        }

        ctx.fillRect(b * barW, h - 16 - barH, Math.max(1, barW - 1), barH);
      }

      // 6. Crisp Spectrum Envelope Line
      ctx.beginPath();
      ctx.strokeStyle = '#E6E8EE';
      ctx.lineWidth = 1.1;
      for (let b = 0; b < bars; b++) {
        const hz = ((b + 0.5) / bars) * maxFreqHz;
        const bin = Math.min(freqData.length - 1, Math.floor((hz / nyquist) * freqData.length));
        const val = freqData[bin] / 255;
        const x = b * barW + barW * 0.5;
        const y = h - 16 - val * (h - 24);
        if (b === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      // 7. Band Labels & Frequency Scale
      ctx.font = '10px "JetBrains Mono", monospace';
      ctx.fillStyle = '#06B6D4';
      ctx.fillText('MINI-OFDM 1.6–5.2 kHz', ofdmX0 + 6, 14);
      ctx.fillStyle = '#F59E0B';
      ctx.fillText('WHISPER-ACK 14–18 kHz', ackX0 + 6, 14);

      ctx.fillStyle = '#7D869B';
      for (const hz of [0, 4000, 8000, 12000, 14000, 18000]) {
        const x = hz === 0 ? 4 : freqToX(hz) - 10;
        ctx.fillText(`${hz / 1000}k`, x, h - 4);
      }
    };

    rafId = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafId);
  }, []);

  return (
    <section
      className="bg-[#12141A] border border-[#242834] p-4 flex flex-col justify-between"
      aria-label="Live Audio FFT Oscilloscope"
      data-testid="audio-oscilloscope"
    >
      <div className="mb-2.5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-xs font-semibold text-[#E6E8EE] tracking-wide">
            Live Audio FFT Oscilloscope (0–20 kHz)
          </h3>
          <span className="font-mono-tech text-[11px] text-[#8E97AB]">
            FFT 2048 · {audioEngine?.sampleRate ? `${(audioEngine.sampleRate / 1000).toFixed(1)} kHz` : '48.0 kHz'}
          </span>
        </div>
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-[11px] mt-0.5">
          <span className="text-[#8E97AB]">Mini-OFDM carriers &amp; 14–18 kHz Whisper-ACK monitor</span>
          <span dir="rtl" lang="fa" className="font-fa text-[#A2ACC0]">
            اسیلوسکوپ طیف صوتی و باند فراصوت
          </span>
        </div>
      </div>

      <canvas
        ref={canvasRef}
        width={560}
        height={160}
        className="w-full h-[150px] border border-[#242834] bg-[#07080B] cursor-crosshair"
      />

      <div className="mt-2.5 pt-2 border-t border-[#242834] flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono-tech text-[#929CB2]">
        <span>Chirp Sync: 1.1→3.9 kHz Linear FM</span>
        <span className={whisperAckActive ? 'text-amber-400' : 'text-[#7D869B]'}>
          {whisperAckActive ? 'ULTRASONIC ACK ARMED (14–18 kHz)' : 'ULTRASONIC ACK STANDBY'}
        </span>
      </div>
    </section>
  );
};

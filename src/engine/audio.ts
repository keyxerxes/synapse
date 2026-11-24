// Native Web Audio API Mini-OFDM Multi-Tone Chord Modulator, LoRa-Style Linear FM Chirp Sync,
// and Reverse Ultrasonic Whisper-ACK (14–18 kHz) Detector & Emitter.

export const WHISPER_ACK_BAND = {
  minHz: 14_000,
  maxHz: 18_000,
  pilotLoHz: 15_400,
  pilotHiHz: 17_200,
} as const;

export const OFDM_CONFIG = {
  baseFreqHz: 1600,
  carrierSpacingHz: 240,
  carrierCount: 16, // 1600 Hz .. 5200 Hz (2 bytes per OFDM chord symbol)
  symbolDurationSec: 0.065,
  chirpStartHz: 1100,
  chirpEndHz: 3900,
  chirpDurationSec: 0.14,
} as const;

export interface WhisperAckDetection {
  detected: boolean;
  peakFreqHz: number;
  bandPeakDb: number;
  noiseFloorDb: number;
  snrDb: number;
}

// Pure, deterministic FFT band analyzer for 14-18 kHz Whisper-ACK detection
export function detectWhisperAckFromFFT(
  freqData: Uint8Array,
  sampleRate: number,
  fftSize: number,
  thresholdSnrDb = 10,
): WhisperAckDetection {
  const binHz = sampleRate / fftSize;
  const ackStartBin = Math.max(1, Math.floor(WHISPER_ACK_BAND.minHz / binHz));
  const ackEndBin = Math.min(freqData.length - 1, Math.ceil(WHISPER_ACK_BAND.maxHz / binHz));

  // Reference guard band: 11.5–13.5 kHz
  const refStartBin = Math.max(1, Math.floor(11_500 / binHz));
  const refEndBin = Math.min(freqData.length - 1, Math.ceil(13_500 / binHz));

  let refSum = 0;
  let refCount = 0;
  for (let i = refStartBin; i <= refEndBin; i++) {
    refSum += freqData[i];
    refCount++;
  }
  const refAvg = refCount > 0 ? refSum / refCount : 0;

  let peakVal = 0;
  let peakBin = ackStartBin;
  for (let i = ackStartBin; i <= ackEndBin; i++) {
    if (freqData[i] > peakVal) {
      peakVal = freqData[i];
      peakBin = i;
    }
  }

  // Convert 0..255 AnalyserNode byte magnitudes into approximate relative dB delta
  const bandPeakDb = (peakVal / 255) * 100 - 100;
  const noiseFloorDb = (refAvg / 255) * 100 - 100;
  const snrDb = bandPeakDb - noiseFloorDb;

  return {
    detected: peakVal > 95 && snrDb >= thresholdSnrDb,
    peakFreqHz: Math.round(peakBin * binHz),
    bandPeakDb: Number(bandPeakDb.toFixed(1)),
    noiseFloorDb: Number(noiseFloorDb.toFixed(1)),
    snrDb: Number(snrDb.toFixed(1)),
  };
}

// Pure OFDM multi-tone waveform synthesizer for a 16-bit symbol (used both for AudioBuffer playback & tests)
export function synthesizeOfdmSymbolSamples(
  word16: number,
  sampleRate: number,
  durationSec: number = OFDM_CONFIG.symbolDurationSec,
): Float32Array {
  const length = Math.max(64, Math.floor(sampleRate * durationSec));
  const samples = new Float32Array(length);
  const activeFreqs: number[] = [];

  for (let bit = 0; bit < OFDM_CONFIG.carrierCount; bit++) {
    if (((word16 >> bit) & 1) === 1) {
      activeFreqs.push(OFDM_CONFIG.baseFreqHz + bit * OFDM_CONFIG.carrierSpacingHz);
    }
  }
  // Pilot sync carrier at base - spacing so symbol energy is always measurable even for 0x0000
  activeFreqs.push(OFDM_CONFIG.baseFreqHz - OFDM_CONFIG.carrierSpacingHz);

  const scale = 0.7 / Math.max(1, activeFreqs.length);
  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    // Hann window envelope to eliminate click harmonics
    const win = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (length - 1)));
    let v = 0;
    for (let f = 0; f < activeFreqs.length; f++) {
      v += Math.sin(2 * Math.PI * activeFreqs[f] * t);
    }
    samples[i] = v * scale * win;
  }
  return samples;
}

// Pure Goertzel single-frequency DFT demodulator for Mini-OFDM bit recovery
export function goertzelMagnitude(samples: Float32Array, targetFreqHz: number, sampleRate: number): number {
  const n = samples.length;
  const k = Math.round((n * targetFreqHz) / sampleRate);
  const omega = (2 * Math.PI * k) / n;
  const coeff = 2 * Math.cos(omega);
  let s0 = 0;
  let s1 = 0;
  let s2 = 0;
  for (let i = 0; i < n; i++) {
    s0 = samples[i] + coeff * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  const power = s1 * s1 + s2 * s2 - coeff * s1 * s2;
  return Math.sqrt(Math.max(0, power)) / n;
}

export function demodulateOfdmSymbolSamples(samples: Float32Array, sampleRate: number): number {
  const pilotFreq = OFDM_CONFIG.baseFreqHz - OFDM_CONFIG.carrierSpacingHz;
  const pilotMag = goertzelMagnitude(samples, pilotFreq, sampleRate);
  const threshold = Math.max(0.008, pilotMag * 0.45);
  let word16 = 0;
  for (let bit = 0; bit < OFDM_CONFIG.carrierCount; bit++) {
    const freq = OFDM_CONFIG.baseFreqHz + bit * OFDM_CONFIG.carrierSpacingHz;
    if (goertzelMagnitude(samples, freq, sampleRate) >= threshold) {
      word16 |= 1 << bit;
    }
  }
  return word16;
}

export class SynapseAudioEngine {
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private masterGain: GainNode | null = null;
  private micStream: MediaStream | null = null;
  private micSource: MediaStreamAudioSourceNode | null = null;
  private freqBuffer = new Uint8Array(1024);
  private timeBuffer = new Uint8Array(1024);

  ensureContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    const AudioCtx =
      window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return null;

    if (!this.ctx) {
      this.ctx = new AudioCtx();
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 2048;
      this.analyser.smoothingTimeConstant = 0.65;

      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = 0.28;
      this.masterGain.connect(this.analyser);
      this.analyser.connect(this.ctx.destination);

      this.freqBuffer = new Uint8Array(this.analyser.frequencyBinCount);
      this.timeBuffer = new Uint8Array(this.analyser.fftSize);
    }

    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  get sampleRate(): number {
    return this.ctx?.sampleRate ?? 48_000;
  }

  get fftSize(): number {
    return this.analyser?.fftSize ?? 2048;
  }

  // Emit LoRa-style Linear FM Chirp Sync Preamble
  emitChirpSync(durationSec: number = OFDM_CONFIG.chirpDurationSec): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const env = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(OFDM_CONFIG.chirpStartHz, now);
    osc.frequency.exponentialRampToValueAtTime(OFDM_CONFIG.chirpEndHz, now + durationSec);

    env.gain.setValueAtTime(0.001, now);
    env.gain.linearRampToValueAtTime(0.65, now + 0.015);
    env.gain.setValueAtTime(0.65, now + durationSec - 0.02);
    env.gain.linearRampToValueAtTime(0.001, now + durationSec);

    osc.connect(env);
    env.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + durationSec + 0.01);
  }

  // Emit a Mini-OFDM multi-tone chord representing 2 bytes (16 bits across 16 orthogonal subcarriers)
  emitOfdmChord(word16: number, durationSec: number = OFDM_CONFIG.symbolDurationSec): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;

    const samples = synthesizeOfdmSymbolSamples(word16, ctx.sampleRate, durationSec);
    const buf = ctx.createBuffer(1, samples.length, ctx.sampleRate);
    buf.copyToChannel(samples as Float32Array<ArrayBuffer>, 0);

    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.masterGain);
    src.start();
  }

  // Emit Whisper-ACK reverse ultrasonic feedback chirp (15.4 kHz -> 17.2 kHz inside 14-18 kHz band)
  emitWhisperAck(durationSec = 0.24): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;

    const now = ctx.currentTime;
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const env = ctx.createGain();

    osc1.type = 'sine';
    osc2.type = 'sine';
    osc1.frequency.setValueAtTime(WHISPER_ACK_BAND.pilotLoHz, now);
    osc1.frequency.linearRampToValueAtTime(WHISPER_ACK_BAND.pilotHiHz, now + durationSec);
    osc2.frequency.setValueAtTime(WHISPER_ACK_BAND.pilotHiHz, now);
    osc2.frequency.linearRampToValueAtTime(WHISPER_ACK_BAND.pilotLoHz, now + durationSec);

    env.gain.setValueAtTime(0.001, now);
    env.gain.linearRampToValueAtTime(0.55, now + 0.02);
    env.gain.setValueAtTime(0.55, now + durationSec - 0.03);
    env.gain.linearRampToValueAtTime(0.001, now + durationSec);

    osc1.connect(env);
    osc2.connect(env);
    env.connect(this.masterGain);

    osc1.start(now);
    osc2.start(now);
    osc1.stop(now + durationSec + 0.02);
    osc2.stop(now + durationSec + 0.02);
  }

  async attachMicrophone(): Promise<boolean> {
    const ctx = this.ensureContext();
    if (!ctx || !this.analyser || !navigator.mediaDevices?.getUserMedia) return false;

    try {
      this.detachMicrophone();
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      this.micStream = stream;
      this.micSource = ctx.createMediaStreamSource(stream);
      // Connect mic to analyser ONLY (not destination) to prevent acoustic feedback howling
      const rxAnalyser = ctx.createAnalyser();
      rxAnalyser.fftSize = 2048;
      rxAnalyser.smoothingTimeConstant = 0.55;
      this.micSource.connect(rxAnalyser);
      this.analyser = rxAnalyser;
      this.freqBuffer = new Uint8Array(rxAnalyser.frequencyBinCount);
      this.timeBuffer = new Uint8Array(rxAnalyser.fftSize);
      return true;
    } catch {
      return false;
    }
  }

  detachMicrophone(): void {
    if (this.micSource) {
      this.micSource.disconnect();
      this.micSource = null;
    }
    if (this.micStream) {
      for (const track of this.micStream.getTracks()) track.stop();
      this.micStream = null;
    }
    if (this.ctx && this.masterGain) {
      const txAnalyser = this.ctx.createAnalyser();
      txAnalyser.fftSize = 2048;
      txAnalyser.smoothingTimeConstant = 0.65;
      this.masterGain.disconnect();
      this.masterGain.connect(txAnalyser);
      txAnalyser.connect(this.ctx.destination);
      this.analyser = txAnalyser;
      this.freqBuffer = new Uint8Array(txAnalyser.frequencyBinCount);
      this.timeBuffer = new Uint8Array(txAnalyser.fftSize);
    }
  }

  getSpectrum(): { freq: Uint8Array; time: Uint8Array; sampleRate: number; fftSize: number } {
    if (this.analyser) {
      this.analyser.getByteFrequencyData(this.freqBuffer);
      this.analyser.getByteTimeDomainData(this.timeBuffer);
      return {
        freq: this.freqBuffer,
        time: this.timeBuffer,
        sampleRate: this.sampleRate,
        fftSize: this.fftSize,
      };
    }
    return {
      freq: this.freqBuffer,
      time: this.timeBuffer,
      sampleRate: 48_000,
      fftSize: 2048,
    };
  }

  dispose(): void {
    this.detachMicrophone();
    if (this.ctx) {
      this.ctx.close().catch(() => {});
      this.ctx = null;
      this.analyser = null;
      this.masterGain = null;
    }
  }
}

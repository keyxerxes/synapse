import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Radio,
  Download,
  Lock,
  LockOpen,
  FileArchive,
  KeyRound,
  Upload,
  Play,
  Square,
  Sparkles,
  ExternalLink,
  WifiOff,
  Waves,
  Eye,
  Layers,
  Cpu,
} from 'lucide-react';
import {
  DENSITY_PROFILES,
  DensityProfileId,
  estimateThroughputKBps,
  getFrameGeometry,
  TransferMode,
} from './engine/profiles';
import { BILINGUAL } from './engine/bilingual';
import {
  decryptAesGcm,
  encryptAesGcm,
  generateSessionPassphrase,
  gzipCompress,
  gzipDecompress,
  sha256Hex,
} from './engine/crypto';
import {
  FLAG_AES256,
  FLAG_GZIP,
  FountainDecoder,
  FountainEncoder,
  packFileEnvelope,
  unpackFileEnvelope,
} from './engine/fountain';
import {
  applySimulatedChannelEffects,
  decodeOpticalFrameFromRGBA,
  encodeOpticalCells,
  OpticalBitmapRingBuffer,
  OpticalFastSampler,
  renderOpticalMatrixToRGBA,
} from './engine/optical';
import { SynapseAudioEngine } from './engine/audio';
import { triggerStandaloneOfflineDownload } from './engine/standaloneExport';
import { useOnlineStatus, usePWAInstall } from './hooks/usePWAInstall';
import { BilingualHint } from './components/BilingualHint';
import { PWAInstallControl } from './components/PWAInstallControl';
import { AudioOscilloscope } from './components/AudioOscilloscope';
import { ChunkGrid } from './components/ChunkGrid';
import { TransmitStage } from './components/TransmitStage';
import { ReceiveStage, RecoveredFileInfo } from './components/ReceiveStage';
import { LoopbackStage } from './components/LoopbackStage';

type WorkspaceTab = 'TX' | 'RX' | 'LOOPBACK';

interface LoadedPayload {
  fileName: string;
  mimeType: string;
  bytes: Uint8Array;
}

function buildSamplePayload(sizeBytes = 49_152): LoadedPayload {
  const header = new TextEncoder().encode(
    'SYNAPSE-AIRGAP-TELEMETRY-SAMPLE\nMODE:FOUNTAIN-XOR+AES-256-GCM+GZIP\nGITHUB:https://github.com/keyxerxes\n---\n',
  );
  const bytes = new Uint8Array(sizeBytes);
  bytes.set(header, 0);
  // Mix semi-compressible structured telemetry with pseudo-random binary entropy
  let x = 0x51a95e25;
  for (let i = header.length; i < sizeBytes; i++) {
    if ((i & 63) < 24) {
      bytes[i] = 48 + (i % 10);
    } else {
      x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
      bytes[i] = (x >>> 24) & 0xff;
    }
  }
  return {
    fileName: 'synapse-telemetry-48kb.bin',
    mimeType: 'application/octet-stream',
    bytes,
  };
}

export default function App() {
  const isOnline = useOnlineStatus();
  const { isOfflineReady } = usePWAInstall();

  // Workspace & Transceiver Configuration
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('TX');
  const [mode, setMode] = useState<TransferMode>('HYBRID');
  const [profileId, setProfileId] = useState<DensityProfileId>('TURBO');
  const [targetFps, setTargetFps] = useState<number>(25);
  const [enableEncryption, setEnableEncryption] = useState<boolean>(true);
  const [passphrase, setPassphrase] = useState<string>('SYNAPSE-K7M4-X9Q2');
  const [enableCompression, setEnableCompression] = useState<boolean>(true);
  const [enableWhisperAck, setEnableWhisperAck] = useState<boolean>(true);

  // Loaded Payload State
  const [payload, setPayload] = useState<LoadedPayload>(() => buildSamplePayload(49_152));
  const [preparedStats, setPreparedStats] = useState<{
    rawBytes: number;
    encodedBytes: number;
    totalBlocks: number;
    sha256: string | null;
  }>({ rawBytes: 49_152, encodedBytes: 49_152, totalBlocks: 0, sha256: null });

  // TX Live Runtime State
  const [isTransmitting, setIsTransmitting] = useState(false);
  const [txFramesSent, setTxFramesSent] = useState(0);
  const [txCurrentSeq, setTxCurrentSeq] = useState(0);
  const [txCurrentDropletId, setTxCurrentDropletId] = useState(0);
  const [txMeasuredKBps, setTxMeasuredKBps] = useState(0);
  const [txMeasuredFps, setTxMeasuredFps] = useState(0);
  const [ringBufferFill, setRingBufferFill] = useState(0);
  const [ofdmWord, setOfdmWord] = useState(0x5a3c);
  const [whisperAckReceived, setWhisperAckReceived] = useState<{ freqHz: number; snrDb: number } | null>(null);
  const [txBlockPreviewStates, setTxBlockPreviewStates] = useState<Uint8Array>(new Uint8Array(0));

  // RX Live Runtime State
  const [cameraActive, setCameraActive] = useState(false);
  const [micActive, setMicActive] = useState(false);
  const [samplerBackend, setSamplerBackend] = useState<'webgl2' | 'canvas2d'>('canvas2d');
  const [rxError, setRxError] = useState<string | null>(null);
  const [rxTearRejects, setRxTearRejects] = useState(0);
  const [rxLastTearStatus, setRxLastTearStatus] = useState<'IDLE' | 'PASS' | 'REJECTED'>('IDLE');
  const [rxCalibratedPalette, setRxCalibratedPalette] = useState<Array<[number, number, number]> | null>(null);
  const [rxMeanColorDist, setRxMeanColorDist] = useState(0);
  const [rxMeasuredKBps, setRxMeasuredKBps] = useState(0);
  const [recoveredFile, setRecoveredFile] = useState<RecoveredFileInfo | null>(null);

  // Shared Decoder Telemetry Snapshot (used by RX and Loopback)
  const [decoderSnap, setDecoderSnap] = useState(() => new FountainDecoder().getSnapshot());

  // Loopback Bench State
  const [loopbackRunning, setLoopbackRunning] = useState(false);
  const [simTint, setSimTint] = useState(0.45);
  const [simDropPct, setSimDropPct] = useState(20);
  const [simTearPct, setSimTearPct] = useState(10);
  const [loopbackFrames, setLoopbackFrames] = useState(0);
  const [loopbackDrops, setLoopbackDrops] = useState(0);
  const [loopbackOutcome, setLoopbackOutcome] = useState('STANDBY');
  const [loopbackMatch, setLoopbackMatch] = useState<boolean | null>(null);
  const [simOfdmPulse, setSimOfdmPulse] = useState(0);
  const [simAckPulse, setSimAckPulse] = useState(0);

  // Refs for persistent hardware objects & loops
  const txCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const loopbackCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const rxVideoRef = useRef<HTMLVideoElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const audioEngineRef = useRef<SynapseAudioEngine | null>(null);
  const txTimerRef = useRef<number | null>(null);
  const txRingRef = useRef<OpticalBitmapRingBuffer | null>(null);
  const rxRafRef = useRef<number | null>(null);
  const rxStreamRef = useRef<MediaStream | null>(null);
  const rxSamplerRef = useRef<OpticalFastSampler | null>(null);
  const rxDecoderRef = useRef<FountainDecoder>(new FountainDecoder());
  const loopbackTimerRef = useRef<number | null>(null);
  const recoveredUrlRef = useRef<string | null>(null);

  // Lazy-init Audio Engine
  const getAudioEngine = useCallback(() => {
    if (!audioEngineRef.current) {
      audioEngineRef.current = new SynapseAudioEngine();
    }
    return audioEngineRef.current;
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (txTimerRef.current !== null) clearInterval(txTimerRef.current);
      if (loopbackTimerRef.current !== null) clearInterval(loopbackTimerRef.current);
      if (rxRafRef.current !== null) cancelAnimationFrame(rxRafRef.current);
      txRingRef.current?.dispose();
      rxSamplerRef.current?.dispose();
      if (rxStreamRef.current) {
        rxStreamRef.current.getTracks().forEach((t) => t.stop());
      }
      if (recoveredUrlRef.current) URL.revokeObjectURL(recoveredUrlRef.current);
      audioEngineRef.current?.dispose();
    };
  }, []);

  const theoreticalKBps = useMemo(
    () => estimateThroughputKBps(mode, profileId, targetFps),
    [mode, profileId, targetFps],
  );
  const frameGeom = useMemo(() => getFrameGeometry(profileId), [profileId]);

  // Helper: Prepare encoded bytes (Envelope -> Optional Gzip -> Optional AES-256-GCM)
  const prepareWirePayload = useCallback(
    async (src: LoadedPayload): Promise<{ wireBytes: Uint8Array; flags: number; sha256: string }> => {
      const digest = await sha256Hex(src.bytes);
      let data = packFileEnvelope(src.fileName, src.mimeType, src.bytes);
      let flags = 0;

      if (enableCompression) {
        data = await gzipCompress(data);
        flags |= FLAG_GZIP;
      }
      if (enableEncryption) {
        const key = passphrase.trim() || 'SYNAPSE-DEFAULT-KEY';
        data = await encryptAesGcm(data, key);
        flags |= FLAG_AES256;
      }
      return { wireBytes: data, flags, sha256: digest };
    },
    [enableCompression, enableEncryption, passphrase],
  );

  // Helper: Unpack completed FountainDecoder bytes (AES-256-GCM -> Gzip -> Envelope)
  const finalizeRecoveredStream = useCallback(
    async (rawWire: Uint8Array, flags: number): Promise<RecoveredFileInfo> => {
      let data = rawWire;
      if ((flags & FLAG_AES256) !== 0) {
        const key = passphrase.trim() || 'SYNAPSE-DEFAULT-KEY';
        data = await decryptAesGcm(data, key);
      }
      if ((flags & FLAG_GZIP) !== 0) {
        data = await gzipDecompress(data);
      }
      const env = unpackFileEnvelope(data);
      const digest = await sha256Hex(env.payload);
      if (recoveredUrlRef.current) {
        URL.revokeObjectURL(recoveredUrlRef.current);
      }
      const blob = new Blob([env.payload as BlobPart], { type: env.mimeType || 'application/octet-stream' });
      const blobUrl = URL.createObjectURL(blob);
      recoveredUrlRef.current = blobUrl;

      return {
        fileName: env.fileName,
        mimeType: env.mimeType,
        sizeBytes: env.payload.length,
        sha256: digest,
        blobUrl,
      };
    },
    [passphrase],
  );

  // Stop TX cleanly
  const stopTransmission = useCallback(() => {
    if (txTimerRef.current !== null) {
      clearInterval(txTimerRef.current);
      txTimerRef.current = null;
    }
    txRingRef.current?.dispose();
    txRingRef.current = null;
    setIsTransmitting(false);
    setRingBufferFill(0);
    setTxMeasuredKBps(0);
    setTxMeasuredFps(0);
    setSimOfdmPulse(0);
  }, []);

  // Start TX with Pre-Rendered ImageBitmap Ring Buffer + Optional Mini-OFDM & Chirp Sync
  const startTransmission = useCallback(async () => {
    stopTransmission();
    setWhisperAckReceived(null);

    const { wireBytes, flags, sha256 } = await prepareWirePayload(payload);
    const blockSize = mode === 'AUDIO' ? 64 : frameGeom.netPayloadBytesPerFrame;
    const encoder = new FountainEncoder(wireBytes, blockSize, flags);

    setPreparedStats({
      rawBytes: payload.bytes.length,
      encodedBytes: wireBytes.length,
      totalBlocks: encoder.totalBlocks,
      sha256,
    });
    setTxFramesSent(0);
    setTxCurrentDropletId(0);
    setTxBlockPreviewStates(new Uint8Array(encoder.totalBlocks));
    setIsTransmitting(true);

    const audio = getAudioEngine();
    if (mode !== 'OPTICAL') {
      audio.emitChirpSync();
    }

    const ring = new OpticalBitmapRingBuffer(20);
    txRingRef.current = ring;
    let preRenderSeq = 0;

    const refillRing = async () => {
      if (mode === 'AUDIO') return;
      while (ring.size < 14 && txRingRef.current === ring) {
        const { dropletId, packetBytes } = encoder.nextPacket();
        const matrix = encodeOpticalCells(packetBytes, profileId, preRenderSeq);
        const { rgba, width, height } = renderOpticalMatrixToRGBA(matrix, 1);
        await ring.push(dropletId, preRenderSeq & 0x0f, rgba, width, height);
        preRenderSeq++;
      }
      if (txRingRef.current === ring) {
        setRingBufferFill(ring.size);
      }
    };

    await refillRing();

    const startTime = performance.now();
    let sent = 0;
    const txStates = new Uint8Array(encoder.totalBlocks);
    const intervalMs = mode === 'AUDIO' ? 95 : Math.max(30, Math.round(1000 / targetFps));

    txTimerRef.current = window.setInterval(() => {
      if (mode === 'AUDIO') {
        const { dropletId, packetBytes } = encoder.nextPacket();
        const word = ((packetBytes[dropletId % packetBytes.length] ?? 0xaa) << 8) | (dropletId & 0xff);
        setOfdmWord(word);
        audio.emitOfdmChord(word);
        if (sent % 16 === 0) audio.emitChirpSync();
        sent++;
        txStates[dropletId % encoder.totalBlocks] = dropletId < encoder.totalBlocks ? 1 : 2;
        setTxFramesSent(sent);
        setTxCurrentDropletId(dropletId);
        setTxBlockPreviewStates(new Uint8Array(txStates));
        setTxMeasuredKBps(1.25);
        setTxMeasuredFps(Number((1000 / intervalMs).toFixed(1)));
        setSimOfdmPulse((p) => p + 1);
        return;
      }

      const frame = ring.shift();
      if (!frame) {
        void refillRing();
        return;
      }

      const canvas = txCanvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.imageSmoothingEnabled = false;
          if (frame.bitmap) {
            ctx.drawImage(frame.bitmap, 0, 0, canvas.width, canvas.height);
            frame.bitmap.close();
          } else {
            const tmp = document.createElement('canvas');
            tmp.width = frame.imageData.width;
            tmp.height = frame.imageData.height;
            tmp.getContext('2d')?.putImageData(frame.imageData, 0, 0);
            ctx.drawImage(tmp, 0, 0, canvas.width, canvas.height);
          }
        }
      }

      if (mode === 'HYBRID' && sent % 4 === 0) {
        const keyWord = ((encoder.sessionId >>> ((sent % 4) * 4)) & 0xffff) ^ (frame.dropletId & 0xff);
        setOfdmWord(keyWord);
        audio.emitOfdmChord(keyWord, 0.045);
        setSimOfdmPulse((p) => p + 1);
      }

      sent++;
      const elapsedSec = Math.max(0.05, (performance.now() - startTime) / 1000);
      const measuredKBps = (sent * blockSize) / 1024 / elapsedSec;
      const measuredFps = sent / elapsedSec;

      txStates[frame.dropletId % encoder.totalBlocks] = frame.dropletId < encoder.totalBlocks ? 1 : 2;

      setTxFramesSent(sent);
      setTxCurrentSeq(frame.seq);
      setTxCurrentDropletId(frame.dropletId);
      setTxMeasuredKBps(Number(measuredKBps.toFixed(1)));
      setTxMeasuredFps(Number(measuredFps.toFixed(1)));
      setRingBufferFill(ring.size);
      if (sent % 2 === 0 || sent <= encoder.totalBlocks) {
        setTxBlockPreviewStates(new Uint8Array(txStates));
      }

      if (ring.size < 10) {
        void refillRing();
      }
    }, intervalMs);
  }, [stopTransmission, prepareWirePayload, payload, mode, frameGeom.netPayloadBytesPerFrame, getAudioEngine, profileId, targetFps]);

  // Save current TX Optical Frame as PNG
  const handleExportSnapshotFrame = useCallback(() => {
    const canvas = txCanvasRef.current;
    if (!canvas) return;
    const url = canvas.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = url;
    a.download = `synapse-frame-${profileId.toLowerCase()}.png`;
    a.click();
  }, [profileId]);

  // RX: Stop Camera & Mic
  const stopRx = useCallback(() => {
    if (rxRafRef.current !== null) {
      cancelAnimationFrame(rxRafRef.current);
      rxRafRef.current = null;
    }
    if (rxStreamRef.current) {
      rxStreamRef.current.getTracks().forEach((t) => t.stop());
      rxStreamRef.current = null;
    }
    if (rxVideoRef.current) {
      rxVideoRef.current.srcObject = null;
    }
    audioEngineRef.current?.detachMicrophone();
    setCameraActive(false);
    setMicActive(false);
  }, []);

  // RX: Reset Decoder Session
  const resetDecoder = useCallback(() => {
    rxDecoderRef.current.reset();
    setDecoderSnap(rxDecoderRef.current.getSnapshot());
    setRxTearRejects(0);
    setRxLastTearStatus('IDLE');
    setRxCalibratedPalette(null);
    setRxMeanColorDist(0);
    setRxMeasuredKBps(0);
    setRecoveredFile(null);
    setRxError(null);
  }, []);

  // RX: Decode an RGBA buffer into FountainDecoder
  const processDecodedRgba = useCallback(
    async (rgba: Uint8ClampedArray, width: number, height: number, startedAt: number) => {
      const res = decodeOpticalFrameFromRGBA(rgba, width, height, profileId);
      setRxCalibratedPalette(res.calibratedPalette);

      if (!res.ok) {
        setRxTearRejects((c) => c + 1);
        setRxLastTearStatus('REJECTED');
        return;
      }

      setRxLastTearStatus('PASS');
      setRxMeanColorDist(res.meanColorDistance);
      const dec = rxDecoderRef.current;
      const ingest = dec.ingestRawPacket(res.packetBytes);
      const snap = dec.getSnapshot();
      setDecoderSnap(snap);

      if (ingest.accepted) {
        const elapsedSec = Math.max(0.1, (performance.now() - startedAt) / 1000);
        setRxMeasuredKBps(Number(((snap.solvedCount * frameGeom.netPayloadBytesPerFrame) / 1024 / elapsedSec).toFixed(1)));
      }

      if (snap.complete) {
        const reconstructed = dec.reconstructBytes();
        if (reconstructed) {
          try {
            const info = await finalizeRecoveredStream(reconstructed, snap.flags);
            setRecoveredFile(info);
            setRxError(null);
            if (mode === 'HYBRID' && enableWhisperAck) {
              getAudioEngine().emitWhisperAck();
              setSimAckPulse((p) => p + 1);
            }
          } catch (err) {
            setRxError(
              err instanceof Error
                ? `Decryption/Decompression failed: ${err.message} (check AES-256-GCM passphrase).`
                : 'Decryption failed — verify shared AES-256-GCM passphrase.',
            );
          }
        }
      }
    },
    [profileId, frameGeom.netPayloadBytesPerFrame, finalizeRecoveredStream, mode, enableWhisperAck, getAudioEngine],
  );

  // RX: Start Camera Optical Sampler
  const startRxCamera = useCallback(async () => {
    setRxError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setRxError('Camera API unavailable in this browser context. Use Import Frame Image or Loopback Test.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30 },
        },
        audio: false,
      });
      rxStreamRef.current = stream;
      if (rxVideoRef.current) {
        rxVideoRef.current.srcObject = stream;
        await rxVideoRef.current.play();
      }
      setCameraActive(true);

      const geom = getFrameGeometry(profileId);
      if (!rxSamplerRef.current) {
        rxSamplerRef.current = new OpticalFastSampler(geom.profile.cols, geom.profile.rows);
      } else {
        rxSamplerRef.current.resize(geom.profile.cols, geom.profile.rows);
      }
      setSamplerBackend(rxSamplerRef.current.backend);

      const startedAt = performance.now();
      let lastSample = 0;

      const sampleLoop = (now: number) => {
        rxRafRef.current = requestAnimationFrame(sampleLoop);
        if (now - lastSample < 50) return; // ~20 Hz camera decode cadence
        lastSample = now;
        const vid = rxVideoRef.current;
        const sampler = rxSamplerRef.current;
        if (!vid || !sampler || vid.readyState < 2) return;
        const rgba = sampler.sampleSource(vid);
        if (rgba) {
          void processDecodedRgba(rgba, geom.profile.cols, geom.profile.rows, startedAt);
        }
      };

      rxRafRef.current = requestAnimationFrame(sampleLoop);
    } catch {
      setRxError('Camera permission denied or no camera device detected. Use Import Frame Image or Loopback Test.');
    }
  }, [profileId, processDecodedRgba]);

  // RX: Start Microphone FFT / Mini-OFDM Listener
  const startRxMic = useCallback(async () => {
    setRxError(null);
    const ok = await getAudioEngine().attachMicrophone();
    if (ok) {
      setMicActive(true);
    } else {
      setRxError('Microphone unavailable or permission denied. Acoustic oscilloscope stays in standby.');
    }
  }, [getAudioEngine]);

  // RX: Decode an imported static PNG/JPG frame
  const handleImportFrameFile = useCallback(
    async (file: File) => {
      setRxError(null);
      try {
        const bitmap = await createImageBitmap(file);
        const geom = getFrameGeometry(profileId);
        const canvas = document.createElement('canvas');
        canvas.width = geom.profile.cols;
        canvas.height = geom.profile.rows;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        const rgba = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        bitmap.close();
        await processDecodedRgba(rgba, canvas.width, canvas.height, performance.now());
      } catch {
        setRxError('Could not decode image frame. Ensure the image is a valid SYNAPSE optical matrix capture.');
      }
    },
    [profileId, processDecodedRgba],
  );

  // Stop Loopback Bench
  const stopLoopback = useCallback(() => {
    if (loopbackTimerRef.current !== null) {
      clearInterval(loopbackTimerRef.current);
      loopbackTimerRef.current = null;
    }
    setLoopbackRunning(false);
    setSimOfdmPulse(0);
  }, []);

  // Run Live End-to-End Air-Gap Loopback Test
  const startLoopback = useCallback(async () => {
    stopLoopback();
    stopTransmission();
    resetDecoder();
    setLoopbackMatch(null);
    setLoopbackFrames(0);
    setLoopbackDrops(0);
    setLoopbackOutcome('INITIALIZING CRYPTO & FOUNTAIN PIPELINE');
    setSimAckPulse(0);

    const { wireBytes, flags, sha256 } = await prepareWirePayload(payload);
    // Use selected profile geometry (cap loopback block size cleanly if payload is tiny so multi-block XOR peeling is visibly demonstrated!)
    const geom = getFrameGeometry(profileId);
    const blockSize = Math.min(geom.netPayloadBytesPerFrame, Math.max(256, Math.ceil(wireBytes.length / 24)));
    const encoder = new FountainEncoder(wireBytes, blockSize, flags);
    const decoder = new FountainDecoder();
    rxDecoderRef.current = decoder;

    setPreparedStats({
      rawBytes: payload.bytes.length,
      encodedBytes: wireBytes.length,
      totalBlocks: encoder.totalBlocks,
      sha256,
    });
    setLoopbackRunning(true);

    const startTime = performance.now();
    let seq = 0;
    let totalSent = 0;
    let dropped = 0;
    let tearRejects = 0;
    let completed = false;

    const off = document.createElement('canvas');
    off.width = geom.profile.cols;
    off.height = geom.profile.rows;
    const offCtx = off.getContext('2d');

    loopbackTimerRef.current = window.setInterval(() => {
      if (completed) return;

      const { packetBytes } = encoder.nextPacket();
      const matrix = encodeOpticalCells(packetBytes, profileId, seq);
      const rendered = renderOpticalMatrixToRGBA(matrix, 1);

      totalSent++;
      const roll = ((totalSent * 37 + 11) % 100);
      const injectTear = simTearPct > 0 && roll < simTearPct;
      const injectDrop = !injectTear && simDropPct > 0 && roll < simTearPct + simDropPct;

      let channelRgba: Uint8ClampedArray;
      if (injectTear) {
        const nextMat = encodeOpticalCells(encoder.generatePacket(totalSent + 1), profileId, seq + 1);
        const nextRendered = renderOpticalMatrixToRGBA(nextMat, 1);
        channelRgba = applySimulatedChannelEffects(rendered.rgba, rendered.width, rendered.height, {
          warmTint: simTint,
          noiseLevel: 6,
          nextFrameRgba: nextRendered.rgba,
        });
      } else {
        channelRgba = applySimulatedChannelEffects(rendered.rgba, rendered.width, rendered.height, {
          warmTint: simTint,
          noiseLevel: 5,
        });
      }

      // Draw channel-impaired frame to Loopback Stage canvas
      const stageCanvas = loopbackCanvasRef.current;
      if (stageCanvas && offCtx) {
        offCtx.putImageData(
          new ImageData(new Uint8ClampedArray(channelRgba), rendered.width, rendered.height),
          0,
          0,
        );
        const sCtx = stageCanvas.getContext('2d');
        if (sCtx) {
          sCtx.imageSmoothingEnabled = false;
          sCtx.drawImage(off, 0, 0, stageCanvas.width, stageCanvas.height);
        }
      }

      seq++;
      setLoopbackFrames(totalSent);
      setSimOfdmPulse((p) => p + 1);

      if (injectDrop) {
        dropped++;
        setLoopbackDrops(dropped);
        setLoopbackOutcome(`FRAME #${totalSent} LOST IN CHANNEL (FOUNTAIN-XOR WILL PEEL)`);
        return;
      }

      const decoded = decodeOpticalFrameFromRGBA(channelRgba, rendered.width, rendered.height, profileId);
      setRxCalibratedPalette(decoded.calibratedPalette);

      if (!decoded.ok) {
        tearRejects++;
        setRxTearRejects(tearRejects);
        setRxLastTearStatus('REJECTED');
        setLoopbackOutcome(
          `FRAME #${totalSent} REJECTED BY TEAR GUARD (TL 0x${decoded.seqTL.toString(16).toUpperCase()} ≠ ~BR 0x${decoded.seqBR.toString(16).toUpperCase()})`,
        );
        return;
      }

      setRxLastTearStatus('PASS');
      setRxMeanColorDist(decoded.meanColorDistance);
      const res = decoder.ingestRawPacket(decoded.packetBytes);
      const snap = decoder.getSnapshot();
      setDecoderSnap(snap);

      const elapsedSec = Math.max(0.08, (performance.now() - startTime) / 1000);
      const kbps = (snap.solvedCount * blockSize) / 1024 / elapsedSec;
      setRxMeasuredKBps(Number(kbps.toFixed(1)));

      if (res.accepted) {
        setLoopbackOutcome(
          `FRAME #${totalSent} CALIBRATED & CRC-32 OK · +${res.newlySolved} BLOCK${res.newlySolved === 1 ? '' : 'S'} (${snap.solvedCount}/${snap.totalBlocks})`,
        );
      } else {
        setLoopbackOutcome(`FRAME #${totalSent} REJECTED (${res.reason})`);
      }

      if (snap.complete) {
        completed = true;
        if (loopbackTimerRef.current !== null) {
          clearInterval(loopbackTimerRef.current);
          loopbackTimerRef.current = null;
        }
        setLoopbackRunning(false);
        setSimOfdmPulse(0);
        setSimAckPulse(1);

        const rawOut = decoder.reconstructBytes();
        if (rawOut) {
          void finalizeRecoveredStream(rawOut, snap.flags).then((info) => {
            setRecoveredFile(info);
            const matched = info.sha256 === sha256;
            setLoopbackMatch(matched);
            setLoopbackOutcome(
              matched
                ? '100% RECOVERED · SHA-256 VERIFIED · WHISPER-ACK 16.4 kHz SENT'
                : 'RECOVERED WITH HASH MISMATCH',
            );
            if (enableWhisperAck) {
              try {
                getAudioEngine().emitWhisperAck(0.18);
              } catch {
                // ignore headless audio unlock errors
              }
            }
          });
        }
      }
    }, 65);
  }, [
    stopLoopback,
    stopTransmission,
    resetDecoder,
    prepareWirePayload,
    payload,
    profileId,
    simTearPct,
    simDropPct,
    simTint,
    finalizeRecoveredStream,
    enableWhisperAck,
    getAudioEngine,
  ]);

  const handleFileUpload = useCallback(async (file: File) => {
    const buf = await file.arrayBuffer();
    setPayload({
      fileName: file.name,
      mimeType: file.type || 'application/octet-stream',
      bytes: new Uint8Array(buf),
    });
  }, []);

  const handleSwitchTab = (tab: WorkspaceTab) => {
    if (tab !== activeTab) {
      stopTransmission();
      stopLoopback();
      if (activeTab === 'RX') stopRx();
      setActiveTab(tab);
    }
  };

  // Telemetry metrics computed for the 4-column precision KPI strip
  const activeKBps =
    activeTab === 'TX'
      ? isTransmitting
        ? txMeasuredKBps
        : theoreticalKBps
      : rxMeasuredKBps > 0
        ? rxMeasuredKBps
        : theoreticalKBps;

  const activeKpiSpeedSub =
    activeTab === 'TX'
      ? isTransmitting
        ? `Live measured · Target ${theoreticalKBps} KB/s`
        : `Estimated peak at ${targetFps} FPS`
      : rxMeasuredKBps > 0
        ? `Live decoded throughput`
        : `Profile ceiling (${profileId})`;

  const gridTotalBlocks = activeTab === 'TX' ? preparedStats.totalBlocks : decoderSnap.totalBlocks;
  const gridBlockStates = activeTab === 'TX' ? txBlockPreviewStates : decoderSnap.blockStates;
  const gridSolvedCount =
    activeTab === 'TX'
      ? txBlockPreviewStates.reduce((acc, v) => acc + (v > 0 ? 1 : 0), 0)
      : decoderSnap.solvedCount;
  const gridDirectCount =
    activeTab === 'TX'
      ? txBlockPreviewStates.reduce((acc, v) => acc + (v === 1 ? 1 : 0), 0)
      : decoderSnap.directCount;
  const gridPeeledCount =
    activeTab === 'TX'
      ? txBlockPreviewStates.reduce((acc, v) => acc + (v === 2 ? 1 : 0), 0)
      : decoderSnap.peeledCount;
  const gridComplete =
    activeTab === 'TX'
      ? preparedStats.totalBlocks > 0 && gridSolvedCount === preparedStats.totalBlocks
      : decoderSnap.complete;

  return (
    <div
      className="min-h-screen bg-[#0A0B0E] text-[#E6E8EE] flex flex-col"
      data-workspace={activeTab}
      data-mode={mode}
      data-profile={profileId}
    >
      {/* TOP BAR CONTRACT: Strictly 3 single-line zones */}
      <header className="sticky top-0 z-40 bg-[#0A0B0E]/95 backdrop-blur-xs border-b border-[#242834]">
        <div className="max-w-[1440px] mx-auto px-3 sm:px-6 h-14 flex items-center justify-between gap-2 sm:gap-8">
          {/* Zone 1: Single-line Wordmark */}
          <a
            href="#top"
            onClick={(e) => {
              e.preventDefault();
              handleSwitchTab('TX');
            }}
            className="font-mono-tech text-sm sm:text-base font-bold tracking-[0.12em] sm:tracking-[0.2em] text-[#E6E8EE] whitespace-nowrap shrink-0"
          >
            SYNAPSE
          </a>

          {/* Zone 2: 4 Concise Single-Line Navigation Links */}
          <nav aria-label="Primary navigation" className="flex items-center gap-3 sm:gap-7 text-xs sm:text-sm font-medium">
            <button
              type="button"
              onClick={() => handleSwitchTab('TX')}
              className={`py-1 border-b-2 transition-colors whitespace-nowrap shrink-0 ${
                activeTab === 'TX'
                  ? 'border-amber-400 text-[#E6E8EE]'
                  : 'border-transparent text-[#8E97AB] hover:text-[#E6E8EE]'
              }`}
            >
              Transmit
            </button>
            <button
              type="button"
              onClick={() => handleSwitchTab('RX')}
              className={`py-1 border-b-2 transition-colors whitespace-nowrap shrink-0 ${
                activeTab === 'RX'
                  ? 'border-cyan-400 text-[#E6E8EE]'
                  : 'border-transparent text-[#8E97AB] hover:text-[#E6E8EE]'
              }`}
            >
              Receive
            </button>
            <button
              type="button"
              onClick={() => handleSwitchTab('LOOPBACK')}
              className={`py-1 border-b-2 transition-colors whitespace-nowrap shrink-0 ${
                activeTab === 'LOOPBACK'
                  ? 'border-amber-400 text-[#E6E8EE]'
                  : 'border-transparent text-[#8E97AB] hover:text-[#E6E8EE]'
              }`}
            >
              Loopback
            </button>
            <a
              href="https://github.com/keyxerxes"
              target="_blank"
              rel="noreferrer"
              className="hidden sm:inline-flex items-center gap-1 py-1 border-b-2 border-transparent text-[#8E97AB] hover:text-[#E6E8EE] transition-colors whitespace-nowrap shrink-0"
            >
              GitHub
              <ExternalLink className="w-3 h-3" aria-hidden="true" />
            </a>
          </nav>

          {/* Zone 3: 1 Primary Action */}
          <div className="shrink-0">
            <button
              type="button"
              onClick={triggerStandaloneOfflineDownload}
              aria-label="Download Offline App (.html)"
              className="inline-flex items-center gap-1.5 px-2.5 sm:px-3.5 py-2 text-[11px] sm:text-xs font-semibold bg-amber-500 text-[#0A0B0E] hover:bg-amber-400 transition-colors whitespace-nowrap shrink-0"
            >
              <Download className="w-3.5 h-3.5" aria-hidden="true" />
              <span className="hidden md:inline">Download Offline App (.html)</span>
              <span className="md:hidden">Offline</span>
            </button>
          </div>
        </div>
      </header>

      {/* HARDWARE TELEMETRY & LED STATUS RIBBON */}
      <div className="bg-[#12141A] border-b border-[#242834]">
        <div className="max-w-[1440px] mx-auto px-4 sm:px-6 py-2 flex flex-wrap items-center justify-between gap-3 text-[11px] font-mono-tech">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[#9AA3B8]">
            {/* Genuine Hardware LED Indicators paired strictly with explicit text */}
            <span className="inline-flex items-center gap-1.5">
              <span
                className={`inline-block w-2 h-2 ${
                  isTransmitting || loopbackRunning ? 'bg-amber-400' : 'bg-[#323849]'
                }`}
                aria-hidden="true"
              />
              CARRIER:{' '}
              <strong className={isTransmitting || loopbackRunning ? 'text-amber-400' : 'text-[#C2C9D9]'}>
                {isTransmitting ? 'TX ACTIVE' : loopbackRunning ? 'LOOPBACK' : 'IDLE'}
              </strong>
            </span>

            <span className="inline-flex items-center gap-1.5">
              <span
                className={`inline-block w-2 h-2 ${
                  cameraActive || micActive ? 'bg-cyan-400' : 'bg-[#323849]'
                }`}
                aria-hidden="true"
              />
              RX SENSOR:{' '}
              <strong className={cameraActive || micActive ? 'text-cyan-400' : 'text-[#C2C9D9]'}>
                {cameraActive && micActive
                  ? 'CAM + MIC'
                  : cameraActive
                    ? 'CAMERA'
                    : micActive
                      ? 'MICROPHONE'
                      : 'STANDBY'}
              </strong>
            </span>

            <span className="inline-flex items-center gap-1.5">
              <span
                className={`inline-block w-2 h-2 ${
                  whisperAckReceived || simAckPulse > 0
                    ? 'bg-emerald-400'
                    : enableWhisperAck && mode === 'HYBRID'
                      ? 'bg-amber-500/70'
                      : 'bg-[#323849]'
                }`}
                aria-hidden="true"
              />
              WHISPER-ACK:{' '}
              <strong
                className={
                  whisperAckReceived || simAckPulse > 0
                    ? 'text-emerald-400'
                    : enableWhisperAck && mode === 'HYBRID'
                      ? 'text-amber-300'
                      : 'text-[#8E97AB]'
                }
              >
                {whisperAckReceived || simAckPulse > 0
                  ? 'LOCKED 14–18 kHz'
                  : enableWhisperAck && mode === 'HYBRID'
                    ? 'ARMED 14–18 kHz'
                    : 'OFF'}
              </strong>
            </span>

            <span className="inline-flex items-center gap-1.5">
              <span
                className={`inline-block w-2 h-2 ${!isOnline || isOfflineReady ? 'bg-emerald-400' : 'bg-cyan-500/70'}`}
                aria-hidden="true"
              />
              AIR-GAP:{' '}
              <strong className="text-emerald-400">
                {!isOnline ? 'OFFLINE ISOLATED' : isOfflineReady ? 'SW CACHED' : 'ZERO-API LOCAL'}
              </strong>
            </span>
          </div>

          <div className="flex items-center gap-3">
            {!isOnline && (
              <span className="inline-flex items-center gap-1 text-amber-400">
                <WifiOff className="w-3.5 h-3.5" aria-hidden="true" />
                Offline
              </span>
            )}
            <PWAInstallControl />
          </div>
        </div>
      </div>

      {/* MAIN ASYMMETRIC SPLIT CONSOLE */}
      <main id="top" className="flex-1 max-w-[1440px] w-full mx-auto px-4 sm:px-6 py-5">
        <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] xl:grid-cols-[380px_1fr] gap-5 items-start">
          {/* LEFT CONTROL & PARAMETER COLUMN */}
          <aside className="bg-[#12141A] border border-[#242834] p-4 flex flex-col gap-5">
            {/* 1. Workspace Role Segmented Switch */}
            <div>
              <h1 className="text-xs font-semibold text-[#E6E8EE] uppercase tracking-wider mb-2">
                Transceiver Role
              </h1>
              <div className="grid grid-cols-3 gap-1 bg-[#0A0B0E] border border-[#242834] p-1">
                {(
                  [
                    { id: 'TX', label: 'TX Send' },
                    { id: 'RX', label: 'RX Receive' },
                    { id: 'LOOPBACK', label: 'Loopback' },
                  ] as const
                ).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleSwitchTab(item.id)}
                    className={`py-2 px-2 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                      activeTab === item.id
                        ? item.id === 'RX'
                          ? 'bg-cyan-500 text-[#0A0B0E]'
                          : 'bg-amber-500 text-[#0A0B0E]'
                        : 'text-[#9AA3B8] hover:text-white'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              <BilingualHint
                copy={
                  activeTab === 'TX'
                    ? BILINGUAL.roleTx
                    : activeTab === 'RX'
                      ? BILINGUAL.roleRx
                      : BILINGUAL.roleLoopback
                }
                compact
                className="mt-1.5"
              />
            </div>

            {/* 2. Transfer Mode Selector */}
            <div className="border-t border-[#242834] pt-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-[#E6E8EE] uppercase tracking-wider">
                  Transfer Mode
                </span>
                <span className="font-mono-tech text-[11px] text-cyan-400">{mode}</span>
              </div>

              <div className="space-y-2">
                {(
                  [
                    {
                      id: 'HYBRID' as TransferMode,
                      title: 'HYBRID',
                      sub: 'Optical + Sonic-Key + Whisper-ACK',
                      icon: Layers,
                      hint: BILINGUAL.modeHybrid,
                    },
                    {
                      id: 'OPTICAL' as TransferMode,
                      title: 'OPTICAL ONLY',
                      sub: 'Visual Matrix + Embedded Key',
                      icon: Eye,
                      hint: BILINGUAL.modeOptical,
                    },
                    {
                      id: 'AUDIO' as TransferMode,
                      title: 'AUDIO ONLY',
                      sub: 'Mini-OFDM Chords + Chirp Sync',
                      icon: Waves,
                      hint: BILINGUAL.modeAudio,
                    },
                  ] as const
                ).map((item) => {
                  const Icon = item.icon;
                  const selected = mode === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        if (isTransmitting) stopTransmission();
                        setMode(item.id);
                      }}
                      className={`w-full text-left p-2.5 border transition-colors ${
                        selected
                          ? 'bg-[#171B24] border-amber-500/80'
                          : 'bg-[#0A0B0E] border-[#242834] hover:border-[#3A4154]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="inline-flex items-center gap-2 text-xs font-semibold text-[#E6E8EE]">
                          <Icon
                            className={`w-3.5 h-3.5 ${selected ? 'text-amber-400' : 'text-[#7D869B]'}`}
                            aria-hidden="true"
                          />
                          {item.title}
                        </span>
                        <span className="font-mono-tech text-[10.5px] text-[#8E97AB]">{item.sub}</span>
                      </div>
                      <BilingualHint copy={item.hint} compact className="mt-1.5" />
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 3. Optical Density Profiles (Fallback-Safe) */}
            <div className="border-t border-[#242834] pt-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-[#E6E8EE] uppercase tracking-wider">
                  Optical Density Profile
                </span>
                <span className="font-mono-tech text-[11px] text-amber-400">
                  {DENSITY_PROFILES[profileId].cols}×{DENSITY_PROFILES[profileId].rows}
                </span>
              </div>

              <div className="space-y-2">
                {(
                  [
                    { id: 'TURBO' as DensityProfileId, hint: BILINGUAL.profileTurbo },
                    { id: 'BALANCED' as DensityProfileId, hint: BILINGUAL.profileBalanced },
                    { id: 'ROBUST' as DensityProfileId, hint: BILINGUAL.profileRobust },
                  ] as const
                ).map(({ id, hint }) => {
                  const prof = DENSITY_PROFILES[id];
                  const selected = profileId === id;
                  const disabled = mode === 'AUDIO';
                  return (
                    <button
                      key={id}
                      type="button"
                      disabled={disabled}
                      onClick={() => {
                        if (isTransmitting) stopTransmission();
                        setProfileId(id);
                        setTargetFps(prof.targetFpsDefault);
                      }}
                      className={`w-full text-left p-2.5 border transition-colors disabled:opacity-40 ${
                        selected
                          ? 'bg-[#171B24] border-cyan-500/80'
                          : 'bg-[#0A0B0E] border-[#242834] hover:border-[#3A4154]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-[#E6E8EE]">{prof.label}</span>
                        <span className="font-mono-tech text-[10.5px] text-cyan-400">
                          {prof.cols}×{prof.rows} · {prof.colorCount}c ({prof.bitsPerCell}b)
                        </span>
                      </div>
                      <BilingualHint copy={hint} compact className="mt-1.5" />
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 4. Security, Compression & Cadence Parameters */}
            <div className="border-t border-[#242834] pt-4 space-y-3.5">
              <span className="block text-xs font-semibold text-[#E6E8EE] uppercase tracking-wider">
                Cipher, Compression &amp; Cadence
              </span>

              {/* AES-256-GCM Toggle */}
              <div className="bg-[#0A0B0E] border border-[#242834] p-2.5 space-y-2">
                <div className="flex items-center justify-between">
                  <label htmlFor="toggle-aes" className="inline-flex items-center gap-2 text-xs font-medium text-[#E6E8EE]">
                    {enableEncryption ? (
                      <Lock className="w-3.5 h-3.5 text-emerald-400" aria-hidden="true" />
                    ) : (
                      <LockOpen className="w-3.5 h-3.5 text-[#7D869B]" aria-hidden="true" />
                    )}
                    AES-256-GCM Encryption
                  </label>
                  <input
                    id="toggle-aes"
                    type="checkbox"
                    checked={enableEncryption}
                    onChange={(e) => setEnableEncryption(e.target.checked)}
                    className="h-4 w-4 accent-amber-500"
                  />
                </div>
                <BilingualHint copy={BILINGUAL.settingEncryption} compact />

                {enableEncryption && (
                  <div className="pt-1.5 border-t border-[#1D222E] space-y-1.5">
                    <div className="flex gap-1.5">
                      <input
                        type="text"
                        aria-label="AES-256-GCM Passphrase"
                        value={passphrase}
                        onChange={(e) => setPassphrase(e.target.value)}
                        className="flex-1 min-w-0 bg-[#12141A] border border-[#2E3444] px-2.5 py-1.5 text-xs font-mono-tech text-[#E6E8EE]"
                        placeholder="Passphrase..."
                      />
                      <button
                        type="button"
                        onClick={() => setPassphrase(generateSessionPassphrase())}
                        aria-label="Generate random passphrase"
                        title="Generate random 256-bit passphrase"
                        className="px-2.5 py-1.5 bg-[#171A22] border border-[#2E3444] text-[#D6DCE8] hover:border-amber-500/60 hover:text-amber-300 transition-colors shrink-0"
                      >
                        <KeyRound className="w-3.5 h-3.5" aria-hidden="true" />
                      </button>
                    </div>
                    <BilingualHint copy={BILINGUAL.btnGenerateKey} compact />
                  </div>
                )}
              </div>

              {/* Gzip CompressionStream Toggle */}
              <div className="bg-[#0A0B0E] border border-[#242834] p-2.5 space-y-1.5">
                <div className="flex items-center justify-between">
                  <label htmlFor="toggle-gzip" className="inline-flex items-center gap-2 text-xs font-medium text-[#E6E8EE]">
                    <FileArchive className="w-3.5 h-3.5 text-cyan-400" aria-hidden="true" />
                    Native Gzip CompressionStream
                  </label>
                  <input
                    id="toggle-gzip"
                    type="checkbox"
                    checked={enableCompression}
                    onChange={(e) => setEnableCompression(e.target.checked)}
                    className="h-4 w-4 accent-cyan-500"
                  />
                </div>
                <BilingualHint copy={BILINGUAL.settingCompression} compact />
              </div>

              {/* Frame Rate & Whisper-ACK */}
              <div className="bg-[#0A0B0E] border border-[#242834] p-2.5 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-[#E6E8EE]">Optical Ring-Buffer FPS</span>
                  <div className="flex items-center gap-1">
                    {[15, 25, 30].map((fps) => (
                      <button
                        key={fps}
                        type="button"
                        onClick={() => setTargetFps(fps)}
                        className={`px-2 py-0.5 text-[11px] font-mono-tech border transition-colors ${
                          targetFps === fps
                            ? 'bg-amber-500 text-[#0A0B0E] border-amber-500 font-semibold'
                            : 'bg-[#12141A] text-[#9AA3B8] border-[#242834] hover:text-white'
                        }`}
                      >
                        {fps}
                      </button>
                    ))}
                  </div>
                </div>
                <BilingualHint copy={BILINGUAL.settingFps} compact />

                <div className="pt-2 border-t border-[#1D222E] flex items-center justify-between">
                  <label htmlFor="toggle-ack" className="text-xs font-medium text-[#E6E8EE]">
                    Whisper-ACK (14–18 kHz)
                  </label>
                  <input
                    id="toggle-ack"
                    type="checkbox"
                    checked={enableWhisperAck}
                    onChange={(e) => setEnableWhisperAck(e.target.checked)}
                    className="h-4 w-4 accent-amber-500"
                  />
                </div>
                <BilingualHint copy={BILINGUAL.settingWhisperAck} compact />
              </div>
            </div>

            {/* 5. Payload Selection & Primary Execution Action */}
            {activeTab !== 'RX' && (
              <div className="border-t border-[#242834] pt-4 space-y-3">
                <span className="block text-xs font-semibold text-[#E6E8EE] uppercase tracking-wider">
                  Air-Gap Payload Source
                </span>

                <div className="bg-[#0A0B0E] border border-[#242834] p-3 space-y-2.5">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="font-mono-tech text-[#E6E8EE] truncate" title={payload.fileName}>
                      {payload.fileName}
                    </span>
                    <span className="font-mono-tech text-cyan-400 shrink-0">
                      {(payload.bytes.length / 1024).toFixed(1)} KB
                    </span>
                  </div>

                  <input
                    ref={fileInputRef}
                    type="file"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void handleFileUpload(f);
                      e.target.value = '';
                    }}
                  />

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="inline-flex items-center justify-center gap-1.5 px-2.5 py-2 text-xs font-medium bg-[#171A22] border border-[#2E3444] text-[#E6E8EE] hover:border-cyan-500/60 transition-colors whitespace-nowrap"
                    >
                      <Upload className="w-3.5 h-3.5" aria-hidden="true" />
                      Browse File
                    </button>
                    <button
                      type="button"
                      onClick={() => setPayload(buildSamplePayload(49_152))}
                      className="inline-flex items-center justify-center gap-1.5 px-2.5 py-2 text-xs font-medium bg-[#171A22] border border-[#2E3444] text-[#E6E8EE] hover:border-amber-500/60 transition-colors whitespace-nowrap"
                    >
                      <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
                      48 KB Sample
                    </button>
                  </div>
                  <BilingualHint copy={BILINGUAL.btnSelectFile} compact />
                </div>

                {activeTab === 'TX' && (
                  <div className="space-y-1.5">
                    {!isTransmitting ? (
                      <button
                        type="button"
                        onClick={() => void startTransmission()}
                        className="w-full py-3 px-4 inline-flex items-center justify-center gap-2 text-xs font-bold uppercase tracking-wider bg-amber-500 text-[#0A0B0E] hover:bg-amber-400 transition-colors"
                      >
                        <Play className="w-4 h-4" aria-hidden="true" />
                        Start Transmission
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={stopTransmission}
                        className="w-full py-3 px-4 inline-flex items-center justify-center gap-2 text-xs font-bold uppercase tracking-wider bg-rose-500/20 border border-rose-500 text-rose-200 hover:bg-rose-500/30 transition-colors"
                      >
                        <Square className="w-4 h-4" aria-hidden="true" />
                        Stop Transmission
                      </button>
                    )}
                    <BilingualHint copy={isTransmitting ? BILINGUAL.btnStopTx : BILINGUAL.btnStartTx} compact />
                  </div>
                )}
              </div>
            )}
          </aside>

          {/* RIGHT MAIN VIEWPORT & LIVE TELEMETRY DECK */}
          <div className="flex flex-col gap-5 min-w-0">
            {/* Active Stage Viewport */}
            {activeTab === 'TX' && (
              <TransmitStage
                mode={mode}
                profileId={profileId}
                isTransmitting={isTransmitting}
                canvasRef={txCanvasRef}
                currentSeq={txCurrentSeq}
                ringBufferFill={ringBufferFill}
                ringBufferCapacity={20}
                currentDropletId={txCurrentDropletId}
                ofdmWord={ofdmWord}
                whisperAckReceived={whisperAckReceived}
                fileName={payload.fileName}
                onStartTx={() => void startTransmission()}
                onStopTx={stopTransmission}
                onExportSnapshotFrame={handleExportSnapshotFrame}
              />
            )}

            {activeTab === 'RX' && (
              <ReceiveStage
                mode={mode}
                profileId={profileId}
                cameraActive={cameraActive}
                micActive={micActive}
                samplerBackend={samplerBackend}
                videoRef={rxVideoRef}
                tearGuardRejects={rxTearRejects}
                lastTearStatus={rxLastTearStatus}
                calibratedPalette={rxCalibratedPalette}
                meanColorDistance={rxMeanColorDist}
                rxError={rxError}
                recoveredFile={recoveredFile}
                onStartCamera={() => void startRxCamera()}
                onStartMic={() => void startRxMic()}
                onStopRx={stopRx}
                onEmitWhisperAck={() => {
                  getAudioEngine().emitWhisperAck();
                  setSimAckPulse((p) => p + 1);
                }}
                onImportFrameFile={(f) => void handleImportFrameFile(f)}
                onResetDecoder={resetDecoder}
              />
            )}

            {activeTab === 'LOOPBACK' && (
              <LoopbackStage
                profileId={profileId}
                canvasRef={loopbackCanvasRef}
                isRunning={loopbackRunning}
                simTint={simTint}
                simDropPct={simDropPct}
                simTearPct={simTearPct}
                onChangeSimTint={setSimTint}
                onChangeSimDropPct={setSimDropPct}
                onChangeSimTearPct={setSimTearPct}
                onStartLoopback={() => void startLoopback()}
                onStopLoopback={stopLoopback}
                calibratedPalette={rxCalibratedPalette}
                meanColorDistance={rxMeanColorDist}
                tearGuardRejects={rxTearRejects}
                framesSimulated={loopbackFrames}
                droppedSimulated={loopbackDrops}
                lastFrameOutcome={loopbackOutcome}
                txSha256={preparedStats.sha256}
                recoveredFile={recoveredFile}
                verificationMatch={loopbackMatch}
              />
            )}

            {/* 4-COLUMN PRECISION TELEMETRY KPI STRIP */}
            <section aria-label="Live telemetry metrics" className="grid grid-cols-2 xl:grid-cols-4 gap-3">
              <div className="bg-[#12141A] border border-[#242834] p-3.5">
                <div className="text-[11px] font-mono-tech text-[#8E97AB] uppercase tracking-wider">
                  Link Throughput
                </div>
                <div className="mt-1.5 flex items-baseline">
                  <span className="text-2xl font-mono-tech font-bold text-[#E6E8EE]" data-testid="kpi-throughput">
                    {activeKBps.toFixed(1)}
                  </span>
                  <span className="text-xs font-mono-tech text-amber-400 ml-1.5">KB/s</span>
                </div>
                <div className="mt-1 text-[11px] text-[#7D869B]">{activeKpiSpeedSub}</div>
              </div>

              <div className="bg-[#12141A] border border-[#242834] p-3.5">
                <div className="text-[11px] font-mono-tech text-[#8E97AB] uppercase tracking-wider">
                  {activeTab === 'TX' ? 'Emission Cadence' : 'Packets Accepted'}
                </div>
                <div className="mt-1.5 flex items-baseline">
                  <span className="text-2xl font-mono-tech font-bold text-[#E6E8EE]">
                    {activeTab === 'TX' ? (isTransmitting ? txMeasuredFps.toFixed(1) : targetFps.toFixed(1)) : decoderSnap.packetsAccepted}
                  </span>
                  <span className="text-xs font-mono-tech text-cyan-400 ml-1.5">
                    {activeTab === 'TX' ? 'FPS' : 'PKT'}
                  </span>
                </div>
                <div className="mt-1 text-[11px] text-[#7D869B]">
                  {activeTab === 'TX' ? `Frames emitted: ${txFramesSent}` : `Redundant droplets: ${decoderSnap.redundantPackets}`}
                </div>
              </div>

              <div className="bg-[#12141A] border border-[#242834] p-3.5">
                <div className="text-[11px] font-mono-tech text-[#8E97AB] uppercase tracking-wider">
                  Fountain-XOR Blocks
                </div>
                <div className="mt-1.5 flex items-baseline">
                  <span className="text-2xl font-mono-tech font-bold text-[#E6E8EE]">
                    {gridSolvedCount}
                  </span>
                  <span className="text-xs font-mono-tech text-[#8E97AB] ml-1.5">/ {gridTotalBlocks || '—'}</span>
                </div>
                <div className="mt-1 text-[11px] text-[#7D869B]">
                  {gridPeeledCount > 0 ? `${gridPeeledCount} recovered via XOR peel` : `Net ${frameGeom.netPayloadBytesPerFrame.toLocaleString()} B/frame`}
                </div>
              </div>

              <div className="bg-[#12141A] border border-[#242834] p-3.5">
                <div className="text-[11px] font-mono-tech text-[#8E97AB] uppercase tracking-wider">
                  CRC-32 &amp; Tear Guard
                </div>
                <div className="mt-1.5 flex items-baseline">
                  <span
                    className={`text-2xl font-mono-tech font-bold ${
                      rxTearRejects > 0 || decoderSnap.crcFailures > 0 ? 'text-amber-400' : 'text-emerald-400'
                    }`}
                  >
                    {rxTearRejects}
                  </span>
                  <span className="text-xs font-mono-tech text-[#8E97AB] ml-1.5">TEARS · {decoderSnap.crcFailures} CRC</span>
                </div>
                <div className="mt-1 text-[11px] text-[#7D869B]">
                  {enableEncryption ? 'AES-256-GCM' : 'Plaintext'} · {enableCompression ? 'Gzip ON' : 'Gzip OFF'}
                </div>
              </div>
            </section>

            {/* 2-COLUMN LIVE INSTRUMENTS: CHUNK RECEPTION GRID + AUDIO FFT OSCILLOSCOPE */}
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-5 items-stretch">
              <ChunkGrid
                totalBlocks={gridTotalBlocks}
                blockStates={gridBlockStates}
                solvedCount={gridSolvedCount}
                directCount={gridDirectCount}
                peeledCount={gridPeeledCount}
                complete={gridComplete}
                modeLabel={activeTab === 'TX' ? 'TX Fountain-XOR Block Coverage' : 'RX Chunk Reception Grid'}
              />

              <AudioOscilloscope
                audioEngine={audioEngineRef.current}
                activeMode={mode}
                isActive={isTransmitting || micActive || loopbackRunning}
                whisperAckActive={enableWhisperAck && mode === 'HYBRID'}
                simulatedOfdmPulse={simOfdmPulse}
                simulatedAckPulse={simAckPulse}
                onAckDetected={(freqHz, snrDb) => {
                  setWhisperAckReceived({ freqHz, snrDb });
                }}
              />
            </div>
          </div>
        </div>
      </main>

      {/* QUIET INDUSTRIAL FOOTER */}
      <footer className="mt-8 border-t border-[#242834] bg-[#12141A]">
        <div className="max-w-[1440px] mx-auto px-4 sm:px-6 py-4 flex flex-wrap items-center justify-between gap-4 text-xs text-[#8E97AB]">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-mono-tech font-semibold text-[#D6DCE8] inline-flex items-center gap-1.5">
              <Cpu className="w-3.5 h-3.5 text-amber-400" aria-hidden="true" />
              SYNAPSE
            </span>
            <span aria-hidden="true">·</span>
            <span>100% Client-Side Native Browser APIs (Zero Server / Zero Telemetry)</span>
            <span aria-hidden="true">·</span>
            <a
              href="https://github.com/keyxerxes"
              target="_blank"
              rel="noreferrer"
              className="text-cyan-400 hover:text-cyan-300 inline-flex items-center gap-1"
            >
              github.com/keyxerxes
              <ExternalLink className="w-3 h-3" aria-hidden="true" />
            </a>
          </div>

          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={triggerStandaloneOfflineDownload}
              className="inline-flex items-center gap-1.5 text-amber-400 hover:text-amber-300 font-medium whitespace-nowrap"
            >
              <Radio className="w-3.5 h-3.5" aria-hidden="true" />
              Download Standalone Offline App (.html)
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}

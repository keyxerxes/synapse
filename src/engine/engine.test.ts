import test from 'node:test';
import assert from 'node:assert/strict';

import { crc32 } from './crc32';
import { DENSITY_PROFILES, getFrameGeometry, estimateThroughputKBps } from './profiles';
import {
  FountainEncoder,
  FountainDecoder,
  packFileEnvelope,
  unpackFileEnvelope,
  FLAG_AES256,
  FLAG_GZIP,
} from './fountain';
import {
  encodeOpticalCells,
  renderOpticalMatrixToRGBA,
  decodeOpticalFrameFromRGBA,
  applySimulatedChannelEffects,
} from './optical';
import {
  encryptAesGcm,
  decryptAesGcm,
  gzipCompress,
  gzipDecompress,
  generateSessionPassphrase,
} from './crypto';
import {
  synthesizeOfdmSymbolSamples,
  demodulateOfdmSymbolSamples,
  detectWhisperAckFromFFT,
  WHISPER_ACK_BAND,
} from './audio';

test('CRC-32 matches standard IEEE 802.3 vector', () => {
  const bytes = new TextEncoder().encode('123456789');
  assert.equal(crc32(bytes), 0xcbf43926);
});

test('Density profile geometry meets ~250 KB/s target in TURBO mode', () => {
  const turbo = getFrameGeometry('TURBO');
  assert.equal(turbo.profile.cols, 192);
  assert.equal(turbo.profile.rows, 108);
  assert.ok(turbo.netPayloadBytesPerFrame > 9500, `Expected >9500 bytes/frame, got ${turbo.netPayloadBytesPerFrame}`);
  const kbpsAt25 = estimateThroughputKBps('OPTICAL', 'TURBO', 25);
  assert.ok(kbpsAt25 >= 230 && kbpsAt25 <= 270, `Expected ~250 KB/s at 25 FPS, got ${kbpsAt25}`);

  const balanced = getFrameGeometry('BALANCED');
  assert.equal(balanced.profile.cols, 96);
  assert.equal(balanced.profile.rows, 54);

  const robust = getFrameGeometry('ROBUST');
  assert.equal(robust.profile.cols, 48);
  assert.equal(robust.profile.rows, 27);
});

test('Fountain-XOR recovers payload with 35% packet loss, out-of-order arrival, and CRC rejection', () => {
  const original = new Uint8Array(18_432);
  for (let i = 0; i < original.length; i++) {
    original[i] = (i * 73 + 19) & 0xff;
  }

  const encoder = new FountainEncoder(original, 512, FLAG_GZIP | FLAG_AES256, 0x10203040);
  const decoder = new FountainDecoder();

  // Feed droplets with simulated 35% random drops + 1 corrupted packet
  const packets: Uint8Array[] = [];
  for (let id = 0; id < encoder.totalBlocks * 4; id++) {
    packets.push(encoder.generatePacket(id));
  }

  // Corrupt one packet to verify CRC-32 rejects it
  const corrupted = new Uint8Array(packets[0]);
  corrupted[40] ^= 0xff;
  const corruptRes = decoder.ingestRawPacket(corrupted);
  assert.equal(corruptRes.accepted, false);
  assert.equal(corruptRes.reason, 'CRC_MISMATCH');

  // Deliver packets out-of-order while dropping ~35%
  for (let i = packets.length - 1; i >= 0; i--) {
    if (i % 3 === 0) continue; // drop 33%
    decoder.ingestRawPacket(packets[i]);
    if (decoder.isComplete()) break;
  }

  assert.equal(decoder.isComplete(), true);
  const snap = decoder.getSnapshot();
  assert.equal(snap.crcFailures, 1);
  assert.ok(snap.peeledCount > 0, 'Expected belief-propagation XOR peeling to recover dropped blocks');

  const recovered = decoder.reconstructBytes();
  assert.ok(recovered !== null);
  assert.deepEqual(recovered, original);
});

test('Optical encode -> RGBA -> decode roundtrip succeeds for TURBO, BALANCED, and ROBUST under ambient tint', () => {
  const profiles = Object.keys(DENSITY_PROFILES) as Array<keyof typeof DENSITY_PROFILES>;

  for (const profileId of profiles) {
    const geom = getFrameGeometry(profileId);
    const sampleData = new Uint8Array(geom.netPayloadBytesPerFrame * 2);
    for (let i = 0; i < sampleData.length; i++) sampleData[i] = (i * 29 + 7) & 0xff;

    const encoder = new FountainEncoder(sampleData, geom.netPayloadBytesPerFrame, 0, 0xabcdef01);
    const { packetBytes } = encoder.nextPacket();

    const matrix = encodeOpticalCells(packetBytes, profileId, 5);
    const { rgba, width, height } = renderOpticalMatrixToRGBA(matrix, 2);

    // Apply simulated warm ambient tint (+0.55) and mild sensor noise to verify Chroma-Palette Calibration
    const tinted = applySimulatedChannelEffects(rgba, width, height, {
      warmTint: 0.55,
      noiseLevel: 6,
    });

    const decoded = decodeOpticalFrameFromRGBA(tinted, width, height, profileId);
    assert.equal(decoded.ok, true, `Failed decode for profile ${profileId}`);
    assert.equal(decoded.seqTL, 5);
    assert.equal(decoded.seqBR, (~5) & 0x0f);

    const decoder = new FountainDecoder();
    const res = decoder.ingestRawPacket(decoded.packetBytes);
    assert.equal(res.accepted, true, `Fountain CRC failed after optical roundtrip on ${profileId}`);
  }
});

test('Rolling-Shutter Tear Guard rejects frames torn across consecutive TX sequence numbers', () => {
  const geom = getFrameGeometry('BALANCED');
  const encoder = new FountainEncoder(new Uint8Array(geom.netPayloadBytesPerFrame * 2), geom.netPayloadBytesPerFrame, 0, 12345);

  const m0 = encodeOpticalCells(encoder.generatePacket(0), 'BALANCED', 3);
  const m1 = encodeOpticalCells(encoder.generatePacket(1), 'BALANCED', 4);
  const r0 = renderOpticalMatrixToRGBA(m0, 2);
  const r1 = renderOpticalMatrixToRGBA(m1, 2);

  // Splice top half of frame seq=3 with bottom half of frame seq=4
  const torn = applySimulatedChannelEffects(r0.rgba, r0.width, r0.height, {
    nextFrameRgba: r1.rgba,
  });

  const decoded = decodeOpticalFrameFromRGBA(torn, r0.width, r0.height, 'BALANCED');
  assert.equal(decoded.ok, false);
  assert.equal(decoded.reason, 'TEAR_GUARD_MISMATCH');
  assert.equal(decoded.seqTL, 3);
  assert.equal(decoded.seqBR, (~4) & 0x0f);
});

test('Native AES-256-GCM + Gzip CompressionStream + File Envelope full roundtrip', async () => {
  const passphrase = generateSessionPassphrase();
  const text = 'SYNAPSE AIR-GAP TELEMETRY PAYLOAD :: '.repeat(200);
  const rawBytes = new TextEncoder().encode(text);

  const envelope = packFileEnvelope('mission-log.txt', 'text/plain', rawBytes);
  const compressed = await gzipCompress(envelope);
  assert.ok(compressed.length < envelope.length, 'Expected gzip to shrink repetitive text payload');

  const encrypted = await encryptAesGcm(compressed, passphrase);

  // Wrong passphrase must fail authentication tag check
  await assert.rejects(() => decryptAesGcm(encrypted, 'WRONG-KEY-123'));

  const decrypted = await decryptAesGcm(encrypted, passphrase);
  const decompressed = await gzipDecompress(decrypted);
  const unpacked = unpackFileEnvelope(decompressed);

  assert.equal(unpacked.fileName, 'mission-log.txt');
  assert.equal(unpacked.mimeType, 'text/plain');
  assert.deepEqual(unpacked.payload, rawBytes);
});

test('Mini-OFDM chord synthesis + Goertzel demodulation recovers 16-bit symbol accurately', () => {
  const testWords = [0x0000, 0xffff, 0xa55a, 0x3c81, 0x0f0f];
  const sampleRate = 48_000;

  for (const word of testWords) {
    const samples = synthesizeOfdmSymbolSamples(word, sampleRate, 0.08);
    const recovered = demodulateOfdmSymbolSamples(samples, sampleRate);
    assert.equal(recovered, word, `OFDM demod mismatch for 0x${word.toString(16)}: got 0x${recovered.toString(16)}`);
  }
});

test('Whisper-ACK ultrasonic FFT detector triggers strictly inside 14-18 kHz band', () => {
  const fftSize = 2048;
  const sampleRate = 48_000;
  const bins = new Uint8Array(fftSize / 2).fill(22);

  // Quiet spectrum -> not detected
  const quiet = detectWhisperAckFromFFT(bins, sampleRate, fftSize);
  assert.equal(quiet.detected, false);

  // Inject ultrasonic carrier at 16,200 Hz
  const targetBin = Math.round((16_200 * fftSize) / sampleRate);
  bins[targetBin] = 225;
  bins[targetBin - 1] = 180;
  bins[targetBin + 1] = 180;

  const active = detectWhisperAckFromFFT(bins, sampleRate, fftSize);
  assert.equal(active.detected, true);
  assert.ok(active.peakFreqHz >= WHISPER_ACK_BAND.minHz && active.peakFreqHz <= WHISPER_ACK_BAND.maxHz);
  assert.ok(active.snrDb >= 20);
});

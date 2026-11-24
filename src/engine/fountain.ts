// Browser Fountain-XOR Erasure Coding (Order-Independent Luby-Transform Peeling Decoder)
// + Binary Envelope Packing & IEEE 802.3 CRC-32 Packet Framing

import { crc32 } from './crc32';

export const PACKET_MAGIC = [0x53, 0x59, 0x4e, 0x31] as const; // "SYN1"
export const PACKET_HEADER_BYTES = 24;
export const PACKET_CRC_BYTES = 4;

export const FLAG_GZIP = 1 << 0;
export const FLAG_AES256 = 1 << 1;

export interface FileEnvelope {
  fileName: string;
  mimeType: string;
  payload: Uint8Array;
}

export function packFileEnvelope(fileName: string, mimeType: string, payload: Uint8Array): Uint8Array {
  const enc = new TextEncoder();
  const nameBytes = enc.encode(fileName.slice(0, 240));
  const mimeBytes = enc.encode((mimeType || 'application/octet-stream').slice(0, 120));

  const out = new Uint8Array(2 + nameBytes.length + 2 + mimeBytes.length + 4 + payload.length);
  const view = new DataView(out.buffer);
  let pos = 0;

  view.setUint16(pos, nameBytes.length, false);
  pos += 2;
  out.set(nameBytes, pos);
  pos += nameBytes.length;

  view.setUint16(pos, mimeBytes.length, false);
  pos += 2;
  out.set(mimeBytes, pos);
  pos += mimeBytes.length;

  view.setUint32(pos, payload.length, false);
  pos += 4;
  out.set(payload, pos);

  return out;
}

export function unpackFileEnvelope(bytes: Uint8Array): FileEnvelope {
  if (bytes.length < 8) {
    throw new Error('Envelope too small.');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const dec = new TextDecoder();
  let pos = 0;

  const nameLen = view.getUint16(pos, false);
  pos += 2;
  if (pos + nameLen + 6 > bytes.length) throw new Error('Invalid envelope filename length.');
  const fileName = dec.decode(bytes.subarray(pos, pos + nameLen));
  pos += nameLen;

  const mimeLen = view.getUint16(pos, false);
  pos += 2;
  if (pos + mimeLen + 4 > bytes.length) throw new Error('Invalid envelope MIME length.');
  const mimeType = dec.decode(bytes.subarray(pos, pos + mimeLen));
  pos += mimeLen;

  const payloadLen = view.getUint32(pos, false);
  pos += 4;
  if (pos + payloadLen > bytes.length) throw new Error('Truncated envelope payload.');
  const payload = bytes.slice(pos, pos + payloadLen);

  return { fileName, mimeType, payload };
}

// Deterministic Mulberry32 PRNG so TX and RX compute identical XOR index sets from (sessionId, dropletId)
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y !== 0) {
    const t = x % y;
    x = y;
    y = t;
  }
  return x;
}

export function deriveDropletIndices(
  sessionId: number,
  dropletId: number,
  totalBlocks: number,
): number[] {
  if (totalBlocks <= 1) return [0];

  // Pass 0 (0..K-1): Systematic degree-1 blocks for zero-overhead clean links
  if (dropletId < totalBlocks) {
    return [dropletId];
  }

  // Pass 1 (K..2K-1): Deterministic coprime degree-2 parity ring for instant XOR peeling
  if (dropletId < totalBlocks * 2) {
    const base = dropletId - totalBlocks;
    let stride = Math.max(1, Math.floor(totalBlocks / 3));
    while (stride < totalBlocks && gcd(stride, totalBlocks) !== 1) stride++;
    if (stride >= totalBlocks) stride = 1;
    const partner = (base + stride) % totalBlocks;
    return base < partner ? [base, partner] : [partner, base];
  }

  // Pass 2+: Robust Soliton-inspired XOR droplets with deterministic low-degree coverage
  const passIdx = dropletId - totalBlocks * 2;
  if (passIdx % 5 === 0) {
    // Periodic coprime degree-1 refresh prevents coupon-collector stalls under >40% loss
    let step = 7;
    while (gcd(step, totalBlocks) !== 1) step++;
    return [((passIdx / 5) * step) % totalBlocks];
  }

  const rng = mulberry32((sessionId ^ Math.imul(dropletId + 1, 0x9e3779b1)) >>> 0);
  const r = rng();
  let degree: number;
  if (r < 0.58) {
    degree = 2;
  } else if (r < 0.86) {
    degree = 3;
  } else {
    degree = 4;
  }
  degree = Math.min(degree, totalBlocks);

  const selected = new Set<number>();
  // Anchor first index deterministically across blocks to eliminate uncovered tail blocks
  selected.add((passIdx * 13 + (sessionId & 0xff)) % totalBlocks);
  while (selected.size < degree) {
    selected.add(Math.floor(rng() * totalBlocks));
  }
  return Array.from(selected).sort((a, b) => a - b);
}

export interface FountainPacket {
  sessionId: number;
  dropletId: number;
  totalBlocks: number;
  originalSize: number;
  blockSize: number;
  flags: number;
  body: Uint8Array;
}

export function serializeFountainPacket(packet: FountainPacket): Uint8Array {
  const totalLen = PACKET_HEADER_BYTES + packet.blockSize + PACKET_CRC_BYTES;
  const out = new Uint8Array(totalLen);
  const view = new DataView(out.buffer);

  out[0] = PACKET_MAGIC[0];
  out[1] = PACKET_MAGIC[1];
  out[2] = PACKET_MAGIC[2];
  out[3] = PACKET_MAGIC[3];

  view.setUint32(4, packet.sessionId >>> 0, false);
  view.setUint32(8, packet.dropletId >>> 0, false);
  view.setUint32(12, packet.totalBlocks >>> 0, false);
  view.setUint32(16, packet.originalSize >>> 0, false);
  view.setUint16(20, packet.blockSize & 0xffff, false);
  out[22] = packet.flags & 0xff;
  out[23] = 0; // reserved

  out.set(packet.body.subarray(0, packet.blockSize), PACKET_HEADER_BYTES);

  const checksum = crc32(out, 0, PACKET_HEADER_BYTES + packet.blockSize);
  view.setUint32(PACKET_HEADER_BYTES + packet.blockSize, checksum, false);
  return out;
}

export type ParsePacketResult =
  | { ok: true; packet: FountainPacket }
  | { ok: false; reason: 'TOO_SHORT' | 'BAD_MAGIC' | 'BAD_SIZE' | 'CRC_MISMATCH' };

export function parseFountainPacket(bytes: Uint8Array): ParsePacketResult {
  if (bytes.length < PACKET_HEADER_BYTES + PACKET_CRC_BYTES + 1) {
    return { ok: false, reason: 'TOO_SHORT' };
  }
  if (
    bytes[0] !== PACKET_MAGIC[0] ||
    bytes[1] !== PACKET_MAGIC[1] ||
    bytes[2] !== PACKET_MAGIC[2] ||
    bytes[3] !== PACKET_MAGIC[3]
  ) {
    return { ok: false, reason: 'BAD_MAGIC' };
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const sessionId = view.getUint32(4, false);
  const dropletId = view.getUint32(8, false);
  const totalBlocks = view.getUint32(12, false);
  const originalSize = view.getUint32(16, false);
  const blockSize = view.getUint16(20, false);
  const flags = bytes[22];

  const expectedLen = PACKET_HEADER_BYTES + blockSize + PACKET_CRC_BYTES;
  if (
    blockSize === 0 ||
    totalBlocks === 0 ||
    totalBlocks > 65536 ||
    expectedLen > bytes.length
  ) {
    return { ok: false, reason: 'BAD_SIZE' };
  }

  const expectedCrc = view.getUint32(PACKET_HEADER_BYTES + blockSize, false);
  const actualCrc = crc32(bytes, 0, PACKET_HEADER_BYTES + blockSize);
  if (expectedCrc !== actualCrc) {
    return { ok: false, reason: 'CRC_MISMATCH' };
  }

  const body = bytes.slice(PACKET_HEADER_BYTES, PACKET_HEADER_BYTES + blockSize);
  return {
    ok: true,
    packet: {
      sessionId,
      dropletId,
      totalBlocks,
      originalSize,
      blockSize,
      flags,
      body,
    },
  };
}

export class FountainEncoder {
  readonly sessionId: number;
  readonly blockSize: number;
  readonly originalSize: number;
  readonly totalBlocks: number;
  readonly flags: number;
  private readonly blocks: Uint8Array[];
  private cursor = 0;

  constructor(data: Uint8Array, blockSize: number, flags = 0, sessionId?: number) {
    this.sessionId = (sessionId ?? Math.floor(Math.random() * 0xffffffff)) >>> 0;
    this.blockSize = Math.max(16, blockSize);
    this.originalSize = data.length;
    this.flags = flags;
    this.totalBlocks = Math.max(1, Math.ceil(data.length / this.blockSize));
    this.blocks = [];

    for (let i = 0; i < this.totalBlocks; i++) {
      const block = new Uint8Array(this.blockSize);
      const start = i * this.blockSize;
      const slice = data.subarray(start, Math.min(data.length, start + this.blockSize));
      block.set(slice, 0);
      this.blocks.push(block);
    }
  }

  generatePacket(dropletId: number): Uint8Array {
    const indices = deriveDropletIndices(this.sessionId, dropletId, this.totalBlocks);
    const body = new Uint8Array(this.blockSize);

    for (let k = 0; k < indices.length; k++) {
      const src = this.blocks[indices[k]];
      for (let b = 0; b < this.blockSize; b++) {
        body[b] ^= src[b];
      }
    }

    return serializeFountainPacket({
      sessionId: this.sessionId,
      dropletId,
      totalBlocks: this.totalBlocks,
      originalSize: this.originalSize,
      blockSize: this.blockSize,
      flags: this.flags,
      body,
    });
  }

  nextPacket(): { dropletId: number; packetBytes: Uint8Array } {
    const dropletId = this.cursor++;
    return { dropletId, packetBytes: this.generatePacket(dropletId) };
  }

  resetCursor(): void {
    this.cursor = 0;
  }
}

export type BlockState = 0 | 1 | 2; // 0 = missing, 1 = direct systematic, 2 = XOR-peeled

interface PendingDroplet {
  indices: Set<number>;
  body: Uint8Array;
}

export interface DecoderSnapshot {
  sessionId: number | null;
  totalBlocks: number;
  solvedCount: number;
  directCount: number;
  peeledCount: number;
  pendingCount: number;
  packetsAccepted: number;
  crcFailures: number;
  redundantPackets: number;
  flags: number;
  originalSize: number;
  progress: number;
  complete: boolean;
  blockStates: Uint8Array;
}

export class FountainDecoder {
  private sessionId: number | null = null;
  private totalBlocks = 0;
  private originalSize = 0;
  private blockSize = 0;
  private flags = 0;

  private solved: Array<Uint8Array | null> = [];
  private blockStates = new Uint8Array(0);
  private pending: PendingDroplet[] = [];

  private solvedCount = 0;
  private directCount = 0;
  private peeledCount = 0;
  private packetsAccepted = 0;
  private crcFailures = 0;
  private redundantPackets = 0;

  reset(): void {
    this.sessionId = null;
    this.totalBlocks = 0;
    this.originalSize = 0;
    this.blockSize = 0;
    this.flags = 0;
    this.solved = [];
    this.blockStates = new Uint8Array(0);
    this.pending = [];
    this.solvedCount = 0;
    this.directCount = 0;
    this.peeledCount = 0;
    this.packetsAccepted = 0;
    this.crcFailures = 0;
    this.redundantPackets = 0;
  }

  ingestRawPacket(bytes: Uint8Array): { accepted: boolean; newlySolved: number; reason?: string } {
    const parsed = parseFountainPacket(bytes);
    if (!parsed.ok) {
      if (parsed.reason === 'CRC_MISMATCH') {
        this.crcFailures++;
      }
      return { accepted: false, newlySolved: 0, reason: parsed.reason };
    }

    const pkt = parsed.packet;
    if (this.sessionId === null || this.sessionId !== pkt.sessionId) {
      const priorCrcFailures = this.sessionId === null ? this.crcFailures : 0;
      this.reset();
      this.crcFailures = priorCrcFailures;
      this.sessionId = pkt.sessionId;
      this.totalBlocks = pkt.totalBlocks;
      this.originalSize = pkt.originalSize;
      this.blockSize = pkt.blockSize;
      this.flags = pkt.flags;
      this.solved = new Array<Uint8Array | null>(pkt.totalBlocks).fill(null);
      this.blockStates = new Uint8Array(pkt.totalBlocks);
    }

    this.packetsAccepted++;
    if (this.isComplete()) {
      this.redundantPackets++;
      return { accepted: true, newlySolved: 0 };
    }

    const indices = deriveDropletIndices(pkt.sessionId, pkt.dropletId, pkt.totalBlocks);
    const body = new Uint8Array(pkt.body);
    const remaining = new Set<number>();

    for (const idx of indices) {
      const existing = this.solved[idx];
      if (existing) {
        for (let b = 0; b < this.blockSize; b++) {
          body[b] ^= existing[b];
        }
      } else {
        remaining.add(idx);
      }
    }

    if (remaining.size === 0) {
      this.redundantPackets++;
      return { accepted: true, newlySolved: 0 };
    }

    const before = this.solvedCount;

    if (remaining.size === 1) {
      const onlyIdx = remaining.values().next().value as number;
      const wasDirect = indices.length === 1;
      this.commitBlock(onlyIdx, body, wasDirect ? 1 : 2);
      this.cascadePeel();
    } else {
      // Bound pending buffer size for long noisy links
      if (this.pending.length < Math.max(512, this.totalBlocks * 2)) {
        this.pending.push({ indices: remaining, body });
      }
    }

    return { accepted: true, newlySolved: this.solvedCount - before };
  }

  private commitBlock(idx: number, data: Uint8Array, state: 1 | 2): void {
    if (this.solved[idx]) return;
    this.solved[idx] = data;
    this.blockStates[idx] = state;
    this.solvedCount++;
    if (state === 1) {
      this.directCount++;
    } else {
      this.peeledCount++;
    }
  }

  private cascadePeel(): void {
    let progressed = true;
    while (progressed && !this.isComplete()) {
      progressed = false;
      for (let i = this.pending.length - 1; i >= 0; i--) {
        const droplet = this.pending[i];
        for (const idx of Array.from(droplet.indices)) {
          const solvedBlock = this.solved[idx];
          if (solvedBlock) {
            for (let b = 0; b < this.blockSize; b++) {
              droplet.body[b] ^= solvedBlock[b];
            }
            droplet.indices.delete(idx);
          }
        }

        if (droplet.indices.size === 0) {
          this.pending.splice(i, 1);
        } else if (droplet.indices.size === 1) {
          const onlyIdx = droplet.indices.values().next().value as number;
          this.pending.splice(i, 1);
          this.commitBlock(onlyIdx, droplet.body, 2);
          progressed = true;
        }
      }
    }
  }

  isComplete(): boolean {
    return this.totalBlocks > 0 && this.solvedCount === this.totalBlocks;
  }

  reconstructBytes(): Uint8Array | null {
    if (!this.isComplete()) return null;
    const out = new Uint8Array(this.originalSize);
    let offset = 0;
    for (let i = 0; i < this.totalBlocks; i++) {
      const blk = this.solved[i]!;
      const len = Math.min(this.blockSize, this.originalSize - offset);
      out.set(blk.subarray(0, len), offset);
      offset += len;
    }
    return out;
  }

  getSnapshot(): DecoderSnapshot {
    return {
      sessionId: this.sessionId,
      totalBlocks: this.totalBlocks,
      solvedCount: this.solvedCount,
      directCount: this.directCount,
      peeledCount: this.peeledCount,
      pendingCount: this.pending.length,
      packetsAccepted: this.packetsAccepted,
      crcFailures: this.crcFailures,
      redundantPackets: this.redundantPackets,
      flags: this.flags,
      originalSize: this.originalSize,
      progress: this.totalBlocks > 0 ? this.solvedCount / this.totalBlocks : 0,
      complete: this.isComplete(),
      blockStates: new Uint8Array(this.blockStates),
    };
  }
}

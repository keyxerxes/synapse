// Optical Matrix Encoder & Calibrated Decoder:
// - Live Chroma-Palette Border Calibration Strip (ambient light adaptation)
// - Internal Alignment Anchor Grid + 4 Corner Finder Fiducials
// - Rolling-Shutter Tear Guard (inverted top-left / bottom-right 4-bit sequence parity)
// - Pre-rendered ImageBitmap Ring Buffer (25-30 FPS steady emission)
// - WebGL2 / Canvas Fast Downsampler

import { DensityProfileId, getFrameGeometry, RGB } from './profiles';

export interface EncodedOpticalMatrix {
  profileId: DensityProfileId;
  cols: number;
  rows: number;
  seq: number;
  cells: Uint8Array; // palette index per cell (cols * rows)
}

export function encodeOpticalCells(
  packetBytes: Uint8Array,
  profileId: DensityProfileId,
  seqIndex: number,
): EncodedOpticalMatrix {
  const geom = getFrameGeometry(profileId);
  const { cols, rows, bitsPerCell, colorCount, fiducialSize } = geom.profile;
  const cells = new Uint8Array(cols * rows);
  const blackIdx = 0;
  const whiteIdx = colorCount - 1;
  const accentIdx = colorCount >= 16 ? 7 : colorCount >= 8 ? 4 : 1; // Amber / Yellow / White
  const cyanIdx = colorCount >= 16 ? 5 : colorCount >= 8 ? 5 : 1;

  // 1. Draw 4 corner concentric finder fiducials (distinct colors for orientation verification)
  const drawFiducial = (ox: number, oy: number, ringColor: number) => {
    for (let dy = 0; dy < fiducialSize; dy++) {
      for (let dx = 0; dx < fiducialSize; dx++) {
        const edge = dx === 0 || dy === 0 || dx === fiducialSize - 1 || dy === fiducialSize - 1;
        const inner =
          fiducialSize >= 5 &&
          dx >= 2 &&
          dx <= fiducialSize - 3 &&
          dy >= 2 &&
          dy <= fiducialSize - 3;
        const centerSmall = fiducialSize < 5 && dx === 1 && dy === 1;
        const color = edge ? ringColor : inner || centerSmall ? whiteIdx : blackIdx;
        cells[(oy + dy) * cols + (ox + dx)] = color;
      }
    }
  };

  drawFiducial(0, 0, accentIdx); // Top-Left (Amber)
  drawFiducial(cols - fiducialSize, 0, cyanIdx); // Top-Right (Cyan)
  drawFiducial(0, rows - fiducialSize, cyanIdx); // Bottom-Left (Cyan)
  drawFiducial(cols - fiducialSize, rows - fiducialSize, accentIdx); // Bottom-Right (Amber)

  // 2. Draw Live Chroma-Palette Border Calibration Strip (top and bottom borders)
  for (let i = 0; i < geom.calibrationCells.length; i++) {
    const c = geom.calibrationCells[i];
    cells[c.y * cols + c.x] = c.colorIndex;
  }

  // 3. Draw Rolling-Shutter Tear Guard Parity Bits
  // Top-left = 4-bit frame sequence, Bottom-right = bitwise complement (~seq & 0xF)
  const seq4 = seqIndex & 0x0f;
  const inv4 = (~seq4) & 0x0f;
  for (let bit = 0; bit < 4; bit++) {
    const tl = geom.tearGuardTopLeft[bit];
    const br = geom.tearGuardBottomRight[bit];
    cells[tl.y * cols + tl.x] = ((seq4 >> bit) & 1) === 1 ? whiteIdx : blackIdx;
    cells[br.y * cols + br.x] = ((inv4 >> bit) & 1) === 1 ? whiteIdx : blackIdx;
  }

  // 4. Draw Internal Alignment Anchor Grid
  for (let i = 0; i < geom.internalAnchors.length; i++) {
    const a = geom.internalAnchors[i];
    cells[a.y * cols + a.x] = a.isHigh ? whiteIdx : blackIdx;
  }

  // 5. Pack payload bits MSB-first into all remaining data cells.
  // Unused trailing cells beyond packetBytes are filled with a deterministic whitening mask
  // so partial/small packets maintain balanced screen luminance for camera auto-exposure.
  const totalBits = packetBytes.length * 8;
  let bitPos = 0;
  for (let i = 0; i < geom.dataCells.length; i++) {
    let symbol = 0;
    if (bitPos < totalBits) {
      for (let b = 0; b < bitsPerCell; b++) {
        let bitVal = 0;
        if (bitPos < totalBits) {
          const byteIdx = bitPos >> 3;
          const bitInByte = 7 - (bitPos & 7);
          bitVal = (packetBytes[byteIdx] >> bitInByte) & 1;
        }
        symbol = (symbol << 1) | bitVal;
        bitPos++;
      }
    } else {
      symbol = ((Math.imul(i + 1, 2654435761) ^ Math.imul(seq4 + 3, 2246822519)) >>> 24) % colorCount;
      bitPos += bitsPerCell;
    }
    const coord = geom.dataCells[i];
    cells[coord.y * cols + coord.x] = symbol;
  }

  return { profileId, cols, rows, seq: seq4, cells };
}

export function renderOpticalMatrixToRGBA(
  matrix: EncodedOpticalMatrix,
  cellScale = 1,
): { rgba: Uint8ClampedArray; width: number; height: number } {
  const geom = getFrameGeometry(matrix.profileId);
  const palette = geom.profile.palette;
  const scale = Math.max(1, Math.floor(cellScale));
  const width = matrix.cols * scale;
  const height = matrix.rows * scale;
  const rgba = new Uint8ClampedArray(width * height * 4);

  if (scale === 1) {
    for (let i = 0; i < matrix.cells.length; i++) {
      const rgb = palette[matrix.cells[i]];
      const o = i * 4;
      rgba[o] = rgb[0];
      rgba[o + 1] = rgb[1];
      rgba[o + 2] = rgb[2];
      rgba[o + 3] = 255;
    }
    return { rgba, width, height };
  }

  for (let y = 0; y < matrix.rows; y++) {
    for (let x = 0; x < matrix.cols; x++) {
      const rgb = palette[matrix.cells[y * matrix.cols + x]];
      for (let sy = 0; sy < scale; sy++) {
        const rowStart = ((y * scale + sy) * width + x * scale) * 4;
        for (let sx = 0; sx < scale; sx++) {
          const o = rowStart + sx * 4;
          rgba[o] = rgb[0];
          rgba[o + 1] = rgb[1];
          rgba[o + 2] = rgb[2];
          rgba[o + 3] = 255;
        }
      }
    }
  }

  return { rgba, width, height };
}

export interface OpticalDecodeResult {
  ok: boolean;
  reason?: 'TEAR_GUARD_MISMATCH';
  seqTL: number;
  seqBR: number;
  calibratedPalette: Array<[number, number, number]>;
  packetBytes: Uint8Array;
  meanColorDistance: number;
}

export function decodeOpticalFrameFromRGBA(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  profileId: DensityProfileId,
): OpticalDecodeResult {
  const geom = getFrameGeometry(profileId);
  const { cols, rows, bitsPerCell, colorCount, palette } = geom.profile;

  const sampleCellRGB = (cx: number, cy: number): [number, number, number] => {
    const px = Math.min(width - 1, Math.max(0, Math.floor(((cx + 0.5) / cols) * width)));
    const py = Math.min(height - 1, Math.max(0, Math.floor(((cy + 0.5) / rows) * height)));
    const idx = (py * width + px) * 4;
    return [rgba[idx], rgba[idx + 1], rgba[idx + 2]];
  };

  // Step 1: Live Chroma-Palette Border Calibration
  // Average every observed swatch in the top & bottom calibration strips for each color index
  const sumR = new Float64Array(colorCount);
  const sumG = new Float64Array(colorCount);
  const sumB = new Float64Array(colorCount);
  const counts = new Uint32Array(colorCount);

  for (let i = 0; i < geom.calibrationCells.length; i++) {
    const c = geom.calibrationCells[i];
    const [r, g, b] = sampleCellRGB(c.x, c.y);
    sumR[c.colorIndex] += r;
    sumG[c.colorIndex] += g;
    sumB[c.colorIndex] += b;
    counts[c.colorIndex]++;
  }

  const calibratedPalette: Array<[number, number, number]> = [];
  for (let k = 0; k < colorCount; k++) {
    if (counts[k] > 0) {
      calibratedPalette.push([
        sumR[k] / counts[k],
        sumG[k] / counts[k],
        sumB[k] / counts[k],
      ]);
    } else {
      const fallback: RGB = palette[k];
      calibratedPalette.push([fallback[0], fallback[1], fallback[2]]);
    }
  }

  // Step 2: Rolling-Shutter Tear Guard Parity Verification
  const blackRef = calibratedPalette[0];
  const whiteRef = calibratedPalette[colorCount - 1];
  const luma = (rgb: [number, number, number]) => 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];
  const lumaThreshold = (luma(blackRef) + luma(whiteRef)) * 0.5;

  let seqTL = 0;
  let seqBR = 0;
  for (let bit = 0; bit < 4; bit++) {
    const tlRgb = sampleCellRGB(geom.tearGuardTopLeft[bit].x, geom.tearGuardTopLeft[bit].y);
    const brRgb = sampleCellRGB(geom.tearGuardBottomRight[bit].x, geom.tearGuardBottomRight[bit].y);
    if (luma(tlRgb) >= lumaThreshold) seqTL |= 1 << bit;
    if (luma(brRgb) >= lumaThreshold) seqBR |= 1 << bit;
  }

  if (((seqTL ^ seqBR) & 0x0f) !== 0x0f) {
    return {
      ok: false,
      reason: 'TEAR_GUARD_MISMATCH',
      seqTL,
      seqBR,
      calibratedPalette,
      packetBytes: new Uint8Array(0),
      meanColorDistance: 0,
    };
  }

  // Step 3: Nearest-Centroid Quantization & Bit Unpacking
  const outBytes = new Uint8Array(geom.rawBytesPerFrame);
  let bitPos = 0;
  const maxBits = outBytes.length * 8;
  let totalDist = 0;

  for (let i = 0; i < geom.dataCells.length; i++) {
    const cell = geom.dataCells[i];
    const [r, g, b] = sampleCellRGB(cell.x, cell.y);

    let bestIdx = 0;
    let bestDist = Infinity;
    for (let k = 0; k < colorCount; k++) {
      const ref = calibratedPalette[k];
      const dr = r - ref[0];
      const dg = g - ref[1];
      const db = b - ref[2];
      const dist = dr * dr + dg * dg + db * db;
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = k;
      }
    }
    totalDist += Math.sqrt(bestDist);

    for (let bIdx = bitsPerCell - 1; bIdx >= 0; bIdx--) {
      if (bitPos < maxBits) {
        if (((bestIdx >> bIdx) & 1) === 1) {
          outBytes[bitPos >> 3] |= 1 << (7 - (bitPos & 7));
        }
        bitPos++;
      }
    }
  }

  return {
    ok: true,
    seqTL,
    seqBR,
    calibratedPalette,
    packetBytes: outBytes,
    meanColorDistance: geom.dataCells.length > 0 ? totalDist / geom.dataCells.length : 0,
  };
}

// Simulate ambient lighting shift + Gaussian-like noise + optional rolling-shutter tear (used in tests & Loopback)
export function applySimulatedChannelEffects(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  opts: {
    warmTint?: number; // -1 (cool blue) to +1 (warm amber)
    noiseLevel?: number; // 0 to 40
    nextFrameRgba?: Uint8ClampedArray; // if provided, splices bottom half from next frame to simulate rolling-shutter tear
  },
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(rgba.length);
  const tint = opts.warmTint ?? 0;
  const noise = opts.noiseLevel ?? 0;
  const rGain = 1 + tint * 0.22;
  const gGain = 1 + tint * 0.04;
  const bGain = 1 - tint * 0.22;
  const tearRow = opts.nextFrameRgba ? Math.floor(height * 0.55) : height;

  let prng = 0x12345678;
  const nextRand = () => {
    prng = (Math.imul(prng, 1664525) + 1013904223) >>> 0;
    return (prng / 4294967296) * 2 - 1;
  };

  for (let y = 0; y < height; y++) {
    const src = y >= tearRow && opts.nextFrameRgba ? opts.nextFrameRgba : rgba;
    const rowOff = y * width * 4;
    for (let x = 0; x < width; x++) {
      const o = rowOff + x * 4;
      const n = noise > 0 ? nextRand() * noise : 0;
      out[o] = Math.max(0, Math.min(255, Math.round(src[o] * rGain + n)));
      out[o + 1] = Math.max(0, Math.min(255, Math.round(src[o + 1] * gGain + n)));
      out[o + 2] = Math.max(0, Math.min(255, Math.round(src[o + 2] * bGain + n)));
      out[o + 3] = 255;
    }
  }
  return out;
}

// Browser Pre-Rendered ImageBitmap Ring Buffer for jitter-free 25-30 FPS emission
export interface RingBufferFrame {
  dropletId: number;
  seq: number;
  bitmap: ImageBitmap | null;
  imageData: ImageData;
}

export class OpticalBitmapRingBuffer {
  private queue: RingBufferFrame[] = [];
  private readonly capacity: number;
  private closed = false;

  constructor(capacity = 20) {
    this.capacity = capacity;
  }

  get size(): number {
    return this.queue.length;
  }

  async push(
    dropletId: number,
    seq: number,
    rgba: Uint8ClampedArray,
    width: number,
    height: number,
  ): Promise<void> {
    if (this.closed) return;
    if (this.queue.length >= this.capacity) return;

    const copy = new Uint8ClampedArray(rgba);
    const imageData = new ImageData(copy, width, height);
    let bitmap: ImageBitmap | null = null;
    if (typeof createImageBitmap === 'function') {
      try {
        bitmap = await createImageBitmap(imageData);
      } catch {
        bitmap = null;
      }
    }
    if (this.closed) {
      bitmap?.close();
      return;
    }
    this.queue.push({ dropletId, seq, bitmap, imageData });
  }

  shift(): RingBufferFrame | undefined {
    return this.queue.shift();
  }

  clear(): void {
    for (const item of this.queue) {
      item.bitmap?.close();
    }
    this.queue = [];
  }

  dispose(): void {
    this.closed = true;
    this.clear();
  }
}

// Fast WebGL2 / 2D Canvas Downsampler for RX Camera/Video/Image sampling
export class OpticalFastSampler {
  private canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext | null = null;
  private ctx2d: CanvasRenderingContext2D | null = null;
  private glProgram: WebGLProgram | null = null;
  private glTex: WebGLTexture | null = null;
  private glBuf: WebGLBuffer | null = null;
  readonly backend: 'webgl2' | 'canvas2d';

  constructor(width: number, height: number) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = height;

    // Try WebGL2 hardware/shader downsampler first; gracefully fall back to 2D Canvas
    const gl = this.canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      preserveDrawingBuffer: true,
    });
    if (gl && this.initWebGL2(gl)) {
      this.gl = gl;
      this.backend = 'webgl2';
    } else {
      this.ctx2d = this.canvas.getContext('2d', { willReadFrequently: true });
      this.backend = 'canvas2d';
    }
  }

  private initWebGL2(gl: WebGL2RenderingContext): boolean {
    const vsSrc = `#version 300 es
      in vec2 aPos;
      out vec2 vUv;
      void main() {
        vUv = vec2((aPos.x + 1.0) * 0.5, 1.0 - (aPos.y + 1.0) * 0.5);
        gl_Position = vec4(aPos, 0.0, 1.0);
      }`;
    const fsSrc = `#version 300 es
      precision mediump float;
      uniform sampler2D uTex;
      in vec2 vUv;
      out vec4 fragColor;
      void main() {
        fragColor = texture(uTex, vUv);
      }`;

    const compile = (type: number, src: string) => {
      const sh = gl.createShader(type);
      if (!sh) return null;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        gl.deleteShader(sh);
        return null;
      }
      return sh;
    };

    const vs = compile(gl.VERTEX_SHADER, vsSrc);
    const fs = compile(gl.FRAGMENT_SHADER, fsSrc);
    if (!vs || !fs) return false;

    const prog = gl.createProgram();
    if (!prog) return false;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      gl.deleteProgram(prog);
      return false;
    }

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
      gl.STATIC_DRAW,
    );

    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    this.glProgram = prog;
    this.glBuf = buf;
    this.glTex = tex;
    return true;
  }

  resize(width: number, height: number): void {
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
  }

  sampleSource(source: HTMLVideoElement | HTMLCanvasElement | HTMLImageElement | ImageBitmap): Uint8ClampedArray | null {
    const w = this.canvas.width;
    const h = this.canvas.height;

    if (this.gl && this.glProgram && this.glTex && this.glBuf) {
      const gl = this.gl;
      gl.viewport(0, 0, w, h);
      gl.useProgram(this.glProgram);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.glBuf);
      const loc = gl.getAttribLocation(this.glProgram, 'aPos');
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.glTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      const flipped = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, flipped);

      // Flip Y to standard top-down ImageData layout
      const rgba = new Uint8ClampedArray(w * h * 4);
      const stride = w * 4;
      for (let y = 0; y < h; y++) {
        rgba.set(flipped.subarray((h - 1 - y) * stride, (h - y) * stride), y * stride);
      }
      return rgba;
    }

    if (this.ctx2d) {
      this.ctx2d.imageSmoothingEnabled = true;
      this.ctx2d.drawImage(source, 0, 0, w, h);
      return this.ctx2d.getImageData(0, 0, w, h).data;
    }

    return null;
  }

  dispose(): void {
    if (this.gl) {
      if (this.glTex) this.gl.deleteTexture(this.glTex);
      if (this.glBuf) this.gl.deleteBuffer(this.glBuf);
      if (this.glProgram) this.gl.deleteProgram(this.glProgram);
    }
  }
}

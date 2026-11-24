// Optical density profiles, palettes, and deterministic frame layout geometry

export type TransferMode = 'OPTICAL' | 'AUDIO' | 'HYBRID';
export type DensityProfileId = 'TURBO' | 'BALANCED' | 'ROBUST';

export type RGB = readonly [number, number, number];

export interface DensityProfile {
  id: DensityProfileId;
  label: string;
  cols: number;
  rows: number;
  bitsPerCell: 4 | 3 | 1;
  colorCount: 16 | 8 | 2;
  fiducialSize: number;
  anchorStepX: number;
  anchorStepY: number;
  palette: readonly RGB[];
  targetFpsDefault: number;
  badgeSpec: string;
}

// Perceptually maximized 16-color palette (index 0 = obsidian black, index 15 = pure white)
export const PALETTE_16: readonly RGB[] = [
  [10, 12, 16],     // 0: Obsidian Black
  [235, 38, 52],    // 1: Signal Red
  [24, 198, 72],    // 2: Phosphor Green
  [36, 114, 245],   // 3: Cobalt Blue
  [248, 224, 24],   // 4: Telemetry Yellow
  [22, 228, 236],   // 5: Laser Cyan
  [238, 42, 218],   // 6: Vivid Magenta
  [248, 134, 18],   // 7: Signal Amber
  [136, 36, 236],   // 8: Deep Violet
  [16, 134, 122],   // 9: Dark Teal
  [148, 244, 72],   // 10: Lime Phosphor
  [252, 138, 186],  // 11: Rose Pink
  [124, 192, 252],  // 12: Ice Sky
  [164, 92, 34],    // 13: Copper Ochre
  [128, 134, 148],  // 14: Neutral Mid-Slate
  [248, 250, 252],  // 15: Calibrated White
];

// 8-corner RGB cube palette (maximum possible RGB Euclidean separation for 3-bit)
export const PALETTE_8: readonly RGB[] = [
  [10, 12, 16],     // 0: Black
  [244, 34, 46],    // 1: Red
  [24, 220, 74],    // 2: Green
  [36, 108, 248],   // 3: Blue
  [250, 228, 24],   // 4: Yellow
  [18, 230, 240],   // 5: Cyan
  [240, 44, 224],   // 6: Magenta
  [248, 250, 252],  // 7: White
];

// 1-bit high-contrast B&W fallback palette
export const PALETTE_2: readonly RGB[] = [
  [10, 12, 16],     // 0: Black
  [248, 250, 252],  // 1: White
];

export const DENSITY_PROFILES: Record<DensityProfileId, DensityProfile> = {
  TURBO: {
    id: 'TURBO',
    label: 'TURBO',
    cols: 192,
    rows: 108,
    bitsPerCell: 4,
    colorCount: 16,
    fiducialSize: 6,
    anchorStepX: 32,
    anchorStepY: 27,
    palette: PALETTE_16,
    targetFpsDefault: 25,
    badgeSpec: '192×108 · 16-Color 4-bit · ~250 KB/s',
  },
  BALANCED: {
    id: 'BALANCED',
    label: 'BALANCED',
    cols: 96,
    rows: 54,
    bitsPerCell: 3,
    colorCount: 8,
    fiducialSize: 4,
    anchorStepX: 24,
    anchorStepY: 18,
    palette: PALETTE_8,
    targetFpsDefault: 25,
    badgeSpec: '96×54 · 8-Color 3-bit · ~45 KB/s',
  },
  ROBUST: {
    id: 'ROBUST',
    label: 'ROBUST',
    cols: 48,
    rows: 27,
    bitsPerCell: 1,
    colorCount: 2,
    fiducialSize: 3,
    anchorStepX: 24,
    anchorStepY: 13,
    palette: PALETTE_2,
    targetFpsDefault: 20,
    badgeSpec: '48×27 · B&W 1-bit · Fallback-Safe',
  },
};

export const PACKET_OVERHEAD_BYTES = 28; // 24-byte header + 4-byte CRC-32

export interface CellCoord {
  x: number;
  y: number;
}

export interface FrameGeometry {
  profile: DensityProfile;
  totalCells: number;
  calibrationCells: Array<{ x: number; y: number; colorIndex: number }>;
  tearGuardTopLeft: CellCoord[];
  tearGuardBottomRight: CellCoord[];
  internalAnchors: Array<{ x: number; y: number; isHigh: boolean }>;
  dataCells: CellCoord[];
  rawBytesPerFrame: number;
  netPayloadBytesPerFrame: number;
}

const geometryCache = new Map<DensityProfileId, FrameGeometry>();

export function getFrameGeometry(profileId: DensityProfileId): FrameGeometry {
  const cached = geometryCache.get(profileId);
  if (cached) return cached;

  const profile = DENSITY_PROFILES[profileId];
  const { cols, rows, fiducialSize, colorCount, anchorStepX, anchorStepY } = profile;
  const reserved = new Uint8Array(cols * rows);
  const mark = (x: number, y: number) => {
    if (x >= 0 && x < cols && y >= 0 && y < rows) {
      reserved[y * cols + x] = 1;
    }
  };

  // 1. Reserve 4 corner fiducial zones (+ 1-cell quiet zone margin around each fiducial)
  const qz = fiducialSize + 1;
  for (let y = 0; y < qz; y++) {
    for (let x = 0; x < qz; x++) {
      mark(x, y); // Top-left
      mark(cols - 1 - x, y); // Top-right
      mark(x, rows - 1 - y); // Bottom-left
      mark(cols - 1 - x, rows - 1 - y); // Bottom-right
    }
  }

  // 2. Reserve Rolling-Shutter Tear Guard parity bits (4 cells top-left + 4 cells bottom-right)
  const tearGuardTopLeft: CellCoord[] = [];
  const tearGuardBottomRight: CellCoord[] = [];
  for (let i = 0; i < 4; i++) {
    const tlX = qz + i;
    const tlY = 1;
    tearGuardTopLeft.push({ x: tlX, y: tlY });
    mark(tlX, tlY);

    const brX = cols - 1 - qz - i;
    const brY = rows - 2;
    tearGuardBottomRight.push({ x: brX, y: brY });
    mark(brX, brY);
  }

  // 3. Reserve Live Chroma-Palette Border Calibration Strip (top row y=0 and bottom row y=rows-1)
  const calibrationCells: Array<{ x: number; y: number; colorIndex: number }> = [];
  for (let x = qz; x < cols - qz; x++) {
    const colorIndex = (x - qz) % colorCount;
    calibrationCells.push({ x, y: 0, colorIndex });
    mark(x, 0);
    calibrationCells.push({ x, y: rows - 1, colorIndex });
    mark(x, rows - 1);
  }

  // 4. Reserve Internal Alignment Anchor Grid
  const internalAnchors: Array<{ x: number; y: number; isHigh: boolean }> = [];
  for (let ay = anchorStepY; ay < rows - qz; ay += anchorStepY) {
    for (let ax = anchorStepX; ax < cols - qz; ax += anchorStepX) {
      if (!reserved[ay * cols + ax]) {
        const isHigh = ((ax / anchorStepX + ay / anchorStepY) | 0) % 2 === 0;
        internalAnchors.push({ x: ax, y: ay, isHigh });
        mark(ax, ay);
      }
    }
  }

  // 5. All remaining cells are data payload cells
  const dataCells: CellCoord[] = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (!reserved[y * cols + x]) {
        dataCells.push({ x, y });
      }
    }
  }

  const rawBytesPerFrame = Math.floor((dataCells.length * profile.bitsPerCell) / 8);
  const netPayloadBytesPerFrame = Math.max(16, rawBytesPerFrame - PACKET_OVERHEAD_BYTES);

  const geom: FrameGeometry = {
    profile,
    totalCells: cols * rows,
    calibrationCells,
    tearGuardTopLeft,
    tearGuardBottomRight,
    internalAnchors,
    dataCells,
    rawBytesPerFrame,
    netPayloadBytesPerFrame,
  };

  geometryCache.set(profileId, geom);
  return geom;
}

export function estimateThroughputKBps(
  mode: TransferMode,
  profileId: DensityProfileId,
  fps: number,
): number {
  if (mode === 'AUDIO') {
    // Mini-OFDM 16-subcarrier acoustic link (~1.2 KB/s net with chirp sync)
    return 1.25;
  }
  const geom = getFrameGeometry(profileId);
  return Number(((geom.netPayloadBytesPerFrame * fps) / 1024).toFixed(1));
}

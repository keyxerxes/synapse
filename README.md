# SYNAPSE — Ultra-Fast Air-Gap Optical & Acoustic Transceiver

**SYNAPSE** is a 100% client-side, zero-API, offline-installable Progressive Web App (PWA) for high-speed Air-Gap file transfer up to **250 KB/s** using only native browser APIs.

Built for [github.com/keyxerxes](https://github.com/keyxerxes) · GitHub Pages & Offline Standalone Ready.

## Transfer Modes

| Mode | Channel Architecture | Use Case |
| :--- | :--- | :--- |
| **OPTICAL ONLY** | High-density visual color matrix with embedded session header & key | Silent, camera-to-screen air-gap transfers |
| **AUDIO ONLY** | Mini-OFDM multi-tone chords + LoRa-style linear FM Chirp sync via Web Audio API | Screenless / no-camera acoustic links |
| **HYBRID** | Optical matrix payload + simultaneous Sonic-Key audio broadcast + **Whisper-ACK** reverse ultrasonic feedback (14–18 kHz) | Maximum speed with automated ultrasonic delivery confirmation |

## Optical Density Profiles (Fallback-Safe)

| Profile | Matrix Geometry | Color Depth | Target Throughput (30 FPS) |
| :--- | :--- | :--- | :--- |
| **TURBO** | `192 × 108` cells | 16-color (4-bit/cell) | ~250 KB/s |
| **BALANCED** | `96 × 54` cells | 8-color (3-bit/cell) | ~46 KB/s |
| **ROBUST** | `48 × 27` cells | B&W (1-bit/cell) | ~4 KB/s (harsh lighting / low-res camera fallback) |

## Core Native Browser Engine (Zero External Runtime Dependencies)

- **Chroma-Palette Border Calibration Strip**: Every optical frame embeds all reference palette swatches along its top and bottom calibration edges so the receiver dynamically adapts color centroids to ambient lighting and camera white balance.
- **Internal Alignment Anchor Grid**: 4 corner concentric finder fiducials plus periodic internal alignment crosshairs for geometric registration.
- **Rolling-Shutter Tear Guard**: Inverted 4-bit frame sequence parity bits in top-left and bottom-right corners immediately reject torn camera captures before decoding.
- **Pre-Rendered `ImageBitmap` Ring Buffer**: Asynchronous frame pre-rasterization for steady 25–30 FPS emission without main-thread frame drops.
- **WebGL2 / Canvas Fast Sampler**: Hardware-accelerated palette quantization with automatic 2D Canvas fallback.
- **Fountain-XOR Erasure Coding**: Order-independent Luby-Transform belief-propagation peeling decoder with IEEE 802.3 CRC-32 per-droplet integrity verification.
- **Native Compression & Cryptography**: Browser `CompressionStream` (Gzip) + `Web Crypto API` (AES-256-GCM authenticated encryption).
- **1-Click Standalone Offline App (`.html`)**: Export a completely self-contained HTML file that runs offline from `file://` without a web server.

## Development & Deployment

```bash
npm install
npm run dev
```

### Run Unit Tests
```bash
npx tsx --test src/engine/*.test.ts
```

### Build for GitHub Pages
```bash
npm run build
```
Vite is preconfigured with `base: './'`, a full Workbox PWA Service Worker (`manifest.json`), and `.github/workflows/deploy.yml` for one-push deployment to GitHub Pages.

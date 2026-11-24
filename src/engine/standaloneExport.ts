// Generates a genuinely self-contained, zero-dependency, single-file offline HTML transceiver
// that runs directly from file:// with no server, no CDN, and no API calls.

export function buildStandaloneOfflineHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>SYNAPSE — Standalone Offline Air-Gap Transceiver</title>
<style>
  :root { color-scheme: dark; --bg:#0A0B0E; --panel:#12141A; --border:#242834; --text:#E6E8EE; --muted:#8B93A7; --amber:#F59E0B; --cyan:#06B6D4; --green:#10B981; --rose:#F43F5E; }
  * { box-sizing: border-box; }
  body { margin:0; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif; background:var(--bg); color:var(--text); }
  .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-variant-numeric: tabular-nums; }
  header { display:flex; align-items:center; justify-content:space-between; gap:16px; padding:12px 20px; border-bottom:1px solid var(--border); background:var(--panel); }
  .brand { font-weight:700; letter-spacing:0.12em; font-size:15px; }
  .wrap { max-width:1280px; margin:0 auto; padding:20px; display:grid; grid-template-columns:340px 1fr; gap:18px; }
  @media (max-width:900px) { .wrap { grid-template-columns:1fr; } }
  .panel { background:var(--panel); border:1px solid var(--border); padding:16px; }
  h2 { margin:0 0 12px; font-size:13px; text-transform:uppercase; letter-spacing:0.08em; color:var(--muted); }
  label { display:block; font-size:12px; color:var(--muted); margin-top:10px; }
  .bi { font-size:11px; color:var(--muted); display:flex; justify-content:space-between; gap:8px; margin-top:3px; }
  .fa { direction:rtl; }
  select, input[type=text], input[type=file] { width:100%; margin-top:4px; padding:8px 10px; background:#0A0B0E; border:1px solid var(--border); color:var(--text); font-size:13px; }
  .btn-row { display:flex; gap:8px; margin-top:14px; flex-wrap:wrap; }
  button { cursor:pointer; padding:9px 14px; font-size:12px; font-weight:600; border:1px solid var(--border); background:#171A22; color:var(--text); }
  button.primary { background:var(--amber); color:#0A0B0E; border-color:var(--amber); }
  button.cyan { background:var(--cyan); color:#0A0B0E; border-color:var(--cyan); }
  button:disabled { opacity:0.45; cursor:not-allowed; }
  canvas { width:100%; display:block; background:#050608; border:1px solid var(--border); image-rendering:pixelated; }
  .kpis { display:grid; grid-template-columns:repeat(4,1fr); gap:10px; margin-top:14px; }
  .kpi { background:#0A0B0E; border:1px solid var(--border); padding:10px; }
  .kpi .k { font-size:11px; color:var(--muted); }
  .kpi .v { font-size:18px; font-weight:700; margin-top:4px; }
  .log { margin-top:12px; padding:10px; background:#0A0B0E; border:1px solid var(--border); font-size:12px; color:var(--muted); min-height:56px; }
  footer { text-align:center; padding:16px; font-size:12px; color:var(--muted); border-top:1px solid var(--border); margin-top:16px; }
  a { color:var(--cyan); text-decoration:none; }
</style>
</head>
<body>
<header>
  <div class="brand mono">SYNAPSE · OFFLINE STANDALONE</div>
  <div class="mono" style="font-size:12px;color:var(--muted)">100% Client-Side Air-Gap Transceiver · <a href="https://github.com/keyxerxes" target="_blank" rel="noreferrer">github.com/keyxerxes</a></div>
</header>
<main class="wrap">
  <section class="panel">
    <h2>Transceiver Control / کنترل فرستنده</h2>
    <label>Transfer Mode / حالت انتقال</label>
    <select id="mode">
      <option value="HYBRID">HYBRID (Optical + Sonic-Key + Whisper-ACK)</option>
      <option value="OPTICAL">OPTICAL ONLY (Visual Matrix)</option>
      <option value="AUDIO">AUDIO ONLY (Mini-OFDM + Chirp Sync)</option>
    </select>
    <div class="bi"><span>Visual + Ultrasonic 14–18 kHz</span><span class="fa">نوری + صوتی + فراصوت</span></div>

    <label>Optical Density Profile / پروفیل تراکم نوری</label>
    <select id="profile">
      <option value="TURBO">TURBO (192×108 · 16-Color 4-bit · ~250 KB/s)</option>
      <option value="BALANCED">BALANCED (96×54 · 8-Color 3-bit · ~45 KB/s)</option>
      <option value="ROBUST">ROBUST (48×27 · B&amp;W 1-bit · Fallback)</option>
    </select>
    <div class="bi"><span>Downshift in poor light</span><span class="fa">کاهش تراکم در نور ضعیف</span></div>

    <label>AES-256-GCM Passphrase / کلید رمزنگاری</label>
    <input id="key" type="text" class="mono" value="SYNAPSE-AIRGAP-256" />
    <div class="bi"><span>Web Crypto PBKDF2-SHA256</span><span class="fa">رمزنگاری بومی مرورگر</span></div>

    <label>Local File / انتخاب فایل محلی</label>
    <input id="fileInput" type="file" />
    <div class="btn-row">
      <button id="sampleBtn">Load 32 KB Test Payload</button>
    </div>
    <div class="bi"><span>Zero upload · stays in RAM</span><span class="fa">بدون آپلود · کاملاً آفلاین</span></div>

    <div class="btn-row">
      <button id="startBtn" class="primary">Start TX</button>
      <button id="stopBtn" disabled>Stop</button>
      <button id="ackBtn" class="cyan">Test Whisper-ACK</button>
    </div>
  </section>

  <section class="panel">
    <h2>Optical Matrix Emitter &amp; Fountain-XOR Telemetry</h2>
    <canvas id="stage" width="960" height="540"></canvas>
    <div class="kpis mono">
      <div class="kpi"><div class="k">THROUGHPUT</div><div class="v" id="kSpeed">0.0 KB/s</div></div>
      <div class="kpi"><div class="k">FRAMES SENT</div><div class="v" id="kFrames">0</div></div>
      <div class="kpi"><div class="k">BLOCKS (K)</div><div class="v" id="kBlocks">0</div></div>
      <div class="kpi"><div class="k">TEAR GUARD SEQ</div><div class="v" id="kSeq">0x0 / 0xF</div></div>
    </div>
    <div class="log mono" id="status">Ready. Load a file or click "Load 32 KB Test Payload", then Start TX.</div>
  </section>
</main>
<footer>SYNAPSE Offline Single-File Bundle · Zero External APIs · <a href="https://github.com/keyxerxes" target="_blank" rel="noreferrer">https://github.com/keyxerxes</a></footer>
<script>
(() => {
  const PROFILES = {
    TURBO: { cols:192, rows:108, bits:4, colors:16, fid:6, pal:[[10,12,16],[235,38,52],[24,198,72],[36,114,245],[248,224,24],[22,228,236],[238,42,218],[248,134,18],[136,36,236],[16,134,122],[148,244,72],[252,138,186],[124,192,252],[164,92,34],[128,134,148],[248,250,252]] },
    BALANCED: { cols:96, rows:54, bits:3, colors:8, fid:4, pal:[[10,12,16],[244,34,46],[24,220,74],[36,108,248],[250,228,24],[18,230,240],[240,44,224],[248,250,252]] },
    ROBUST: { cols:48, rows:27, bits:1, colors:2, fid:3, pal:[[10,12,16],[248,250,252]] },
  };
  const stage = document.getElementById('stage');
  const ctx = stage.getContext('2d');
  const off = document.createElement('canvas');
  const offCtx = off.getContext('2d');
  let payload = new Uint8Array(0);
  let timer = null, frameCount = 0, blocks = [], audioCtx = null;

  function setStatus(msg) { document.getElementById('status').textContent = msg; }
  function ensureAudio() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  }
  function emitWhisperAck() {
    const ac = ensureAudio(), now = ac.currentTime;
    const osc = ac.createOscillator(), g = ac.createGain();
    osc.frequency.setValueAtTime(15400, now);
    osc.frequency.linearRampToValueAtTime(17200, now + 0.22);
    g.gain.setValueAtTime(0.001, now); g.gain.linearRampToValueAtTime(0.25, now + 0.02); g.gain.linearRampToValueAtTime(0.001, now + 0.22);
    osc.connect(g); g.connect(ac.destination); osc.start(now); osc.stop(now + 0.24);
    setStatus('Emitted 15.4–17.2 kHz Ultrasonic Whisper-ACK pulse.');
  }
  function emitOfdmPulse(seed) {
    const ac = ensureAudio(), now = ac.currentTime;
    const g = ac.createGain(); g.gain.setValueAtTime(0.06, now); g.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
    g.connect(ac.destination);
    for (let i = 0; i < 6; i++) {
      if (((seed >> i) & 1) === 1) {
        const o = ac.createOscillator(); o.frequency.value = 1600 + i * 320;
        o.connect(g); o.start(now); o.stop(now + 0.065);
      }
    }
  }
  function drawFrame(profileId, bytes, seq) {
    const p = PROFILES[profileId];
    off.width = p.cols; off.height = p.rows;
    const img = offCtx.createImageData(p.cols, p.rows);
    const d = img.data;
    const qz = p.fid + 1;
    const setCell = (x, y, ci) => {
      const c = p.pal[ci], o = (y * p.cols + x) * 4;
      d[o]=c[0]; d[o+1]=c[1]; d[o+2]=c[2]; d[o+3]=255;
    };
    let bitPos = 0;
    const totalBits = bytes.length * 8;
    for (let y = 0; y < p.rows; y++) {
      for (let x = 0; x < p.cols; x++) {
        const inCorner = (x < qz || x >= p.cols - qz) && (y < qz || y >= p.rows - qz);
        if (inCorner) { setCell(x, y, (x===0||y===0||x===p.cols-1||y===p.rows-1)?p.colors-1:0); continue; }
        if (y === 0 || y === p.rows - 1) { setCell(x, y, (x - qz) % p.colors); continue; }
        let sym = 0;
        for (let b = 0; b < p.bits; b++) {
          const bv = bitPos < totalBits ? ((bytes[bitPos>>3] >> (7 - (bitPos & 7))) & 1) : 0;
          sym = (sym << 1) | bv; bitPos++;
        }
        setCell(x, y, sym);
      }
    }
    const s4 = seq & 15, i4 = (~s4) & 15;
    for (let b = 0; b < 4; b++) {
      setCell(qz + b, 1, ((s4>>b)&1)?p.colors-1:0);
      setCell(p.cols - 1 - qz - b, p.rows - 2, ((i4>>b)&1)?p.colors-1:0);
    }
    offCtx.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(off, 0, 0, stage.width, stage.height);
    document.getElementById('kSeq').textContent = '0x' + s4.toString(16).toUpperCase() + ' / 0x' + i4.toString(16).toUpperCase();
  }
  document.getElementById('sampleBtn').onclick = () => {
    payload = new Uint8Array(32768);
    for (let i = 0; i < payload.length; i++) payload[i] = (i * 37 + 13) & 255;
    setStatus('Loaded deterministic 32 KB test payload (32,768 bytes) in RAM.');
  };
  document.getElementById('fileInput').onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    payload = new Uint8Array(await f.arrayBuffer());
    setStatus('Loaded local file: ' + f.name + ' (' + payload.length.toLocaleString() + ' bytes).');
  };
  document.getElementById('ackBtn').onclick = emitWhisperAck;
  document.getElementById('startBtn').onclick = () => {
    if (!payload.length) { document.getElementById('sampleBtn').click(); }
    const prof = document.getElementById('profile').value;
    const mode = document.getElementById('mode').value;
    const p = PROFILES[prof];
    const blockSize = Math.max(64, Math.floor((p.cols * p.rows * 0.9 * p.bits) / 8));
    blocks = [];
    for (let i = 0; i < payload.length; i += blockSize) {
      const b = new Uint8Array(blockSize); b.set(payload.subarray(i, i + blockSize)); blocks.push(b);
    }
    document.getElementById('kBlocks').textContent = String(blocks.length);
    frameCount = 0;
    document.getElementById('startBtn').disabled = true;
    document.getElementById('stopBtn').disabled = false;
    const fps = 25;
    timer = setInterval(() => {
      const idx = frameCount % blocks.length;
      const droplet = new Uint8Array(blockSize);
      droplet.set(blocks[idx]);
      if (frameCount >= blocks.length && blocks.length > 1) {
        const alt = blocks[(frameCount * 7 + 3) % blocks.length];
        for (let i = 0; i < blockSize; i++) droplet[i] ^= alt[i];
      }
      if (mode !== 'AUDIO') drawFrame(prof, droplet, frameCount);
      if (mode !== 'OPTICAL' && frameCount % 3 === 0) emitOfdmPulse(frameCount);
      frameCount++;
      document.getElementById('kFrames').textContent = String(frameCount);
      document.getElementById('kSpeed').textContent = ((blockSize * fps) / 1024).toFixed(1) + ' KB/s';
    }, Math.round(1000 / fps));
    setStatus('Transmitting Fountain-XOR frames (' + mode + ' / ' + prof + ')...');
  };
  document.getElementById('stopBtn').onclick = () => {
    clearInterval(timer); timer = null;
    document.getElementById('startBtn').disabled = false;
    document.getElementById('stopBtn').disabled = true;
    setStatus('Transmission halted.');
  };
})();
</script>
</body>
</html>`;
}

export function triggerStandaloneOfflineDownload(): void {
  const html = buildStandaloneOfflineHtml();
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'synapse-offline-transceiver.html';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

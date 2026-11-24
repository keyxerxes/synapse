// Concise bilingual (English + Persian/Farsi) micro-descriptions for every SYNAPSE mode, setting, and button

export interface BilingualCopy {
  en: string;
  fa: string;
}

export const BILINGUAL = {
  // Workspaces / Roles
  roleTx: {
    en: 'Emit optical matrix & acoustic bursts',
    fa: 'ارسال ماتریس نوری و پالس‌های صوتی',
  },
  roleRx: {
    en: 'Capture camera/mic stream & peel blocks',
    fa: 'دریافت با دوربین/میکروفون و بازسازی بسته‌ها',
  },
  roleLoopback: {
    en: 'Simulate channel noise, color tint & tear-guard',
    fa: 'شبیه‌سازی نویز، تغییر رنگ محیط و تست کامل حلقه',
  },

  // Transfer Modes
  modeOptical: {
    en: 'Visual matrix with embedded session header & key',
    fa: 'انتقال صرفاً نوری با کلید و هدر درون فریم',
  },
  modeAudio: {
    en: 'Mini-OFDM multi-tone chords + LoRa Chirp sync',
    fa: 'انتقال صرفاً صوتی با آکوردهای OFDM و همگام‌ساز چیرپ',
  },
  modeHybrid: {
    en: 'Optical payload + Sonic-Key + 14–18 kHz Whisper-ACK',
    fa: 'داده نوری + کلید صوتی همزمان + تایید فراصوت ۱۴ تا ۱۸ کیلوهرتز',
  },

  // Optical Density Profiles
  profileTurbo: {
    en: '192×108 · 16-color 4-bit · Up to ~250 KB/s (bright screen)',
    fa: '۱۹۲×۱۰۸ · ۱۶ رنگ ۴بیتی · تا ۲۵۰ کیلوبایت/ثانیه (نور مناسب)',
  },
  profileBalanced: {
    en: '96×54 · 8-color 3-bit · ~45 KB/s (standard camera)',
    fa: '۹۶×۵۴ · ۸ رنگ ۳بیتی · حدود ۴۵ کیلوبایت/ثانیه (دوربین معمولی)',
  },
  profileRobust: {
    en: '48×27 · B&W 1-bit · Fallback for poor light or glare',
    fa: '۴۸×۲۷ · سیاه‌وسفید ۱بیتی · مقاوم در نور ضعیف و بازتاب',
  },

  // Security & Engine Settings
  settingEncryption: {
    en: 'Web Crypto AES-256-GCM authenticated cipher',
    fa: 'رمزنگاری سخت‌افزاری AES-256-GCM در مرورگر',
  },
  settingPassphrase: {
    en: 'Shared key for PBKDF2-SHA256 derivation',
    fa: 'کلید مشترک برای تولید رمز ۲۵۶ بیتی',
  },
  settingCompression: {
    en: 'Native Gzip CompressionStream before framing',
    fa: 'فشرده‌سازی بومی Gzip پیش از بسته‌بندی فریم‌ها',
  },
  settingFps: {
    en: 'ImageBitmap ring-buffer cadence (15–30 FPS)',
    fa: 'نرخ پخش بافر حلقوی ImageBitmap (۱۵ تا ۳۰ فریم)',
  },
  settingWhisperAck: {
    en: 'Listen/emit 14–18 kHz ultrasonic completion ACK',
    fa: 'ارسال و شنود سیگنال تایید فراصوت ۱۴ تا ۱۸ کیلوهرتز',
  },

  // Action Buttons
  btnGenerateKey: {
    en: 'Random 256-bit passphrase',
    fa: 'تولید کلید تصادفی امن',
  },
  btnSelectFile: {
    en: 'Drop or browse local file (never uploaded)',
    fa: 'انتخاب فایل محلی (کاملاً آفلاین و بدون سرور)',
  },
  btnLoadSample: {
    en: 'Generate deterministic 48 KB test payload',
    fa: 'ساخت فایل آزمایشی ۴۸ کیلوبایتی برای تست سریع',
  },
  btnStartTx: {
    en: 'Start Fountain-XOR emission loop',
    fa: 'شروع پخش پیوسته فریم‌های Fountain-XOR',
  },
  btnStopTx: {
    en: 'Halt optical & acoustic carrier',
    fa: 'توقف فوری ارسال نوری و صوتی',
  },
  btnFullscreen: {
    en: 'Expand optical emitter for camera lock',
    fa: 'بزرگ‌نمایی ماتریس برای قفل بهتر دوربین',
  },
  btnStartRxCamera: {
    en: 'Open rear/front camera optical sampler',
    fa: 'فعال‌سازی دوربین برای نمونه‌برداری نوری',
  },
  btnStartRxMic: {
    en: 'Open Web Audio FFT & Mini-OFDM demodulator',
    fa: 'فعال‌سازی میکروفون برای دریافت OFDM و فراصوت',
  },
  btnStopRx: {
    en: 'Release camera & microphone streams',
    fa: 'توقف و آزادسازی دوربین و میکروفون',
  },
  btnEmitAck: {
    en: 'Fire 15.4–17.2 kHz Whisper-ACK chirp',
    fa: 'ارسال دستی پالس تایید فراصوت به فرستنده',
  },
  btnImportFrame: {
    en: 'Decode captured PNG/JPG frame directly',
    fa: 'رمزگشایی مستقیم تصویر فریم ذخیره‌شده',
  },
  btnDownloadRecovered: {
    en: 'Save CRC-32 verified decrypted file',
    fa: 'ذخیره فایل بازیابی و تایید شده با CRC-32',
  },
  btnRunLoopback: {
    en: 'Run live encode → channel → peel decode test',
    fa: 'اجرای تست زنده کدگذاری، نویز کانال و بازیابی کامل',
  },
  btnDownloadOffline: {
    en: 'Bundle self-contained offline .html transceiver',
    fa: 'دانلود نسخه تک‌فایل کاملاً آفلاین (.html)',
  },
  btnInstallPwa: {
    en: 'Install SYNAPSE offline to device home screen',
    fa: 'نصب اپلیکیشن آفلاین PWA روی دستگاه',
  },
  settingSimTint: {
    en: 'Simulate warm/cool ambient light shift',
    fa: 'شبیه‌سازی تغییر دمای رنگ نور محیط برای تست کالیبراسیون',
  },
  settingSimDrop: {
    en: 'Random packet loss % (Fountain-XOR recovery)',
    fa: 'درصد افت تصادفی بسته‌ها (تست بازیابی Fountain-XOR)',
  },
  settingSimTear: {
    en: 'Inject rolling-shutter torn frames (Tear Guard test)',
    fa: 'تزریق فریم‌های پاره‌شده برای تست محافظ Rolling-Shutter',
  },
} as const satisfies Record<string, BilingualCopy>;

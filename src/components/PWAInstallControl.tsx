import React, { useState } from 'react';
import { Download, Smartphone, Check, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

export const PWAInstallControl: React.FC = () => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showGuide, setShowGuide] = useState(false);

  if (isInstalled) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-mono-tech text-emerald-400 whitespace-nowrap shrink-0">
        <Check className="w-3.5 h-3.5" aria-hidden="true" />
        PWA Installed
      </span>
    );
  }

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={install}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-[#171A22] border border-cyan-500/50 text-cyan-300 hover:bg-cyan-500/10 transition-colors whitespace-nowrap shrink-0"
      >
        <Download className="w-3.5 h-3.5" aria-hidden="true" />
        Install PWA
      </button>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setShowGuide(true)}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-[#171A22] border border-[#2E3444] text-[#D0D6E4] hover:border-cyan-500/60 hover:text-cyan-300 transition-colors whitespace-nowrap shrink-0"
      >
        <Smartphone className="w-3.5 h-3.5" aria-hidden="true" />
        {isIOS ? 'Install on iOS' : 'Install PWA'}
      </button>

      {showGuide && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="pwa-install-title"
        >
          <div className="w-full max-w-md bg-[#12141A] border border-[#2E3444] p-6">
            <div className="flex items-center justify-between gap-4 border-b border-[#242834] pb-3">
              <h3 id="pwa-install-title" className="text-sm font-semibold text-[#E6E8EE]">
                Install SYNAPSE Offline PWA
              </h3>
              <button
                type="button"
                onClick={() => setShowGuide(false)}
                aria-label="Close install instructions"
                className="p-1 text-[#8E97AB] hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="mt-4 space-y-3 text-xs text-[#C2C9D9] leading-relaxed">
              {isIOS ? (
                <p>
                  1. Tap the <strong className="text-white">Share</strong> button in Safari.<br />
                  2. Scroll down and tap <strong className="text-white">Add to Home Screen</strong>.
                </p>
              ) : (
                <p>
                  Open your browser address bar or menu and select <strong className="text-white">Install SYNAPSE</strong> (or{' '}
                  <strong className="text-white">Add to Home Screen</strong>). Once installed, SYNAPSE launches standalone with full Service Worker offline caching.
                </p>
              )}
              <p dir="rtl" lang="fa" className="font-fa text-[#A8B2C7] pt-2 border-t border-[#242834]">
                برای نصب آفلاین PWA، از منوی مرورگر گزینه Install App یا Add to Home Screen را انتخاب کنید تا برنامه بدون اینترنت اجرا شود.
              </p>
            </div>
            <div className="mt-5 flex justify-end">
              <button
                type="button"
                onClick={() => setShowGuide(false)}
                className="px-4 py-2 text-xs font-medium bg-[#1E222D] border border-[#323849] text-white hover:bg-[#282E3D]"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

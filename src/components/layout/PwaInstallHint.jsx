import React, { useState, useEffect } from "react";
import { Smartphone, X, Share } from "lucide-react";

// 轻量级 PWA 安装提示：仅在移动端非 standalone 模式下显示，
// 引导用户「添加到主屏幕」。关闭后 7 天内不再弹出。
export default function PwaInstallHint() {
  const [visible, setVisible] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState(null);

  useEffect(() => {
    const standalone = window.matchMedia?.("(display-mode: standalone)").matches
      || window.navigator.standalone === true;
    if (standalone) return;

    // 7 天内关闭过则不再弹
    try {
      const dismissed = localStorage.getItem("pwa_hint_dismissed");
      if (dismissed && Date.now() - parseInt(dismissed, 10) < 7 * 86400000) return;
    } catch { /* noop */ }

    const ua = navigator.userAgent || "";
    const ios = /iPhone|iPad|iPod/i.test(ua) && !/CriOS|FxiOS/i.test(ua);
    const android = /Android/i.test(ua);
    if (!ios && !android) return;

    setIsIOS(ios);

    // Chrome Android: 拦截 beforeinstallprompt，提供一键安装
    const onPrompt = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setVisible(true);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);

    // iOS 无 beforeinstallprompt，延迟显示引导
    if (ios) {
      const t = setTimeout(() => setVisible(true), 2000);
      return () => { clearTimeout(t); window.removeEventListener("beforeinstallprompt", onPrompt); };
    }

    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  const dismiss = () => {
    setVisible(false);
    try { localStorage.setItem("pwa_hint_dismissed", String(Date.now())); } catch { /* noop */ }
  };

  const install = async () => {
    if (deferredPrompt) {
      try {
        await deferredPrompt.prompt();
        await deferredPrompt.userChoice;
      } catch { /* noop */ }
      setDeferredPrompt(null);
    }
    dismiss();
  };

  if (!visible) return null;

  return (
    <div className="fixed bottom-3 left-1/2 z-[60] w-[calc(100vw-1.5rem)] max-w-sm -translate-x-1/2 rounded-2xl border border-copper/30 bg-card/95 px-4 py-3 shadow-xl backdrop-blur-lg">
      <div className="flex items-start gap-2.5">
        <Smartphone size={18} className="mt-0.5 shrink-0 text-copper" />
        <div className="flex-1">
          <p className="text-sm font-medium text-foreground">添加到主屏幕</p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            {isIOS ? (
              <>点击底部 <Share size={11} className="inline align-middle" />「分享」→「添加到主屏幕」，像 App 一样全屏使用。</>
            ) : (
              "安装后像 App 一样全屏使用，无需打开浏览器。"
            )}
          </p>
          <div className="mt-2 flex gap-2">
            {!isIOS && deferredPrompt && (
              <button
                type="button"
                onClick={install}
                className="rounded-full bg-copper px-3 py-1 text-xs font-medium text-copper-foreground"
              >
                立即安装
              </button>
            )}
            <button
              type="button"
              onClick={dismiss}
              className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground hover:text-foreground"
            >
              以后再说
            </button>
          </div>
        </div>
        <button type="button" onClick={dismiss} className="shrink-0 text-muted-foreground/50 hover:text-foreground">
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
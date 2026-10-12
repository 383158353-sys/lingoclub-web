import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '@/App.jsx'
import AppErrorBoundary from '@/components/AppErrorBoundary.jsx'
import '@/index.css'
import { startMobilePerformanceDiagnostics } from '@/lib/mobilePerformanceDiagnostics.js'
import { installAudioUnlock } from '@/lib/audioUnlock.js'
import { cleanupObsoleteStorage, enforceTranscriptCacheLimit } from '@/lib/storageQuota.js'

cleanupObsoleteStorage()
enforceTranscriptCacheLimit()

startMobilePerformanceDiagnostics()
installAudioUnlock()

ReactDOM.createRoot(document.getElementById('root')).render(
  <AppErrorBoundary><App /></AppErrorBoundary>
)

// iOS Safari 忽略 user-scalable=no：阻止双指缩放手势（不影响原生视频全屏）
if (typeof document !== 'undefined') {
  ['gesturestart', 'gesturechange', 'gestureend'].forEach((t) =>
    document.addEventListener(t, (e) => e.preventDefault(), { passive: false })
  );
}

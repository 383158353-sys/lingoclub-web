import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '@/App.jsx'
import AppErrorBoundary from '@/components/AppErrorBoundary.jsx'
import '@/index.css'
import { startMobilePerformanceDiagnostics } from '@/lib/mobilePerformanceDiagnostics.js'
import { installAudioUnlock } from '@/lib/audioUnlock.js'

startMobilePerformanceDiagnostics()
installAudioUnlock()

ReactDOM.createRoot(document.getElementById('root')).render(
  <AppErrorBoundary><App /></AppErrorBoundary>
)

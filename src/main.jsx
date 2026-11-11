import { installSecureFetch } from './api/secureTransport'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/index.css'
import App from './App.jsx'
import { initNative, hideSplash } from './native.js' // [ANDROID]
import { reloadOnceForChunkError } from './lib/chunkReload.js'
import { installPasswordClipboardGuard } from './lib/blockPasswordClipboard.js'
import { initMotionPolicy } from './lib/motionPolicy.js'

// Vite fires this when a lazy chunk (or its CSS) fails to load, usually right after a new deploy.
window.addEventListener('vite:preloadError', (e) => {
  if (reloadOnceForChunkError()) e.preventDefault()
})

initNative() // [ANDROID] no-op in the browser
installSecureFetch() // encrypted-channel wrapper goes on top of the (APK-patched) fetch; already installed in the browser
installPasswordClipboardGuard() // no copy/paste/cut/drop in password fields
initMotionPolicy() // Admin -> Platform Policy -> "Platform animations" (on/off for everyone)

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// [ANDROID] First paint done -> remove the native splash screen (no-op in the browser).
requestAnimationFrame(() => requestAnimationFrame(hideSplash))

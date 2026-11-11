/**
 * Fallback UI shown by <Suspense> in App.jsx while a route's lazy-loaded
 * chunk is being fetched (see the `lazy(() => import('./pages/...'))`
 * calls at the top of App.jsx). Kept intentionally tiny/dependency-free
 * since it has to render before almost anything else has loaded — no
 * Icon/i18n imports, just the two CSS custom properties every theme
 * already defines (see src/styles/css/variables.css).
 */
import { useEffect } from 'react';
import { holdPaper } from '../lib/paperGate';

export default function PageLoading() {
  useEffect(() => holdPaper(), []); // keeps the paper reveal closed until the page chunk has loaded
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        width: '100%',
        background: 'var(--bg-canvas)',
      }}
    >
      <div
        aria-label={typeof document !== 'undefined' && document.documentElement.lang === 'ar' ? 'جارٍ التحميل' : 'Loading'}
        role="status"
        style={{
          width: 40,
          height: 40,
          borderRadius: '50%',
          border: '3px solid var(--uip-indigo-100, rgba(67, 83, 255,0.15))',
          borderTopColor: 'var(--color-primary)',
          animation: 'uip-page-loading-spin 0.7s linear infinite',
        }}
      />
      <style>{`
        @keyframes uip-page-loading-spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

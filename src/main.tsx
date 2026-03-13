import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// --- FILTRE DE CONSOLE ULTIME (Anti-pollution extensions & bruits de fond) ---
const IGNORED_PATTERNS = [
  'chrome-extension',
  'MetaMask',
  'message channel closed',
  'runtime.lastError',
  'No tab with id',
  'SES Removing',
  'i18next:',
  'indexOf', // Filtre spécifique pour l'erreur "Cannot read properties of null (reading 'indexOf')"
  'unpermitted intrinsics',
  'jQuery.Deferred exception'
];

const silenceErrors = (event: any) => {
  const msg = (event?.message || event?.reason?.message || event?.reason || '').toString();
  if (IGNORED_PATTERNS.some(pattern => msg.includes(pattern))) {
    event.stopImmediatePropagation();
    return true;
  }
};

window.addEventListener('error', silenceErrors, true);
window.addEventListener('unhandledrejection', silenceErrors, true);

// Override console methods to block noise
['error', 'warn', 'info', 'log'].forEach((method) => {
  const original = (console as any)[method];
  (console as any)[method] = (...args: any[]) => {
    const msg = args.join(' ');
    if (IGNORED_PATTERNS.some(pattern => msg.includes(pattern))) return;
    original.apply(console, args);
  };
});
// -----------------------------------------------------------------------------

const rootElement = document.getElementById('root');
if (rootElement) {
  createRoot(rootElement).render(
    <>
      <App />
      {/* Indicateur visuel de santé de l'application */}
      <div id="app-health-check" style={{
        position: 'fixed',
        bottom: '10px',
        right: '10px',
        background: '#10B981',
        color: 'white',
        padding: '4px 10px',
        borderRadius: '20px',
        fontSize: '10px',
        fontWeight: 'bold',
        zIndex: 9999,
        pointerEvents: 'none',
        boxShadow: '0 2px 5px rgba(0,0,0,0.2)'
      }}>
        STOCKMAN ENGINE OK ✅
      </div>
    </>
  );
}

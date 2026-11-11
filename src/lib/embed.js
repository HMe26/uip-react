/** True when this page runs inside the floating-chat drawer (an iframe named "uip-embed"): the app renders without sidebar / topbar. */
export const EMBED_NAME = 'uip-embed';
export const isEmbedded = (() => {
  try { return window.self !== window.top && window.name === EMBED_NAME; } catch { return true; }
})();

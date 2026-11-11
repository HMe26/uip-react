/** Chat message look: 'light' (default, tinted bubbles) or 'soft' (solid brand bubbles). Stored per device (and synced with the account). */
const KEY = 'uip_msg_style';
export function getChatStyle() {
  try { return localStorage.getItem(KEY) === 'soft' ? 'soft' : 'light'; } catch { return 'light'; }
}
export function applyChatStyle(style = getChatStyle()) {
  if (typeof document === 'undefined') return;
  if (style === 'soft') document.documentElement.setAttribute('data-msg-style', 'soft');
  else document.documentElement.removeAttribute('data-msg-style');
}
export function setChatStyle(style) {
  try { localStorage.setItem(KEY, style === 'soft' ? 'soft' : 'light'); } catch { /* storage blocked */ }
  applyChatStyle(style);
  // Tell the account-sync engine (and any open chat) right away.
  try { window.dispatchEvent(new CustomEvent('uip-chat-style', { detail: style })); } catch { /* ignore */ }
}

// Keep the page in step with the stored choice even when it changes elsewhere: another tab, or the account
// sync pulling the value saved on another device. (Previously it was only applied when the chat page mounted.)
if (typeof window !== 'undefined' && !window.__uipChatStyleBound) {
  window.__uipChatStyleBound = true;
  applyChatStyle();
  window.addEventListener('uip-account-settings', () => applyChatStyle());
  window.addEventListener('storage', (e) => { if (e.key === KEY || e.key === null) applyChatStyle(); });
}

/**
 * Remote-control receiver. A browser page cannot inject OS-level input, so "control my screen" works on the UIPE pages themselves:
 * the meeting tab relays the controller's mouse/keyboard (already authorised by the server) over a same-origin BroadcastChannel,
 * and every OTHER open UIPE tab applies it to its own page. Share a UIPE tab (My PC, a project, the code editor...) and the controller
 * can click, scroll and type in it. Anything outside the browser (other apps, the desktop) is out of reach on purpose.
 * While control is active every receiving tab shows a visible badge with the controller's name and a Stop button.
 */
const CHANNEL = 'uip-remote-control';
let installed = false;

export function installRemoteControlReceiver({ isMeetingRoute }) {
  if (installed || typeof BroadcastChannel === 'undefined') return;
  installed = true;
  const ch = new BroadcastChannel(CHANNEL);
  let active = false;
  let badge = null;
  let cursor = null;
  let lastEl = null;

  const px = (nx, ny) => ({ x: Math.round(nx * window.innerWidth), y: Math.round(ny * window.innerHeight) });

  function ensureUi(name) {
    if (!badge) {
      badge = document.createElement('div');
      badge.setAttribute('style', 'position:fixed;z-index:2147483647;inset-block-start:12px;inset-inline-start:50%;transform:translateX(-50%);display:flex;align-items:center;gap:10px;padding:8px 14px;border-radius:999px;background:#E5484D;color:#fff;font:600 13px system-ui,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.35)');
      const label = document.createElement('span');
      label.className = 'rc-label';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = '■ Stop';
      btn.setAttribute('style', 'border:0;border-radius:999px;padding:4px 10px;font:700 12px system-ui;cursor:pointer;background:#fff;color:#E5484D');
      btn.addEventListener('click', () => ch.postMessage({ type: 'stop-request' }));
      badge.append(label, btn);
      document.body.appendChild(badge);
    }
    badge.querySelector('.rc-label').textContent = `${name || 'Someone'} is controlling this page`;
    if (!cursor) {
      cursor = document.createElement('div');
      cursor.setAttribute('style', 'position:fixed;z-index:2147483646;pointer-events:none;width:18px;height:18px;border-radius:50%;background:rgba(229,72,77,.55);border:2px solid #E5484D;transform:translate(-50%,-50%);transition:left .04s linear,top .04s linear');
      document.body.appendChild(cursor);
    }
  }
  function teardown() {
    active = false;
    badge?.remove(); cursor?.remove(); badge = null; cursor = null; lastEl = null;
  }

  function target(x, y) {
    if (cursor) cursor.style.display = 'none';
    const el = document.elementFromPoint(x, y);
    if (cursor) cursor.style.display = '';
    return el && el !== badge && !badge?.contains(el) ? el : null;
  }
  function mouse(type, el, x, y, button = 0) {
    el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, button, buttons: type === 'mousedown' ? 1 : 0 }));
  }
  function scrollParent(el) {
    for (let n = el; n && n !== document.body; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (/(auto|scroll)/.test(cs.overflowY) && n.scrollHeight > n.clientHeight) return n;
    }
    return document.scrollingElement || document.documentElement;
  }
  function typeInto(el, ev) {
    const editable = el && (el.isContentEditable || /^(INPUT|TEXTAREA)$/.test(el.tagName));
    if (!editable) return false;
    if (ev.ctrl || ev.meta || ev.alt) return false;
    if (el.isContentEditable) {
      if (ev.key.length === 1) { document.execCommand('insertText', false, ev.key); return true; }
      if (ev.key === 'Enter') { document.execCommand('insertParagraph'); return true; }
      if (ev.key === 'Backspace') { document.execCommand('delete'); return true; }
      return false;
    }
    if (el.type && /^(checkbox|radio|button|submit|file|range|color)$/.test(el.type)) return false;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    let next = null;
    if (ev.key.length === 1) next = el.value.slice(0, start) + ev.key + el.value.slice(end);
    else if (ev.key === 'Backspace') next = start === end ? el.value.slice(0, Math.max(0, start - 1)) + el.value.slice(end) : el.value.slice(0, start) + el.value.slice(end);
    else if (ev.key === 'Enter' && el.tagName === 'TEXTAREA') next = el.value.slice(0, start) + '\n' + el.value.slice(end);
    if (next === null) return false;
    const caret = ev.key === 'Backspace' ? (start === end ? Math.max(0, start - 1) : start) : start + 1;
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, next);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    try { el.setSelectionRange(caret, caret); } catch { /* not all input types support selection */ }
    return true;
  }

  function apply(ev) {
    if (ev.type === 'keydown' || ev.type === 'keyup') {
      const el = document.activeElement && document.activeElement !== document.body ? document.activeElement : lastEl;
      if (!el) return;
      if (ev.type === 'keydown' && typeInto(el, ev)) return;
      el.dispatchEvent(new KeyboardEvent(ev.type, { key: ev.key, code: ev.code, ctrlKey: ev.ctrl, shiftKey: ev.shift, altKey: ev.alt, metaKey: ev.meta, bubbles: true, cancelable: true }));
      return;
    }
    const { x, y } = px(ev.x, ev.y);
    if (cursor) { cursor.style.left = `${x}px`; cursor.style.top = `${y}px`; }
    if (ev.type === 'move') { const el = target(x, y); if (el) mouse('mousemove', el, x, y); return; }
    const el = target(x, y);
    if (!el) return;
    if (ev.type === 'wheel') { scrollParent(el).scrollBy({ left: ev.dx, top: ev.dy }); return; }
    lastEl = el;
    if (ev.type === 'down') { mouse('mousedown', el, x, y, ev.button); if (el.focus) el.focus({ preventScroll: true }); }
    else if (ev.type === 'up') mouse('mouseup', el, x, y, ev.button);
    else if (ev.type === 'click') { mouse('mousedown', el, x, y); mouse('mouseup', el, x, y); if (el.focus) el.focus({ preventScroll: true }); el.click(); }
    else if (ev.type === 'dblclick') mouse('dblclick', el, x, y);
    else if (ev.type === 'contextmenu') mouse('contextmenu', el, x, y, 2);
  }

  ch.onmessage = (m) => {
    if (isMeetingRoute()) return; // the meeting tab itself is never remote-controlled
    const d = m.data || {};
    if (d.type === 'state') { if (d.active) { active = true; ensureUi(d.controllerName); } else teardown(); }
    else if (d.type === 'input' && active) (d.events || []).forEach(apply);
  };
  window.addEventListener('beforeunload', () => { if (active) ch.postMessage({ type: 'receiver-closed' }); });
}

export const REMOTE_CONTROL_CHANNEL = CHANNEL;

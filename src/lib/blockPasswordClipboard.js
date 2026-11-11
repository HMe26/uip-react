/**
 * Blocks copy / cut / paste / drag-and-drop (and the right-click menu) on password inputs AND one-time-code
 * inputs (reset / verification / 2FA / recovery codes), app-wide.
 *
 * One capture-phase listener on `document`, so every password field — including ones added later and
 * ones that switch to type="text" while "show password" is on — is covered without touching each page.
 *
 * A field counts as protected when it is type="password", or autocomplete contains "password" or
 * "one-time-code", or its id/name says password (these stay protected while the eye toggle makes them type="text").
 *
 * Opt-outs:
 *   - read-only inputs (e.g. a generated password shown so the admin can hand it over) can be copied;
 *   - add `data-allow-clipboard` to an input that must accept pasted secrets (API keys, SMTP password…).
 */
const PASSWORD_NAME = /password|passwd|(^|[_\-\s])pwd([_\-\s]|$)/i;

function isPasswordField(el) {
  if (!el || el.tagName !== 'INPUT') return false;
  if (el.hasAttribute('data-allow-clipboard')) return false;
  if (el.type === 'password') return true;
  if (el.type !== 'text') return false;
  return /password|one-time-code/i.test(el.autocomplete || '') || PASSWORD_NAME.test(`${el.id} ${el.name}`);
}

function block(e) {
  const el = e.target;
  if (!isPasswordField(el)) return;
  // Copying a read-only (revealed/generated) value is allowed; pasting into it is moot.
  if (el.readOnly && (e.type === 'copy' || e.type === 'contextmenu' || e.type === 'dragstart')) return;
  e.preventDefault();
  e.stopPropagation();
}

let installed = false;

export function installPasswordClipboardGuard() {
  if (installed || typeof document === 'undefined') return;
  installed = true;
  for (const type of ['copy', 'cut', 'paste', 'drop', 'dragstart', 'contextmenu']) {
    document.addEventListener(type, block, true);
  }
  // Mobile keyboards / IME paste buttons that don't raise a `paste` event.
  document.addEventListener('beforeinput', (e) => {
    if (isPasswordField(e.target) && /^(insertFromPaste|insertFromDrop|insertFromYank|deleteByCut)$/.test(e.inputType || '')) {
      e.preventDefault();
    }
  }, true);
}

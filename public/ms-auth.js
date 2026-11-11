/* Redirect target of the OneDrive pop-up (see src/lib/cloud/microsoft.js). External file because the CSP only allows script-src 'self'.
   Microsoft's login page sets a Cross-Origin-Opener-Policy, so window.opener is usually null here: the result travels over a
   same-origin BroadcastChannel first, and over postMessage when the opener is still reachable. */
(function () {
  var msg = { type: 'uip-ms-auth', search: window.location.search };
  try { var c = new BroadcastChannel('uip-ms-auth'); c.postMessage(msg); setTimeout(function () { c.close(); }, 500); } catch (e) { /* not supported */ }
  try { if (window.opener) window.opener.postMessage(msg, window.location.origin); } catch (e) { /* opener gone */ }
  setTimeout(function () { window.close(); }, 400);
})();

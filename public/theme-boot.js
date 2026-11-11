/* Applies the saved look (classic | light | dark) to <html> before first paint,
   so there is no flash. External file on purpose: the CSP only allows script-src 'self'.
   Keep in sync with src/context/ThemeContext.jsx. Default = classic. */
(function () {
  try {
    var mode = localStorage.getItem('uip_mode');
    if (mode !== 'light' && mode !== 'classic' && mode !== 'dark') {
      mode = localStorage.getItem('uip_theme') === 'dark' ? 'dark' : 'classic';
    }
    var root = document.documentElement;
    var lastLight = localStorage.getItem('uip_last_light') === 'light' ? 'light' : 'classic';
    var palette = mode === 'dark' ? (lastLight === 'light' ? 'white' : 'insight') : (mode === 'light' ? 'white' : 'insight');
    root.setAttribute('data-theme', mode === 'dark' ? 'dark' : 'light');
    root.setAttribute('data-palette', palette);
    root.setAttribute('data-mode', mode);
  } catch (e) { /* storage unavailable: CSS defaults to the classic look */ }
})();

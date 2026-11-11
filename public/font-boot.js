/* Makes the Google Fonts stylesheet NON render-blocking.
 * index.html ships it with media="print" (the browser downloads it at low priority and still paints the page with the
 * fallback font); this script switches it to media="all" as soon as it has loaded.
 * It is an external file because the CSP allows scripts from 'self' only (an inline onload="" handler would be blocked). */
(function () {
  function enable(link) { if (link.media !== 'all') link.media = 'all'; }
  var links = document.querySelectorAll('link[data-uip-font]');
  for (var i = 0; i < links.length; i++) {
    (function (link) {
      if (link.sheet) { enable(link); return; }
      link.addEventListener('load', function () { enable(link); });
      link.addEventListener('error', function () { enable(link); });
    })(links[i]);
  }
})();

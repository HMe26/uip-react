/**
 * xterm.js draws with the DOM renderer by default: every character is an element, and a busy terminal (npm install, a build log,
 * scrolling 5000 lines) makes the page crawl or freeze. The WebGL renderer paints the whole screen on the GPU instead.
 * Call it right after `term.open(...)`. Falls back silently (DOM renderer) if WebGL is missing or the GPU context is lost.
 */
export async function enableFastRenderer(term) {
  try {
    const { WebglAddon } = await import('@xterm/addon-webgl');
    const gl = new WebglAddon();
    gl.onContextLoss(() => { try { gl.dispose(); } catch { /* already gone */ } });
    term.loadAddon(gl);
    return true;
  } catch {
    return false;
  }
}

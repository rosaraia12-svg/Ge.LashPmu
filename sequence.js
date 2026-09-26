/* ------------------------------------------------------------------ *
 * sequence.js — two-act intro choreography.
 *
 *   1. #bg-video (the eye) autoplays and freezes on its open-eye frame
 *      (that freeze is handled in glass-card.js, which owns the video).
 *   2. When the eye ends, reveal #script-stage and play #script-video
 *      (hidden, used only as a frame source). Each frame is drawn into
 *      #script-canvas and re-keyed: pixel alpha is rewritten from
 *      luminance, so the source's black background becomes genuinely
 *      transparent and the white ink stays opaque. That is plain alpha
 *      compositing — every browser draws a canvas with real per-pixel
 *      alpha the same way, unlike CSS mix-blend-mode, which on Safari
 *      was painting the black background as a solid box instead of
 *      dropping it.
 *
 * Robustness notes:
 *   - Safari often ignores preload="auto" and may reject a scripted
 *     play() for the second clip, so we force load(), wait for data,
 *     and fall back to the still frame (#script-fallback, keyed the
 *     same way with ffmpeg) on failure or timeout.
 *   - A watchdog also starts the second act if the eye never fires
 *     `ended` (Safari can stall a frame short of the end).
 *
 * This whole file runs inside an IIFE: it is loaded as a classic
 * (non-module) script — so double-clicking index.html works — and
 * classic scripts on the same page share one global scope. Without the
 * wrapper, a name here (canvas, ctx, ...) can silently collide with one
 * in glass-card.js and throw a SyntaxError that stops this file from
 * running at all, with no visible error unless you open devtools.
 * ------------------------------------------------------------------ */
(function () {

const eye = document.getElementById('bg-video');
const stage = document.getElementById('script-stage');
const panel = document.getElementById('intro-panel');
const script = document.getElementById('script-video');
const scriptCanvas = document.getElementById('script-canvas');
const sctx = scriptCanvas.getContext('2d', { willReadFrequently: true });

// Alpha-key thresholds: below LO is fully transparent (the near-black
// grain of the source), above HI is fully opaque (the ink), linear ramp
// between. Keyed on the brightest channel rather than average luminance
// so a saturated colored ink (not just white) still reads as fully
// opaque — a mid-tone color can have a low average brightness even
// while one channel is strong.
const KEY_LO = 60;
const KEY_HI = 150;

// #script-stage is now sized snugly to the signature itself (see
// styles.css), not a large mostly-empty box, so it's cheap to match the
// screen's own pixel density instead of downscaling: capped at 2x so a
// phone doesn't ask for a needlessly huge canvas, and capped in absolute
// pixels as a backstop. Below this cap the canvas matches the CSS box
// 1:1, so nothing is ever stretched/blurred to fill it.
const MAX_CANVAS_HEIGHT = 520;

function pinToEnd(v) {
  const d = v.duration;
  if (d && isFinite(d)) {
    try { v.currentTime = Math.max(0, d - 0.05); } catch (e) { /* not seekable yet */ }
  }
  v.pause();
}

function showFallback() {
  stage.classList.add('use-fallback');
}

function resizeCanvasToBox() {
  const rect = scriptCanvas.getBoundingClientRect();
  if (rect.height <= 0) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const targetH = Math.min(rect.height * dpr, MAX_CANVAS_HEIGHT);
  const scale = targetH / rect.height;
  const w = Math.max(1, Math.round(rect.width * scale));
  const h = Math.max(1, Math.round(targetH));
  if (scriptCanvas.width !== w || scriptCanvas.height !== h) {
    scriptCanvas.width = w;
    scriptCanvas.height = h;
  }
}

let rafId = null;
function drawKeyedFrame() {
  if (!script.videoWidth || !script.videoHeight) return;

  resizeCanvasToBox();
  const cw = scriptCanvas.width, ch = scriptCanvas.height;

  // Reproduce object-fit: contain by hand — canvas has no such CSS knob.
  const scale = Math.min(cw / script.videoWidth, ch / script.videoHeight);
  const dw = script.videoWidth * scale;
  const dh = script.videoHeight * scale;
  const dx = (cw - dw) / 2;
  const dy = (ch - dh) / 2;

  sctx.clearRect(0, 0, cw, ch);
  try {
    sctx.drawImage(script, dx, dy, dw, dh);
    const frame = sctx.getImageData(0, 0, cw, ch);
    const d = frame.data;
    for (let i = 0; i < d.length; i += 4) {
      const lum = Math.max(d[i], d[i + 1], d[i + 2]);
      let a = ((lum - KEY_LO) / (KEY_HI - KEY_LO)) * 255;
      if (a < 0) a = 0; else if (a > 255) a = 255;
      d[i + 3] = a;
    }
    sctx.putImageData(frame, 0, 0);
  } catch (e) {
    // canvas read blocked for some reason — the still fallback covers us
    showFallback();
  }
}

let skipTick = false;
function frameLoop() {
  // Re-key at ~half the display's refresh rate — the source is a slow
  // cursive reveal, so this is not visibly less smooth, and it halves
  // the per-second cost of the pixel loop on top of the resolution cap.
  skipTick = !skipTick;
  if (!skipTick) {
    drawKeyedFrame();
  }
  if (!script.paused && !script.ended) {
    rafId = requestAnimationFrame(frameLoop);
  }
}

let started = false;
function runScript() {
  if (started) return;
  started = true;

  // Mobile only (gated in CSS): reveal the copy + listino panel now that
  // the hero animation has played through, instead of upfront.
  panel.classList.add('is-revealed');

  stage.classList.add('is-visible');

  let settled = false;
  const watchdog = setTimeout(() => { if (!settled) { settled = true; showFallback(); } }, 2500);
  const done = (ok) => {
    if (settled) return;
    settled = true;
    clearTimeout(watchdog);
    if (ok) {
      if (rafId) cancelAnimationFrame(rafId);
      frameLoop();
    } else {
      showFallback();
    }
  };

  const go = () => {
    let p;
    try { p = script.play(); } catch (e) { done(false); return; }
    if (p && typeof p.then === 'function') {
      p.then(() => done(true)).catch(() => done(false));
    } else {
      done(true);
    }
  };

  if (script.readyState >= 2) {
    go();
  } else {
    script.addEventListener('loadeddata', go, { once: true });
    script.addEventListener('error', () => done(false), { once: true });
    try { script.load(); } catch (e) { /* ignore */ }
  }
}

eye.addEventListener('ended', runScript);

// Watchdog: if the eye never reports `ended`, start the second act anyway
// a little after its natural length.
eye.addEventListener('loadedmetadata', () => {
  if (isFinite(eye.duration)) {
    setTimeout(() => { if (!started) runScript(); }, (eye.duration + 2) * 1000);
  }
});

let scriptDone = false;
script.addEventListener('ended', () => {
  if (scriptDone) return;
  scriptDone = true;
  pinToEnd(script);
  drawKeyedFrame(); // make sure the canvas holds the true final frame
});

})();

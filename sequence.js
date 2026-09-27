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

// ---- Adaptive vertical position (desktop only) ---------------------
//
// Earlier this was a hand-picked `top`/`bottom` pixel value in the CSS,
// tuned by measuring one test window and re-tuned every time it turned
// out wrong on a different one (invisible on a short window, overlapping
// the eye on another). That never generalises: the eye's on-screen
// position is a function of the window's own size and aspect ratio,
// because .bg-video is object-fit:cover (crops differently per aspect
// ratio) plus a CSS scale/pan transform.
//
// So instead: EYE_SRC_X/Y_FRACTION is a one-time fact about the source
// video (where the lash line sits within the raw 1280x720 frame — found
// by sampling the actual rendered frame, not guessed), and
// positionSignature() re-derives where that point lands on screen for
// *this* window by replicating the same cover + transform math the
// browser itself uses for .bg-video, then places the signature a fixed
// gap below it. Recomputed on resize, so it tracks any window shape.
const EYE_SRC_X_FRACTION = 0.5;
const EYE_SRC_Y_FRACTION = 0.72; // lash line measured at ~0.711 down the frame; a little margin added

function positionSignature() {
  // Mobile has its own fixed bottom lane (see styles.css) that doesn't
  // depend on the eye's position — leave it alone, just clear any
  // leftover inline override from a previous wider layout.
  if (window.innerWidth < 768) {
    stage.style.top = '';
    stage.style.bottom = '';
    stage.style.height = '';
    stage.style.width = '';
    return;
  }
  if (!eye.videoWidth || !eye.videoHeight) return;

  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;

  const cover = Math.max(vw / eye.videoWidth, vh / eye.videoHeight);
  const sw = vw / cover, sh = vh / cover;
  const sx = (eye.videoWidth - sw) / 2, sy = (eye.videoHeight - sh) / 2;

  const srcX = eye.videoWidth * EYE_SRC_X_FRACTION;
  const srcY = eye.videoHeight * EYE_SRC_Y_FRACTION;

  // position within the untransformed, cover-fitted video box
  let px = (srcX - sx) / sw * vw;
  let py = (srcY - sy) / sh * vh;

  // apply .bg-video's own CSS transform (the desktop zoom/pan), around
  // its own transform-origin, exactly as the browser would
  const matrixStr = getComputedStyle(eye).transform;
  if (matrixStr && matrixStr !== 'none') {
    const originStr = getComputedStyle(eye).transformOrigin;
    const parts = originStr.split(' ').map(parseFloat);
    const ox = parts[0], oy = parts[1];
    const m = new DOMMatrix(matrixStr);
    const mapped = m.transformPoint(new DOMPoint(px - ox, py - oy));
    px = ox + mapped.x;
    py = oy + mapped.y;
  }

  // Clearing the eye always wins: `top` is set from the eye's own
  // position and never pulled back up to keep the box on-screen. When a
  // short window leaves too little room below the eye for the box at
  // its usual size, the box shrinks (both dimensions, same aspect ratio)
  // to fit instead — so it's always fully visible *and* never
  // overlapping, at the cost of getting smaller on a short window rather
  // than staying a fixed size no matter what.
  const GAP = 24;
  const BOTTOM_MARGIN = 8;
  const MAX_HEIGHT = 170;
  const MIN_HEIGHT = 90;
  const ASPECT = 440 / 170;

  const top = Math.max(py + GAP, 8);
  const available = vh - top - BOTTOM_MARGIN;
  const height = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, available));
  const width = Math.round(height * ASPECT);

  stage.style.top = top + 'px';
  stage.style.bottom = 'auto';
  stage.style.height = height + 'px';
  stage.style.width = width + 'px';
}

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

// Keep the signature's position correct as the window changes shape —
// metadata load (first paint), and any resize (debounced to one rAF).
eye.addEventListener('loadedmetadata', positionSignature);
let resizeRaf = null;
window.addEventListener('resize', () => {
  if (resizeRaf) return;
  resizeRaf = requestAnimationFrame(() => {
    resizeRaf = null;
    positionSignature();
  });
});
positionSignature();

})();

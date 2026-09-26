/* ------------------------------------------------------------------ *
 * glass-card.js — the frame sync.
 *
 * The card is a window onto a refracted duplicate of the background
 * video. Each animation frame we redraw the current video frame into
 * a canvas that is positioned to line up 1:1 with the real video
 * behind the card; the card's overflow:hidden + border-radius do the
 * clipping, and the CSS `filter: url(#liquid-glass-refraction)` on
 * the canvas refracts it on composite.
 *
 * Self-starting rAF loop, no exports.
 *
 * Wrapped in an IIFE: this is loaded as a classic (non-module) script so
 * double-clicking index.html works, and classic scripts on the same page
 * share one global scope — without the wrapper a name here could collide
 * with one in another script and throw a silent SyntaxError.
 * ------------------------------------------------------------------ */
(function () {

const video = document.getElementById('bg-video');
const container = document.getElementById('dup-video-container');
const canvas = document.getElementById('dup-image');
const ctx = canvas.getContext('2d');
const card = document.querySelector('[data-glass-card]');

// Keep the duplicate at 1x even on retina: the SVG filter's cost scales
// with pixel count, and what shows through is a soft refraction where 4x
// the filter work buys nothing.
const DUP_PIXEL_RATIO = 1;

let lastW = 0;
let lastH = 0;

// The video plays once and holds on its last frame (the open eye). Some
// browsers repaint a poster / blank the element on `ended`, so pin the
// playhead just shy of the end and keep it paused. Guarded so the seek
// cannot re-fire `ended` in a loop.
let pinned = false;
video.addEventListener('ended', () => {
  if (pinned) return;
  pinned = true;
  try { video.currentTime = Math.max(0, video.duration - 0.05); } catch (e) { /* not seekable yet */ }
  video.pause();
});

function frame() {
  const rect = card.getBoundingClientRect();

  // Bail if the card has no size yet, or the video has not reported
  // dimensions — a frame is not drawable in either case.
  if (
    rect.width === 0 || rect.height === 0 ||
    !video.videoWidth || !video.videoHeight
  ) {
    requestAnimationFrame(frame);
    return;
  }

  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;

  // Align the duplicate to the VIEWPORT, not the card. The filter shifts
  // each colour channel by a different amount, so the filtered element's
  // own leading edges show hard channel-separation bands. Sized to the
  // viewport those bands fall outside the card and only clean refraction
  // shows. Because the container is absolutely positioned inside the card,
  // the negative offset lands it exactly over the viewport origin.
  container.style.left = -rect.left + 'px';
  container.style.top = -rect.top + 'px';
  container.style.width = vw + 'px';
  container.style.height = vh + 'px';

  const w = Math.round(vw * DUP_PIXEL_RATIO);
  const h = Math.round(vh * DUP_PIXEL_RATIO);

  // Only resize the canvas when it actually changed — resizing clears it.
  if (w !== lastW || h !== lastH) {
    canvas.width = w;
    canvas.height = h;
    lastW = w;
    lastH = h;
  }

  // Reproduce `object-fit: cover` when sampling the video into the canvas.
  const cover = Math.max(vw / video.videoWidth, vh / video.videoHeight);
  const sw = vw / cover;
  const sh = vh / cover;
  const sx = (video.videoWidth - sw) / 2;
  const sy = (video.videoHeight - sh) / 2;

  try {
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, w, h);
  } catch (e) {
    /* a frame may not be decodable yet — skip it */
  }

  // Once the video is frozen (paused, after the pin above) the duplicate
  // is already correct and nothing will change — stop rescheduling rather
  // than redrawing an unchanging frame forever. This was a real source of
  // ongoing jank: it kept running at full rate for the rest of the visit,
  // competing with the handwriting canvas's own per-frame work.
  if (video.paused) return;

  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);

})();

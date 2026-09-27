/* ------------------------------------------------------------------ *
 * sequence.js — two-act intro, played from pre-split WebP frames.
 *
 * Both "clips" are canvas-drawn frame sequences (frames-hero/,
 * frames-signature/), not a <video> element — the same method already
 * used in the other projects, for the same reason: a real <video>
 * turned out unreliable across real browsers in ways a plain
 * preload-images-then-draw-them loop is not —
 *   - autoplay sometimes silently failed to start with no error to
 *     react to, needing watchdog timers to paper over it;
 *   - the on-screen position of the video content (for cover-fit crop
 *     plus a CSS zoom transform) had to be reverse-engineered at
 *     runtime by parsing the browser's own computed transform matrix,
 *     which is one more thing that can disagree with what actually
 *     rendered;
 *   - removing the signature clip's black background needed a
 *     getImageData/putImageData pass over every pixel, every frame.
 * With frames: images either load or fire onerror (deterministic, no
 * autoplay policy involved), the desired "zoomed left" framing and the
 * signature's black-to-transparent keying are both baked in once at
 * export time (see the ffmpeg commands used to produce frames-hero/
 * and frames-signature/), and playback is just a rAF loop picking an
 * index to draw — no video decoder, no transform math to reverse.
 *
 * Sequence: hero plays once and holds its last frame -> signature
 * reveals, plays once, holds its last frame. On mobile the copy/listino
 * panel stays hidden until the hero finishes (see styles.css), so the
 * animation has the screen to itself first.
 * ------------------------------------------------------------------ */
(function () {
  "use strict";

  var heroCanvas = document.getElementById("hero-canvas");
  var hctx = heroCanvas.getContext("2d", { alpha: false });
  var sigCanvas = document.getElementById("signature-canvas");
  var sctx = sigCanvas.getContext("2d");
  var panel = document.getElementById("intro-panel");

  var HERO_FOLDER = "./frames-hero/";
  var HERO_FRAME_COUNT = 120;
  var HERO_W = 1090, HERO_H = 720;     // frames-hero/*.webp intrinsic size
  var HERO_DURATION_MS = 10000;        // matches the source clip's own pacing

  var SIG_FOLDER = "./frames-signature/";
  var SIG_FRAME_COUNT = 120;
  var SIG_W = 1000, SIG_H = 420;       // frames-signature/*.webp intrinsic size
  var SIG_DURATION_MS = 10000;

  // Where the eye's lash line sits within the (already cropped)
  // hero frame, as a fraction of its own width/height — measured once
  // by sampling the actual exported frame, not guessed. Used only to
  // place the signature safely below it; not needed for drawing the
  // hero itself.
  var EYE_X_FRACTION = 0.53;
  var EYE_Y_FRACTION = 0.72;

  function pad3(i) { return String(i).padStart(3, "0"); }

  function loadSequence(folder, count, onDone) {
    var images = new Array(count);
    var loaded = 0;
    for (var i = 0; i < count; i++) {
      (function (idx) {
        var im = new Image();
        im.decoding = "async";
        im.src = folder + pad3(idx + 1) + ".webp";
        images[idx] = im;
        var settled = false;
        function finish() {
          if (settled) return;
          settled = true;
          loaded++;
          if (loaded === count) onDone(images);
          // best-effort pre-decode so the first draw of a frame isn't
          // also the moment it gets decoded; never gates readiness.
          if (im.decode) im.decode().catch(function () {});
        }
        if (im.complete) finish();
        else im.onload = finish;
        im.onerror = finish;
      })(i);
    }
  }

  function coverDraw(ctx, img, cw, ch, srcW, srcH) {
    var cover = Math.max(cw / srcW, ch / srcH);
    var sw = cw / cover, sh = ch / cover;
    var sx = (srcW - sw) / 2, sy = (srcH - sh) / 2;
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, cw, ch);
  }

  function resizeCanvasTo(canvas) {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = Math.max(1, Math.round(window.innerWidth * dpr));
    var h = Math.max(1, Math.round(window.innerHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
  }

  /* ---------- hero ---------- */
  var heroImages = null;
  var heroFrameIdx = 0;
  var heroFinished = false;

  function paintHero(idx) {
    if (!heroImages) return;
    idx = Math.max(0, Math.min(heroImages.length - 1, idx));
    var img = heroImages[idx];
    if (!img.complete || !img.naturalWidth) return;
    heroFrameIdx = idx;
    resizeCanvasTo(heroCanvas);
    coverDraw(hctx, img, heroCanvas.width, heroCanvas.height, HERO_W, HERO_H);
  }

  var heroStarted = false;
  function playHero() {
    if (heroStarted || !heroImages) return;
    heroStarted = true;
    animate(HERO_DURATION_MS, heroImages.length, paintHero, function () {
      paintHero(heroImages.length - 1);
      heroFinished = true;
      playSignature();
    });
  }

  /* ---------- signature ---------- */
  var sigImages = null;
  var sigStarted = false;

  function paintSignature(idx) {
    if (!sigImages) return;
    idx = Math.max(0, Math.min(sigImages.length - 1, idx));
    var img = sigImages[idx];
    if (!img.complete || !img.naturalWidth) return;
    resizeCanvasTo(sigCanvas);
    sctx.clearRect(0, 0, sigCanvas.width, sigCanvas.height);
    sctx.drawImage(img, 0, 0, sigCanvas.width, sigCanvas.height);
  }

  function playSignature() {
    // both the hero-finished flag and the signature frames must be
    // ready; whichever arrives second is what actually starts it.
    if (sigStarted || !heroFinished || !sigImages) return;
    sigStarted = true;

    positionSignatureCanvas();
    sigCanvas.classList.add("is-visible");
    animate(SIG_DURATION_MS, sigImages.length, paintSignature, function () {
      paintSignature(sigImages.length - 1);
      // Mobile only (gated in CSS): reveal the copy + listino panel only
      // once the signature has finished writing itself out, so on mobile
      // the signature always arrives before the panel, never together.
      panel.classList.add("is-revealed");
    });
  }

  /* ---------- adaptive position for the signature (desktop only) ---- *
   * Plain cover-fit arithmetic — the same formula used to draw the hero
   * frame itself — rather than reading back a CSS transform: it can't
   * disagree with what's actually on screen because it's the same
   * calculation, not a second one trying to describe the first. */
  function positionSignatureCanvas() {
    if (window.innerWidth < 768) {
      sigCanvas.style.top = "";
      sigCanvas.style.left = "";
      sigCanvas.style.width = "";
      sigCanvas.style.height = "";
      return;
    }

    var vw = window.innerWidth, vh = window.innerHeight;
    var cover = Math.max(vw / HERO_W, vh / HERO_H);
    var sw = vw / cover, sh = vh / cover;
    var sx = (HERO_W - sw) / 2, sy = (HERO_H - sh) / 2;
    var eyeX = (HERO_W * EYE_X_FRACTION - sx) / sw * vw;
    var eyeY = (HERO_H * EYE_Y_FRACTION - sy) / sh * vh;

    // Clearing the eye always wins: `top` is set from the eye's own
    // position and never pulled back up to keep the box on-screen. If a
    // short window leaves too little room below the eye for the box at
    // its usual size, the box shrinks (same aspect ratio) to fit instead
    // — always fully visible *and* never overlapping, at the cost of
    // getting smaller on a short window rather than a fixed size no
    // matter what.
    var GAP = 24, BOTTOM_MARGIN = 8;
    var ASPECT = SIG_W / SIG_H;
    var MAX_WIDTH = 480;
    var MIN_HEIGHT = 70;

    var top = Math.max(eyeY + GAP, 8);
    var available = vh - top - BOTTOM_MARGIN;
    var height = Math.max(MIN_HEIGHT, Math.min(MAX_WIDTH / ASPECT, available));
    var width = Math.round(height * ASPECT);
    var left = Math.max(16, Math.min(eyeX - width * 0.35, vw - width - 16));

    sigCanvas.style.top = top + "px";
    sigCanvas.style.left = left + "px";
    sigCanvas.style.width = width + "px";
    sigCanvas.style.height = height + "px";
  }

  /* ---------- rAF tween: eases a frame INDEX over a duration ---------- */
  function animate(durationMs, frameCount, onFrame, onDone) {
    var start = null;
    function step(now) {
      if (start === null) start = now;
      var t = Math.min(1, (now - start) / durationMs);
      onFrame(Math.round(t * (frameCount - 1)));
      if (t < 1) requestAnimationFrame(step);
      else onDone();
    }
    requestAnimationFrame(step);
  }

  /* ---------- resize: keep both canvases correct as the window changes ---------- */
  var resizeRaf = null;
  window.addEventListener("resize", function () {
    if (resizeRaf) return;
    resizeRaf = requestAnimationFrame(function () {
      resizeRaf = null;
      paintHero(heroFrameIdx);
      positionSignatureCanvas();
      if (sigImages) paintSignature(sigStarted ? sigImages.length - 1 : 0);
    });
  });

  /* ---------- boot ---------- */
  loadSequence(HERO_FOLDER, HERO_FRAME_COUNT, function (images) {
    heroImages = images;
    paintHero(0);
    playHero();
  });
  loadSequence(SIG_FOLDER, SIG_FRAME_COUNT, function (images) {
    sigImages = images;
    playSignature(); // no-op unless the hero already finished waiting on this
  });
})();

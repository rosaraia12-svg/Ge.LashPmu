/* ------------------------------------------------------------------ *
 * panel.js — the intro panel's four sections (Presentazione, Ciglia,
 * Laminazione, Dermopigmentazione) are laid out back-to-back inside
 * #panel-scroll with CSS scroll-snap; this file is what makes the tab
 * row and the scroll position agree with each other:
 *   - clicking a tab scrolls .panel__scroll to that section;
 *   - scrolling or swiping .panel__scroll (wheel, trackpad, touch)
 *     updates which tab shows as active.
 * Independent of sequence.js (which only cares about the two canvases
 * and revealing the panel on mobile) — this only touches the tabs and
 * the scroll position inside the already-revealed panel.
 * ------------------------------------------------------------------ */
(function () {
  "use strict";

  var scrollEl = document.getElementById("panel-scroll");
  var tabs = Array.prototype.slice.call(document.querySelectorAll(".panel__tab"));
  var pages = Array.prototype.slice.call(document.querySelectorAll(".panel__page"));
  if (!scrollEl || !tabs.length || !pages.length) return;

  function setActive(index) {
    tabs.forEach(function (tab, i) {
      var active = i === index;
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-selected", active ? "true" : "false");
    });
  }

  // Hand-rolled smooth scroll, not scrollIntoView({behavior:'smooth'}) or
  // scrollEl.scrollTo({behavior:'smooth'}): both silently do nothing when
  // the container also has scroll-snap-type — confirmed by testing, not
  // a guess — so native smooth-scroll can't be relied on here.
  var scrollAnimId = null;
  function animateScrollTo(target, duration) {
    if (scrollAnimId) cancelAnimationFrame(scrollAnimId);
    var start = scrollEl.scrollTop;
    var delta = target - start;
    var startTime = null;
    function step(now) {
      if (startTime === null) startTime = now;
      var t = Math.min(1, (now - startTime) / duration);
      var eased = t * (2 - t); // ease-out-quad
      scrollEl.scrollTop = start + delta * eased;
      if (t < 1) scrollAnimId = requestAnimationFrame(step);
      else scrollAnimId = null;
    }
    scrollAnimId = requestAnimationFrame(step);
  }

  tabs.forEach(function (tab, i) {
    tab.addEventListener("click", function () {
      animateScrollTo(pages[i].offsetTop, 420);
      setActive(i); // instant feedback; the scroll listener below confirms it
    });
  });

  // Keep the tab row in sync while the panel itself is scrolled/swiped.
  var ticking = false;
  scrollEl.addEventListener("scroll", function () {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(function () {
      ticking = false;
      var idx = Math.round(scrollEl.scrollTop / scrollEl.clientHeight);
      idx = Math.max(0, Math.min(pages.length - 1, idx));
      setActive(idx);
    });
  }, { passive: true });
})();

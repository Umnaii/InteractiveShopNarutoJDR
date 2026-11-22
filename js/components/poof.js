/**
 * "Poof" effect: a small burst of cartoon smoke puffs with a short label, played where a
 * purchase was confirmed (like a ninja vanishing in a cloud of smoke).
 * Plain script: attaches its API to the shared App namespace as App.poof.
 * Depends on App.dom (must be loaded first).
 *
 * The effect lives in a fixed-position layer appended to <body>, not inside the view,
 * because a successful purchase re-renders the view and removes the clicked button.
 * Callers must therefore capture the button's position BEFORE purchasing:
 *
 *   const rect = button.getBoundingClientRect();
 *   if (purchaseItem(...).ok) playPoof(rect);
 */

(function () {
  "use strict";
  window.App = window.App || {};

  const { h } = App.dom;

  /** Number of smoke puffs in one burst, spread evenly around the center. */
  const PUFF_COUNT = 7;
  /** How far (rem) each puff drifts from the center. */
  const PUFF_DISTANCE_REM = 1.7;
  /** Matches the longest CSS animation in components.css (.poof*), plus a margin. */
  const POOF_LIFETIME_MS = 900;

  /**
   * Play the poof effect centered on a rectangle (typically a button's bounding box).
   * @param {DOMRect|{left:number, top:number, width:number, height:number}} rect - Viewport coordinates.
   * @param {string|false} [label] - Short text popping out of the cloud. Defaults to "Pouf !";
   *   pass false for smoke only (e.g. near the top of the screen, where the rising text would be cut off).
   * @returns {void}
   */
  function playPoof(rect, label) {
    if (!rect) return;
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    const puffs = [];
    for (let i = 0; i < PUFF_COUNT; i++) {
      const angle = (i / PUFF_COUNT) * Math.PI * 2;
      const dx = (Math.cos(angle) * PUFF_DISTANCE_REM).toFixed(2);
      const dy = (Math.sin(angle) * PUFF_DISTANCE_REM * 0.75).toFixed(2);
      // Alternate three sizes so the cloud looks lumpy rather than like a perfect ring.
      const size = [1.5, 2.1, 1.8][i % 3];
      puffs.push(
        h("span", {
          class: "poof__puff",
          style: `--dx: ${dx}rem; --dy: ${dy}rem; --size: ${size}rem; animation-delay: ${(i % 3) * 25}ms;`,
        }),
      );
    }

    const layer = h("div", { class: "poof", style: `left: ${centerX}px; top: ${centerY}px;` }, [
      h("span", { class: "poof__puff poof__puff--core", style: "--dx: 0rem; --dy: 0rem; --size: 2.6rem;" }),
      ...puffs,
      label === false ? null : h("span", { class: "poof__label", role: "status" }, label || "Pouf !"),
    ]);

    document.body.append(layer);
    window.setTimeout(() => layer.remove(), POOF_LIFETIME_MS);
  }

  App.poof = { playPoof };
})();

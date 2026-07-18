/**
 * Star rating component: renders a rarity value as colored star glyphs.
 * Plain script: attaches its API to the shared App namespace as App.starRating.
 * Depends on App.dom, App.format (must be loaded first).
 */

(function () {
  "use strict";
  window.App = window.App || {};

  const { h } = App.dom;
  const { starGlyphs } = App.format;

  /**
   * Build a star rating element for a rarity value.
   * @param {number} rarity - Integer 1..5.
   * @param {{label?: string}} [options]
   * @returns {HTMLElement}
   */
  function createStarRating(rarity, options) {
    options = options || {};
    const label = options.label ?? `Rareté ${rarity} sur 5`;
    return h("span", { class: "stars", "data-tier": String(rarity), role: "img", "aria-label": label }, starGlyphs(rarity));
  }

  App.starRating = { createStarRating };
})();

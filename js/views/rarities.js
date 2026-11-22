/**
 * Rarity legend: the star-tier table from the catalogue, shown at the bottom of the shop
 * (it used to be its own page; the old "#/rarities" link now opens the shop on it).
 * Plain script: attaches its API to the shared App namespace as App.raritiesView.
 * Depends on App.rarities, App.starRating, App.dom.
 */

(function () {
  "use strict";
  window.App = window.App || {};

  const { RARITY_TIERS, RARITY_NOTE } = App.rarities;
  const { createStarRating } = App.starRating;
  const { h } = App.dom;

  /** Id of the legend section, so a link can scroll straight to it. */
  const LEGEND_ID = "rarity-legend";

  /**
   * Build the rarity legend section (title, table, closing note).
   * @returns {HTMLElement}
   */
  function buildRarityLegend() {
    const rows = RARITY_TIERS.map((tier) =>
      h("tr", {}, [
        h("td", {}, createStarRating(tier.stars, { label: tier.label })),
        h("td", {}, tier.whereToFind),
        h("td", {}, tier.meaning),
      ]),
    );

    return h("section", { class: "category-section rarity-legend", id: LEGEND_ID }, [
      h("h2", { class: "category-section__title" }, [h("span", { class: "category-section__letter", "aria-hidden": "true" }, "★"), "Légende des raretés"]),
      h("p", { class: "text-muted" }, "La rareté n'est pas qu'un prix : elle dit où et auprès de qui l'objet se trouve."),
      h("div", { class: "card table-scroll" }, [
        h("table", { class: "table" }, [
          h("thead", {}, h("tr", {}, [h("th", {}, "Rareté"), h("th", {}, "Où le trouver"), h("th", {}, "Ce que ça représente")])),
          h("tbody", {}, rows),
        ]),
      ]),
      h("p", { class: "text-muted" }, RARITY_NOTE),
    ]);
  }

  App.raritiesView = { buildRarityLegend, LEGEND_ID };
})();

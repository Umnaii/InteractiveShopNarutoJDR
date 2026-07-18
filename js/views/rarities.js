/**
 * Rarity legend view: renders the star-tier table from the catalogue.
 * Plain script: attaches its API to the shared App namespace as App.raritiesView.
 * Depends on App.rarities, App.starRating, App.dom.
 */

(function () {
  "use strict";
  window.App = window.App || {};

  const { RARITY_TIERS, RARITY_NOTE } = App.rarities;
  const { createStarRating } = App.starRating;
  const { h, clearElement } = App.dom;

  /**
   * Render the rarity legend view into a container.
   * @param {HTMLElement} container
   * @returns {void}
   */
  function renderRaritiesView(container) {
    clearElement(container);

    const rows = RARITY_TIERS.map((tier) =>
      h("tr", {}, [
        h("td", {}, createStarRating(tier.stars, { label: tier.label })),
        h("td", {}, tier.whereToFind),
        h("td", {}, tier.meaning),
      ]),
    );

    container.append(
      h("div", { class: "view-header" }, [
        h("div", {}, [
          h("h1", {}, "Légende des raretés"),
          h("p", {}, "La rareté n'est pas qu'un prix : elle dit où et auprès de qui l'objet se trouve."),
        ]),
      ]),
      h("div", { class: "card" }, [
        h("table", { class: "table" }, [
          h("thead", {}, h("tr", {}, [h("th", {}, "Rareté"), h("th", {}, "Où le trouver"), h("th", {}, "Ce que ça représente")])),
          h("tbody", {}, rows),
        ]),
      ]),
      h("p", { class: "text-muted" }, RARITY_NOTE),
    );
  }

  App.raritiesView = { renderRaritiesView };
})();

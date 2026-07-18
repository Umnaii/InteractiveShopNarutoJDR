/**
 * Item card component: compact shop listing tile with a link to the detail view
 * and an optional quick-buy button.
 * Plain script: attaches its API to the shared App namespace as App.itemCard.
 * Depends on App.dom, App.starRating, App.format (must be loaded first).
 */

(function () {
  "use strict";
  window.App = window.App || {};

  const { h } = App.dom;
  const { createStarRating } = App.starRating;
  const { typeLabel } = App.format;

  /**
   * Build an item card for the shop grid.
   * @param {object} item
   * @param {{canBuy?: boolean, onBuy?: (itemId: string) => void}} [options]
   * @returns {HTMLElement}
   */
  function createItemCard(item, options) {
    options = options || {};
    const badges = [h("span", { class: `badge badge--type-${item.type}` }, typeLabel(item.type))];
    if (item.gmOnly) badges.push(h("span", { class: "badge badge--gm" }, "Conteur"));
    if (!item.purchasable) badges.push(h("span", { class: "badge badge--muted" }, "Hors-commerce"));

    const buyButton = item.purchasable
      ? h(
          "button",
          {
            class: "btn btn--primary btn--sm",
            type: "button",
            disabled: !options.canBuy,
            "aria-label": `Acheter ${item.name}`,
            onClick: () => options.onBuy?.(item.id),
          },
          "Acheter",
        )
      : null;

    return h("div", { class: "item-card" }, [
      h("div", { class: "item-card__top" }, [
        h("a", { class: "item-card__name", href: `#/item/${item.id}` }, item.name),
        createStarRating(item.rarity),
      ]),
      h("div", { class: "row" }, badges),
      h("div", { class: "item-card__footer" }, [h("span", { class: "item-card__price" }, item.priceLabel), buyButton]),
    ]);
  }

  App.itemCard = { createItemCard };
})();

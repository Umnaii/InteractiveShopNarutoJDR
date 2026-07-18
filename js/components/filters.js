/**
 * Shop filter bar component: category, rarity, type and free-text search.
 * The "show hors-commerce" / "GM mode" toggles are global settings, not filters,
 * and are rendered separately by the shop view.
 * Plain script: attaches its API to the shared App namespace as App.filters.
 * Depends on App.dom, App.items, App.format (must be loaded first).
 *
 * @typedef {Object} ShopFilters
 * @property {string} category - "" for all, or "A".."J".
 * @property {number} rarity - 0 for all, or 1..5.
 * @property {string} type - "" for all, or an item type.
 * @property {string} search - Free-text name search.
 */

(function () {
  "use strict";
  window.App = window.App || {};

  const { h } = App.dom;
  const { CATEGORY_LABELS } = App.items;
  const { typeLabel } = App.format;

  const ITEM_TYPES = ["consommable", "permanent", "restreint", "intrigue"];

  /**
   * Build the shop filter bar.
   * @param {ShopFilters} initial
   * @param {(filters: ShopFilters) => void} onChange
   * @returns {HTMLElement}
   */
  function createFilterBar(initial, onChange) {
    const state = { ...initial };

    const searchInput = h("input", {
      type: "search",
      id: "filter-search",
      placeholder: "Nom de l'objet…",
      value: state.search,
      onInput: (event) => {
        state.search = event.target.value;
        onChange({ ...state });
      },
    });

    const categorySelect = h(
      "select",
      {
        id: "filter-category",
        onChange: (event) => {
          state.category = event.target.value;
          onChange({ ...state });
        },
      },
      [
        h("option", { value: "" }, "Toutes"),
        ...Object.entries(CATEGORY_LABELS).map(([letter, label]) => h("option", { value: letter }, `${letter}. ${label}`)),
      ],
    );
    categorySelect.value = state.category;

    const raritySelect = h(
      "select",
      {
        id: "filter-rarity",
        onChange: (event) => {
          state.rarity = Number(event.target.value);
          onChange({ ...state });
        },
      },
      [h("option", { value: "0" }, "Toutes"), ...[1, 2, 3, 4, 5].map((tier) => h("option", { value: String(tier) }, "★".repeat(tier)))],
    );
    raritySelect.value = String(state.rarity);

    const typeSelect = h(
      "select",
      {
        id: "filter-type",
        onChange: (event) => {
          state.type = event.target.value;
          onChange({ ...state });
        },
      },
      [h("option", { value: "" }, "Tous"), ...ITEM_TYPES.map((type) => h("option", { value: type }, typeLabel(type)))],
    );
    typeSelect.value = state.type;

    return h("div", { class: "filter-bar" }, [
      h("div", { class: "field" }, [h("label", { for: "filter-search" }, "Recherche"), searchInput]),
      h("div", { class: "field" }, [h("label", { for: "filter-category" }, "Catégorie"), categorySelect]),
      h("div", { class: "field" }, [h("label", { for: "filter-rarity" }, "Rareté"), raritySelect]),
      h("div", { class: "field" }, [h("label", { for: "filter-type" }, "Type"), typeSelect]),
    ]);
  }

  App.filters = { createFilterBar };
})();

/**
 * Shop filter bar component: category, rarity, type and free-text search.
 * The "show hors-commerce" / "GM mode" toggles are global settings, not filters,
 * and are rendered separately by the shop view.
 * Plain script: attaches its API to the shared App namespace as App.filters.
 * Depends on App.dom, App.items, App.format (must be loaded first).
 *
 * @typedef {Object} ShopFilters
 * @property {string} category - "" for all, or "A".."J".
 * @property {number[]} rarities - Empty array for all rarities, otherwise the selected tiers (1..5), OR'd together.
 * @property {string} type - "" for all, or an item type.
 * @property {string} search - Free-text name search.
 * @property {string} sort - "" for catalogue order, or "price-asc" | "price-desc".
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

    const rarityFieldset = h(
      "fieldset",
      { class: "field filter-bar__rarity" },
      [
        h("legend", {}, "Rareté"),
        h(
          "div",
          { class: "rarity-filter" },
          [1, 2, 3, 4, 5].map((tier) => {
            const checkbox = h("input", {
              type: "checkbox",
              checked: state.rarities.includes(tier),
              "aria-label": `Rareté ${tier} sur 5`,
            });
            checkbox.addEventListener("change", () => {
              state.rarities = checkbox.checked
                ? [...state.rarities, tier].sort((a, b) => a - b)
                : state.rarities.filter((selected) => selected !== tier);
              onChange({ ...state });
            });
            return h(
              "label",
              { class: "rarity-filter__option", "data-tier": String(tier), title: `Rareté ${tier} sur 5` },
              [checkbox, "★".repeat(tier)],
            );
          }),
        ),
      ],
    );

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

    const sortSelect = h(
      "select",
      {
        id: "filter-sort",
        onChange: (event) => {
          state.sort = event.target.value;
          onChange({ ...state });
        },
      },
      [
        h("option", { value: "" }, "Ordre du catalogue"),
        h("option", { value: "price-asc" }, "Prix croissant"),
        h("option", { value: "price-desc" }, "Prix décroissant"),
      ],
    );
    sortSelect.value = state.sort;

    return h("div", { class: "filter-bar" }, [
      h("div", { class: "field" }, [h("label", { for: "filter-search" }, "Recherche"), searchInput]),
      h("div", { class: "field" }, [h("label", { for: "filter-category" }, "Catégorie"), categorySelect]),
      rarityFieldset,
      h("div", { class: "field" }, [h("label", { for: "filter-type" }, "Type"), typeSelect]),
      h("div", { class: "field" }, [h("label", { for: "filter-sort" }, "Tri"), sortSelect]),
    ]);
  }

  App.filters = { createFilterBar };
})();

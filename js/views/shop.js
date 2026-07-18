/**
 * Shop view: browse the catalogue grouped by category, filter it, and buy items
 * for the active profile.
 * Plain script: attaches its API to the shared App namespace as App.shopView.
 * Depends on App.items, App.state, App.economy, App.filters, App.itemCard, App.dom.
 */

(function () {
  "use strict";
  window.App = window.App || {};

  const { ITEMS, CATEGORY_LABELS } = App.items;
  const { getSettings, setSettings, getActiveProfile, subscribe } = App.state;
  const { purchaseItem } = App.economy;
  const { createFilterBar } = App.filters;
  const { createItemCard } = App.itemCard;
  const { h, clearElement } = App.dom;

  const DEFAULT_FILTERS = { category: "", rarity: 0, type: "", search: "" };

  /**
   * Render the shop view into a container.
   * @param {HTMLElement} container
   * @returns {() => void} Cleanup function to call when leaving the view.
   */
  function renderShopView(container) {
    let filters = { ...DEFAULT_FILTERS };

    function matchesFilters(item, settings) {
      if (item.gmOnly && !settings.gmMode) return false;
      if (!item.purchasable && !settings.showHorsCommerce) return false;
      if (filters.category && item.category !== filters.category) return false;
      if (filters.rarity && item.rarity !== filters.rarity) return false;
      if (filters.type && item.type !== filters.type) return false;
      if (filters.search && !item.name.toLowerCase().includes(filters.search.trim().toLowerCase())) return false;
      return true;
    }

    function handleBuy(itemId) {
      const activeProfile = getActiveProfile();
      if (!activeProfile) {
        window.alert("Sélectionnez d'abord un profil actif dans l'en-tête.");
        return;
      }
      const result = purchaseItem(activeProfile.id, itemId, 1);
      if (!result.ok) {
        window.alert(result.message);
      }
    }

    function renderResults() {
      const settings = getSettings();
      const activeProfile = getActiveProfile();
      const resultsRoot = container.querySelector("#shop-results");
      clearElement(resultsRoot);

      const visibleItems = ITEMS.filter((item) => matchesFilters(item, settings));

      if (!visibleItems.length) {
        resultsRoot.append(h("div", { class: "empty-state" }, "Aucun objet ne correspond à ces filtres."));
        return;
      }

      for (const [letter, label] of Object.entries(CATEGORY_LABELS)) {
        const itemsInCategory = visibleItems.filter((item) => item.category === letter);
        if (!itemsInCategory.length) continue;

        resultsRoot.append(
          h("section", { class: "category-section" }, [
            h("h2", { class: "category-section__title" }, [h("span", { class: "category-section__letter" }, letter), label]),
            h(
              "div",
              { class: "grid shop-grid" },
              itemsInCategory.map((item) =>
                createItemCard(item, { canBuy: Boolean(activeProfile), onBuy: handleBuy }),
              ),
            ),
          ]),
        );
      }
    }

    clearElement(container);

    const settings = getSettings();
    const filterBar = createFilterBar(filters, (next) => {
      filters = next;
      renderResults();
    });

    const toggles = h("div", { class: "filter-bar__toggles" }, [
      h("label", { class: "toggle" }, [
        h("input", {
          type: "checkbox",
          checked: settings.showHorsCommerce,
          onChange: (event) => setSettings({ showHorsCommerce: event.target.checked }),
        }),
        "Afficher les objets hors-commerce",
      ]),
      h("label", { class: "toggle" }, [
        h("input", {
          type: "checkbox",
          checked: settings.gmMode,
          onChange: (event) => setSettings({ gmMode: event.target.checked }),
        }),
        "Mode Conteur",
      ]),
    ]);
    filterBar.append(toggles);

    container.append(
      h("div", { class: "view-header" }, [h("div", {}, [h("h1", {}, "Boutique"), h("p", {}, "Parcourez le catalogue et achetez pour le profil actif.")])]),
      filterBar,
      h("div", { id: "shop-results" }),
    );

    renderResults();

    return subscribe(() => renderResults());
  }

  App.shopView = { renderShopView };
})();

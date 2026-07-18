/**
 * Inventory view: per-profile owned items grouped by category, with consume/resell
 * actions and a total resale value summary.
 * Plain script: attaches its API to the shared App namespace as App.inventoryView.
 * Depends on App.items, App.state, App.economy, App.format, App.starRating, App.dom.
 */

(function () {
  "use strict";
  window.App = window.App || {};

  const { CATEGORY_LABELS } = App.items;
  const { getActiveProfile, subscribe } = App.state;
  const { getItemById, getItemUnitPrice, getInventoryValue, resellItem, consumeItem, undoLastPurchase } = App.economy;
  const { formatRyo } = App.format;
  const { createStarRating } = App.starRating;
  const { h, clearElement } = App.dom;

  /**
   * Render the inventory view into a container.
   * @param {HTMLElement} container
   * @returns {() => void} Cleanup function to call when leaving the view.
   */
  function renderInventoryView(container) {
    function handleConsume(profileId, item) {
      const result = consumeItem(profileId, item.id, 1);
      if (!result.ok) window.alert(result.message);
    }

    function handleResell(profileId, item) {
      const result = resellItem(profileId, item.id, 1);
      if (!result.ok) window.alert(result.message);
    }

    function handleUndo(profileId, item) {
      const result = undoLastPurchase(profileId, item.id);
      if (!result.ok) window.alert(result.message);
    }

    function render() {
      clearElement(container);
      const profile = getActiveProfile();

      if (!profile) {
        container.append(
          h("div", { class: "empty-state" }, [
            h("p", {}, "Aucun profil actif."),
            h("a", { class: "btn btn--primary", href: "#/profiles" }, "Gérer les profils"),
          ]),
        );
        return;
      }

      container.append(
        h("div", { class: "view-header" }, [
          h("div", {}, [
            h("h1", {}, `Inventaire — ${profile.name}`),
            h("p", {}, `Valeur totale de revente : ${formatRyo(getInventoryValue(profile))}`),
          ]),
        ]),
      );

      if (!profile.inventory.length) {
        container.append(h("div", { class: "empty-state" }, "Cet inventaire est vide pour le moment."));
        return;
      }

      const grouped = {};
      for (const entry of profile.inventory) {
        const item = getItemById(entry.itemId);
        if (!item) continue;
        (grouped[item.category] ??= []).push({ item, entry });
      }

      for (const [letter, label] of Object.entries(CATEGORY_LABELS)) {
        const rows = grouped[letter];
        if (!rows || !rows.length) continue;

        container.append(
          h("section", { class: "category-section" }, [
            h("h2", { class: "category-section__title" }, [h("span", { class: "category-section__letter" }, letter), label]),
            h("div", { class: "card" }, [
              h("table", { class: "table" }, [
                h(
                  "thead",
                  {},
                  h("tr", {}, [h("th", {}, "Objet"), h("th", {}, "Rareté"), h("th", {}, "Quantité"), h("th", {}, "Valeur de revente"), h("th", {}, "Actions")]),
                ),
                h(
                  "tbody",
                  {},
                  rows.map(({ item, entry }) =>
                    h("tr", {}, [
                      h("td", {}, h("a", { href: `#/item/${item.id}` }, item.name)),
                      h("td", {}, createStarRating(item.rarity)),
                      h("td", {}, String(entry.quantity)),
                      h("td", {}, formatRyo(Math.round(getItemUnitPrice(item) * 0.5) * entry.quantity)),
                      h("td", {}, [
                        h(
                          "div",
                          { class: "row" },
                          [
                            item.type === "consommable"
                              ? h("button", { class: "btn btn--sm", type: "button", onClick: () => handleConsume(profile.id, item) }, "Consommer")
                              : null,
                            h("button", { class: "btn btn--sm btn--danger", type: "button", onClick: () => handleResell(profile.id, item) }, "Revendre"),
                            h(
                              "button",
                              {
                                class: "btn btn--sm btn--ghost",
                                type: "button",
                                title: "Annule le dernier achat de cet objet et rembourse le prix payé (contrairement à la revente, à 50 %).",
                                onClick: () => handleUndo(profile.id, item),
                              },
                              "Annuler l'achat",
                            ),
                          ].filter(Boolean),
                        ),
                      ]),
                    ]),
                  ),
                ),
              ]),
            ]),
          ]),
        );
      }
    }

    render();
    return subscribe(() => render());
  }

  App.inventoryView = { renderInventoryView };
})();

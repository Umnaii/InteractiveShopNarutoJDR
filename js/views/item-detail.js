/**
 * Item detail view: full information for a single catalogue item, reachable by
 * clicking an item in the shop or via the "#/item/:id" route.
 * Plain script: attaches its API to the shared App namespace as App.itemDetailView.
 * Depends on App.economy, App.state, App.starRating, App.format, App.dom.
 */

(function () {
  "use strict";
  window.App = window.App || {};

  const { getItemById, getItemUnitPrice, getItemTotalPrice, purchaseItem } = App.economy;
  const { getActiveProfile, getSettings, subscribe } = App.state;
  const { createStarRating } = App.starRating;
  const { categoryLabel, typeLabel, formatRyo } = App.format;
  const { h, clearElement } = App.dom;

  /**
   * Render the item detail view into a container.
   * @param {HTMLElement} container
   * @param {string} itemId
   * @returns {() => void} Cleanup function to call when leaving the view.
   */
  function renderItemDetailView(container, itemId) {
    const item = getItemById(itemId);

    function renderMissing() {
      clearElement(container);
      container.append(
        h("div", { class: "empty-state" }, [
          h("p", {}, "Objet introuvable."),
          h("a", { class: "btn btn--primary", href: "#/shop" }, "Retour à la boutique"),
        ]),
      );
    }

    function renderGmOnlyLocked() {
      clearElement(container);
      container.append(
        h("div", { class: "view-header" }, [h("a", { class: "btn btn--ghost btn--sm", href: "#/shop" }, "← Retour à la boutique")]),
        h("div", { class: "empty-state" }, [
          h("h2", {}, "Objet réservé au conteur"),
          h("p", {}, "Activez le « mode Conteur » depuis la boutique pour consulter le détail de cet objet."),
        ]),
      );
    }

    function render() {
      if (!item) return renderMissing();

      const settings = getSettings();
      if (item.gmOnly && !settings.gmMode) return renderGmOnlyLocked();

      clearElement(container);
      const activeProfile = getActiveProfile();

      const quantityInput = h("input", {
        type: "number",
        id: "item-detail-quantity",
        min: "1",
        value: 1,
      });

      const totalLabel = h("span", { class: "text-muted" });
      const savingsLabel = h("p", { class: "text-success" });

      function updateTotal() {
        const qty = Math.max(1, Math.floor(Number(quantityInput.value) || 1));
        const total = getItemTotalPrice(item, qty);
        const fullPrice = getItemUnitPrice(item) * qty;
        totalLabel.textContent = formatRyo(total);
        savingsLabel.textContent = total < fullPrice ? `Tarif de volée appliqué : économie de ${formatRyo(fullPrice - total)}.` : "";
      }
      quantityInput.addEventListener("input", updateTotal);
      updateTotal();

      const bulkButton = item.bulk
        ? h(
            "button",
            { class: "btn btn--ghost btn--sm", type: "button" },
            `Lot de ${item.bulk.quantity} (${formatRyo(item.bulk.price)})`,
          )
        : null;
      bulkButton?.addEventListener("click", () => {
        quantityInput.value = item.bulk.quantity;
        updateTotal();
      });

      const buyButton = h(
        "button",
        {
          class: "btn btn--primary",
          type: "button",
          disabled: !activeProfile,
          onClick: () => {
            if (!activeProfile) {
              window.alert("Sélectionnez d'abord un profil actif dans l'en-tête.");
              return;
            }
            const qty = Math.max(1, Math.floor(Number(quantityInput.value) || 1));
            const result = purchaseItem(activeProfile.id, item.id, qty);
            window.alert(result.ok ? `Achat effectué : ${item.name} ×${qty}.` : result.message);
          },
        },
        "Acheter",
      );

      const purchaseControls = item.purchasable
        ? h("div", { class: "stack" }, [
            h("div", { class: "row" }, [
              h("div", { class: "field" }, [h("label", { for: "item-detail-quantity" }, "Quantité"), quantityInput]),
              h("div", { class: "field" }, [h("label", {}, "Total"), totalLabel]),
              bulkButton,
              buyButton,
            ].filter(Boolean)),
            savingsLabel,
          ])
        : h("p", { class: "text-muted" }, "Cet objet est hors-commerce : il ne peut pas être acheté en boutique.");

      container.append(
        h("div", { class: "view-header" }, [h("a", { class: "btn btn--ghost btn--sm", href: "#/shop" }, "← Retour à la boutique")]),
        h("div", { class: "card stack" }, [
          h("div", { class: "row row--between" }, [h("h1", {}, item.name), createStarRating(item.rarity)]),
          h("div", { class: "row" }, [
            h("span", { class: "badge" }, `${item.category} · ${categoryLabel(item.category)}`),
            h("span", { class: `badge badge--type-${item.type}` }, typeLabel(item.type)),
            item.gmOnly ? h("span", { class: "badge badge--gm" }, "Conteur") : null,
            !item.purchasable ? h("span", { class: "badge badge--muted" }, "Hors-commerce") : null,
          ].filter(Boolean)),
          h("hr", { class: "divider" }),
          h("div", {}, [h("h3", {}, "Prix"), h("p", { class: "item-card__price" }, item.priceLabel)]),
          h("div", {}, [h("h3", {}, "Conditions d'utilisation"), h("p", {}, item.usage)]),
          h("div", {}, [h("h3", {}, "Effet"), h("p", {}, item.effect)]),
          h("hr", { class: "divider" }),
          purchaseControls,
        ]),
      );
    }

    render();
    return subscribe(() => render());
  }

  App.itemDetailView = { renderItemDetailView };
})();

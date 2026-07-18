/**
 * Cart ("panier") view: stage items and quantities before buying, see the running
 * total, then check out for the active profile in a single atomic purchase.
 * Plain script: attaches its API to the shared App namespace as App.cartView.
 * Depends on App.state, App.economy, App.format, App.dom.
 */

(function () {
  "use strict";
  window.App = window.App || {};

  const { getCart, setCartQuantity, removeFromCart, clearCart, getActiveProfile, subscribe } = App.state;
  const { getItemById, getItemUnitPrice, getItemTotalPrice, purchaseCart } = App.economy;
  const { formatRyo } = App.format;
  const { h, clearElement } = App.dom;

  /**
   * Render the cart view into a container.
   * @param {HTMLElement} container
   * @returns {() => void} Cleanup function to call when leaving the view.
   */
  function renderCartView(container) {
    function handleCheckout(profileId, lines) {
      const result = purchaseCart(profileId, lines);
      if (!result.ok) {
        window.alert(result.message);
        return;
      }
      clearCart();
      window.alert("Achat validé, le panier a été vidé.");
    }

    function render() {
      clearElement(container);
      const cart = getCart();
      const activeProfile = getActiveProfile();

      container.append(h("div", { class: "view-header" }, [h("div", {}, [h("h1", {}, "Panier"), h("p", {}, "Préparez vos achats avant de valider.")])]));

      if (!cart.length) {
        container.append(
          h("div", { class: "empty-state" }, [
            h("p", {}, "Le panier est vide pour le moment."),
            h("a", { class: "btn btn--primary", href: "#/shop" }, "Retour à la boutique"),
          ]),
        );
        return;
      }

      const lines = cart.map((line) => ({ line, item: getItemById(line.itemId) })).filter(({ item }) => item);
      const grandTotal = lines.reduce((sum, { item, line }) => sum + getItemTotalPrice(item, line.quantity), 0);

      const rows = lines.map(({ item, line }) => {
        const quantityInput = h("input", {
          type: "number",
          min: "1",
          value: line.quantity,
          "aria-label": `Quantité pour ${item.name}`,
        });
        quantityInput.addEventListener("input", () => setCartQuantity(item.id, Number(quantityInput.value) || 0));

        return h("tr", {}, [
          h("td", {}, h("a", { href: `#/item/${item.id}` }, item.name)),
          h("td", {}, formatRyo(getItemUnitPrice(item))),
          h("td", {}, quantityInput),
          h("td", {}, formatRyo(getItemTotalPrice(item, line.quantity))),
          h(
            "td",
            {},
            h("button", { class: "btn btn--sm btn--danger", type: "button", onClick: () => removeFromCart(item.id) }, "Retirer"),
          ),
        ]);
      });

      const clearButton = h("button", { class: "btn btn--ghost btn--sm", type: "button", onClick: () => clearCart() }, "Vider le panier");

      const checkoutButton = h(
        "button",
        {
          class: "btn btn--primary",
          type: "button",
          disabled: !activeProfile,
          onClick: () => {
            if (!activeProfile) return;
            handleCheckout(
              activeProfile.id,
              lines.map(({ line }) => ({ itemId: line.itemId, quantity: line.quantity })),
            );
          },
        },
        "Valider l'achat",
      );

      container.append(
        h("div", { class: "card stack" }, [
          h("table", { class: "table" }, [
            h(
              "thead",
              {},
              h("tr", {}, [h("th", {}, "Objet"), h("th", {}, "Prix unitaire"), h("th", {}, "Quantité"), h("th", {}, "Sous-total"), h("th", {}, "Actions")]),
            ),
            h("tbody", {}, rows),
          ]),
          h("div", { class: "row row--between" }, [
            h("p", {}, [h("strong", {}, `Total : ${formatRyo(grandTotal)}`)]),
            h("div", { class: "row" }, [clearButton, checkoutButton]),
          ]),
          !activeProfile ? h("p", { class: "text-muted" }, "Sélectionnez un profil actif dans l'en-tête pour valider l'achat.") : null,
        ].filter(Boolean)),
      );
    }

    render();
    return subscribe(() => render());
  }

  App.cartView = { renderCartView };
})();

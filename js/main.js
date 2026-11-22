/**
 * Entry point: boots the app, builds the header/nav shell, and registers routes.
 * Plain script, loaded last. Reads every other App.* module, all already attached
 * by the scripts loaded before this one (see index.html for the required order).
 */

(function () {
  "use strict";
  window.App = window.App || {};

  const { initState, getCart, subscribe } = App.state;
  const { createProfileSwitcher } = App.profileSwitcher;
  const { registerRoute, initRouter } = App.router;
  const { renderShopView } = App.shopView;
  const { renderItemDetailView } = App.itemDetailView;
  const { renderRaritiesView } = App.raritiesView;
  const { renderInventoryView } = App.inventoryView;
  const { renderMissionsView } = App.missionsView;
  const { renderProfilesView } = App.profilesView;
  const { renderCartView } = App.cartView;
  const { h, clearElement } = App.dom;

  const NAV_ITEMS = [
    { path: "/shop", label: "Boutique" },
    { path: "/cart", label: "Panier" },
    { path: "/rarities", label: "Raretés" },
    { path: "/inventory", label: "Inventaire" },
    { path: "/missions", label: "Missions" },
    { path: "/profiles", label: "Profils" },
  ];

  /**
   * Build the top navigation links once, at boot.
   * @returns {void}
   */
  function renderNav() {
    const list = document.getElementById("app-nav-list");
    clearElement(list);
    for (const item of NAV_ITEMS) {
      const linkAttrs = { class: "app-nav__link", href: `#${item.path}` };
      if (item.path === "/cart") linkAttrs.id = "nav-cart-link";
      list.append(h("li", {}, h("a", linkAttrs, item.label)));
    }
  }

  /**
   * Refresh the cart nav link's item count, e.g. "Panier (3)".
   * @returns {void}
   */
  function updateCartBadge() {
    const link = document.getElementById("nav-cart-link");
    if (!link) return;
    const count = getCart().reduce((sum, line) => sum + line.quantity, 0);
    link.textContent = count > 0 ? `Panier (${count})` : "Panier";
  }

  /**
   * Mount the header profile switcher (ninja ID card + dropdown scroll) once. It patches
   * itself on every state change, so it can animate between states.
   * @returns {void}
   */
  function mountProfileSwitcher() {
    const container = document.getElementById("profile-switcher");
    clearElement(container);
    const switcher = createProfileSwitcher();
    container.append(switcher.element);
    switcher.update();
    subscribe(switcher.update);
  }

  /**
   * Boot the application: load state, build the shell, register routes, start the router.
   * @returns {void}
   */
  function boot() {
    initState();
    renderNav();
    mountProfileSwitcher();
    updateCartBadge();
    subscribe(updateCartBadge);

    const view = () => document.getElementById("app-view");
    registerRoute("/shop", () => renderShopView(view()));
    registerRoute("/item/:id", (params) => renderItemDetailView(view(), params.id));
    registerRoute("/cart", () => renderCartView(view()));
    registerRoute("/rarities", () => renderRaritiesView(view()));
    registerRoute("/inventory", () => renderInventoryView(view()));
    registerRoute("/missions", () => renderMissionsView(view()));
    registerRoute("/profiles", () => renderProfilesView(view()));

    initRouter();
  }

  document.addEventListener("DOMContentLoaded", boot);
})();

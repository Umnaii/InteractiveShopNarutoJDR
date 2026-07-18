/**
 * Entry point: boots the app, builds the header/nav shell, and registers routes.
 * Plain script, loaded last. Reads every other App.* module, all already attached
 * by the scripts loaded before this one (see index.html for the required order).
 */

(function () {
  "use strict";
  window.App = window.App || {};

  const { initState, getProfiles, getActiveProfile, subscribe } = App.state;
  const { setActiveProfile } = App.profiles;
  const { registerRoute, initRouter } = App.router;
  const { renderShopView } = App.shopView;
  const { renderItemDetailView } = App.itemDetailView;
  const { renderRaritiesView } = App.raritiesView;
  const { renderInventoryView } = App.inventoryView;
  const { renderMissionsView } = App.missionsView;
  const { renderProfilesView } = App.profilesView;
  const { formatRyo } = App.format;
  const { h, clearElement } = App.dom;

  const NAV_ITEMS = [
    { path: "/shop", label: "Boutique" },
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
      list.append(h("li", {}, h("a", { class: "app-nav__link", href: `#${item.path}` }, item.label)));
    }
  }

  /**
   * Render the profile switcher in the header: active profile select + balance,
   * or a call-to-action to create a first profile.
   * @returns {void}
   */
  function renderProfileSwitcher() {
    const container = document.getElementById("profile-switcher");
    clearElement(container);

    const profiles = getProfiles();
    if (!profiles.length) {
      container.append(h("a", { class: "btn btn--primary btn--sm", href: "#/profiles" }, "Créer un profil"));
      return;
    }

    const active = getActiveProfile();
    const select = h(
      "select",
      { "aria-label": "Profil actif", onChange: (event) => setActiveProfile(event.target.value) },
      profiles.map((profile) => h("option", { value: profile.id }, `${profile.name} (${profile.rank})`)),
    );
    select.value = active?.id ?? "";

    container.append(
      select,
      h("span", { class: "balance-badge" }, [
        h("span", { class: "balance-badge__amount" }, active ? formatRyo(active.balance) : "—"),
        h("span", { class: "balance-badge__label" }, "Solde"),
      ]),
    );
  }

  /**
   * Boot the application: load state, build the shell, register routes, start the router.
   * @returns {void}
   */
  function boot() {
    initState();
    renderNav();
    renderProfileSwitcher();
    subscribe(renderProfileSwitcher);

    const view = () => document.getElementById("app-view");
    registerRoute("/shop", () => renderShopView(view()));
    registerRoute("/item/:id", (params) => renderItemDetailView(view(), params.id));
    registerRoute("/rarities", () => renderRaritiesView(view()));
    registerRoute("/inventory", () => renderInventoryView(view()));
    registerRoute("/missions", () => renderMissionsView(view()));
    registerRoute("/profiles", () => renderProfilesView(view()));

    initRouter();
  }

  document.addEventListener("DOMContentLoaded", boot);
})();

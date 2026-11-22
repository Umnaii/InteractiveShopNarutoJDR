/**
 * Header profile switcher, styled as a ninja ID card: the character's initial in a red
 * seal, name, rank badge and balance. Clicking it unrolls a small scroll listing every
 * profile. Switching profile plays a "substitution technique" (smoke, then the new
 * identity appears), and the balance rolls to its new value whenever it changes.
 *
 * Replaces a native <select>, so it implements the listbox keyboard pattern itself:
 * trigger: Enter / Space / ArrowDown / ArrowUp open; list: ArrowUp/ArrowDown/Home/End
 * move, Enter/Space choose, Escape closes, Tab closes and moves on; click outside closes.
 *
 * Plain script: attaches its API to the shared App namespace as App.profileSwitcher.
 * Depends on App.dom, App.state, App.profiles, App.format, App.poof (must be loaded first).
 */

(function () {
  "use strict";
  window.App = window.App || {};

  const { h, clearElement } = App.dom;
  const { getProfiles, getActiveProfile } = App.state;
  const { setActiveProfile } = App.profiles;
  const { formatRyo, initialOf } = App.format;
  const { playPoof } = App.poof;

  /** Duration of the balance "rolling digits" animation. */
  const BALANCE_ROLL_MS = 700;
  /** Unique-enough id prefix for ARIA wiring (only one switcher exists). */
  const LIST_ID = "profile-switcher-list";

  /** @returns {boolean} True when the user asked the OS to limit animations. */
  function prefersReducedMotion() {
    return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  }

  /**
   * Restart a CSS animation class on an element (remove, force reflow, re-add).
   * @param {HTMLElement} element
   * @param {string} className
   * @returns {void}
   */
  function replayClass(element, className) {
    element.classList.remove(className);
    void element.offsetWidth;
    element.classList.add(className);
  }

  /**
   * Build the profile switcher. Call `update()` after every state change; it patches the
   * existing elements (instead of rebuilding) so animations can run between states.
   * @returns {{element: HTMLElement, update: () => void}}
   */
  function createProfileSwitcher() {
    const root = h("div", { class: "profile-switcher" });

    // --- Trigger (persistent elements, patched by update) ---
    const sealEl = h("span", { class: "profile-seal", "aria-hidden": "true" });
    const nameEl = h("span", { class: "profile-switcher__name" });
    const rankEl = h("span", { class: "rank-badge" });
    const amountEl = h("span", { class: "profile-switcher__amount" });
    const identityEl = h("span", { class: "profile-switcher__identity" }, [
      sealEl,
      h("span", { class: "profile-switcher__who" }, [nameEl, rankEl]),
    ]);
    const trigger = h(
      "button",
      {
        class: "profile-switcher__trigger",
        type: "button",
        "aria-haspopup": "listbox",
        "aria-expanded": "false",
        "aria-controls": LIST_ID,
      },
      [
        identityEl,
        h("span", { class: "profile-switcher__balance" }, [amountEl, h("span", { class: "profile-switcher__balance-label" }, "Solde")]),
        h("span", { class: "profile-switcher__chevron", "aria-hidden": "true" }, "▾"),
      ],
    );

    // --- Dropdown: roller / paper (list + manage link) / roller ---
    const listEl = h("ul", { class: "profile-switcher__list", id: LIST_ID, role: "listbox", "aria-label": "Choisir le profil actif" });
    const panel = h("div", { class: "profile-switcher__panel" }, [
      h("div", { class: "scroll-roller", "aria-hidden": "true" }),
      h("div", { class: "profile-switcher__paper" }, [
        h("div", { class: "profile-switcher__sheet" }, [
          listEl,
          h("a", { class: "profile-switcher__manage", href: "#/profiles", onClick: () => close(false) }, "Gérer les profils"),
        ]),
      ]),
      h("div", { class: "scroll-roller", "aria-hidden": "true" }),
    ]);
    panel.hidden = true;

    let isOpen = false;
    /** undefined until the first update, so the very first render never animates. */
    let lastProfileId;
    /** Value currently on screen (mid-animation values included). */
    let displayedBalance = 0;
    /** Value the balance is rolling towards; compared on update so an unrelated state
        change during a roll doesn't restart it. */
    let targetBalance = 0;
    let rollFrame = 0;

    // --- Balance rolling digits ---

    /**
     * Animate the displayed balance to a target value.
     * @param {number} target
     * @param {"up"|"down"|null} flash - Color flash to play, or null for none.
     */
    function rollBalanceTo(target, flash) {
      cancelAnimationFrame(rollFrame);
      targetBalance = target;
      const from = displayedBalance;
      if (from === target || prefersReducedMotion()) {
        displayedBalance = target;
        amountEl.textContent = formatRyo(target);
        return;
      }
      if (flash) {
        amountEl.classList.remove("is-up", "is-down");
        replayClass(amountEl, flash === "up" ? "is-up" : "is-down");
      }
      const start = performance.now();
      const step = (now) => {
        const t = Math.min(1, (now - start) / BALANCE_ROLL_MS);
        const eased = 1 - Math.pow(1 - t, 3);
        displayedBalance = Math.round(from + (target - from) * eased);
        amountEl.textContent = formatRyo(displayedBalance);
        if (t < 1) rollFrame = requestAnimationFrame(step);
      };
      rollFrame = requestAnimationFrame(step);
    }

    // --- Substitution technique ---

    function playSubstitution() {
      if (prefersReducedMotion()) return;
      playPoof(trigger.getBoundingClientRect(), false);
      replayClass(identityEl, "is-substituted");
    }

    // --- Dropdown open / close / keyboard ---

    function optionElements() {
      return Array.from(listEl.querySelectorAll('[role="option"]'));
    }

    function renderList() {
      clearElement(listEl);
      const activeId = getActiveProfile()?.id ?? null;
      for (const profile of getProfiles()) {
        const selected = profile.id === activeId;
        const option = h(
          "li",
          {
            class: "profile-switcher__option",
            role: "option",
            tabindex: "-1",
            "aria-selected": selected ? "true" : "false",
            "data-profile-id": profile.id,
            onClick: () => choose(profile.id),
          },
          [
            h("span", { class: "profile-seal profile-seal--sm", "aria-hidden": "true" }, initialOf(profile.name)),
            h("span", { class: "profile-switcher__who" }, [
              h("span", { class: "profile-switcher__name" }, profile.name),
              h("span", { class: "rank-badge", "data-rank": profile.rank }, profile.rank),
            ]),
            h("span", { class: "profile-switcher__option-balance" }, formatRyo(profile.balance)),
          ],
        );
        listEl.append(option);
      }
    }

    function focusOption(index) {
      const options = optionElements();
      if (!options.length) return;
      const clamped = Math.max(0, Math.min(options.length - 1, index));
      // preventScroll: the paper is still unrolling (height animating from 0), so letting
      // the browser scroll it to the focused option would leave it offset once fully open.
      options[clamped].focus({ preventScroll: true });
    }

    function open(focusLast) {
      if (isOpen) return;
      isOpen = true;
      renderList();
      panel.hidden = false;
      // Replay the unroll animation on every opening.
      replayClass(panel, "is-open");
      trigger.setAttribute("aria-expanded", "true");
      root.classList.add("is-open");
      const options = optionElements();
      const selectedIndex = options.findIndex((option) => option.getAttribute("aria-selected") === "true");
      focusOption(focusLast ? options.length - 1 : Math.max(0, selectedIndex));
      document.addEventListener("pointerdown", onPointerDownOutside, true);
    }

    /** @param {boolean} [returnFocus=true] - Move focus back to the trigger. */
    function close(returnFocus) {
      if (!isOpen) return;
      isOpen = false;
      panel.hidden = true;
      panel.classList.remove("is-open");
      trigger.setAttribute("aria-expanded", "false");
      root.classList.remove("is-open");
      document.removeEventListener("pointerdown", onPointerDownOutside, true);
      if (returnFocus !== false) trigger.focus();
    }

    function choose(profileId) {
      close();
      if (profileId !== getActiveProfile()?.id) setActiveProfile(profileId);
    }

    function onPointerDownOutside(event) {
      if (!root.contains(event.target)) close(false);
    }

    trigger.addEventListener("click", () => (isOpen ? close() : open(false)));
    trigger.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        open(event.key === "ArrowUp");
      }
    });

    listEl.addEventListener("keydown", (event) => {
      const options = optionElements();
      const current = options.indexOf(document.activeElement);
      switch (event.key) {
        case "ArrowDown":
          event.preventDefault();
          focusOption(current + 1);
          break;
        case "ArrowUp":
          event.preventDefault();
          focusOption(current - 1);
          break;
        case "Home":
          event.preventDefault();
          focusOption(0);
          break;
        case "End":
          event.preventDefault();
          focusOption(options.length - 1);
          break;
        case "Enter":
        case " ":
          event.preventDefault();
          if (current >= 0) choose(options[current].getAttribute("data-profile-id"));
          break;
        case "Escape":
          event.preventDefault();
          close();
          break;
        case "Tab":
          close(false);
          break;
        default:
          break;
      }
    });

    // --- Sync with state ---

    function update() {
      const profiles = getProfiles();
      const active = getActiveProfile();

      if (!profiles.length) {
        close(false);
        clearElement(root);
        root.append(h("a", { class: "btn btn--primary btn--sm", href: "#/profiles" }, "Créer un profil"));
        lastProfileId = null;
        return;
      }

      if (!root.contains(trigger)) {
        clearElement(root);
        root.append(trigger, panel);
      }

      sealEl.textContent = active ? initialOf(active.name) : "?";
      nameEl.textContent = active ? active.name : "Choisir un profil";
      rankEl.textContent = active ? active.rank : "";
      rankEl.hidden = !active;
      if (active) rankEl.setAttribute("data-rank", active.rank);
      trigger.setAttribute(
        "aria-label",
        active ? `Profil actif : ${active.name}, ${active.rank}, solde ${formatRyo(active.balance)}. Changer de profil` : "Choisir un profil",
      );

      const activeId = active?.id ?? null;
      const balance = active ? active.balance : 0;
      if (lastProfileId === undefined) {
        // First render: show values as-is, no animation.
        displayedBalance = balance;
        targetBalance = balance;
        amountEl.textContent = active ? formatRyo(balance) : "—";
      } else if (activeId !== lastProfileId) {
        if (lastProfileId !== null && activeId !== null) playSubstitution();
        if (active) rollBalanceTo(balance, null);
        else amountEl.textContent = "—";
      } else if (active && balance !== targetBalance) {
        rollBalanceTo(balance, balance > targetBalance ? "up" : "down");
      }
      lastProfileId = activeId;

      if (isOpen) renderList();
    }

    return { element: root, update };
  }

  App.profileSwitcher = { createProfileSwitcher };
})();

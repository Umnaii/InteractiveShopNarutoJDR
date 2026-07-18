/**
 * Generic modal dialog component. Only one modal is ever open at a time,
 * rendered into the page's #modal-root element.
 * Plain script: attaches its API to the shared App namespace as App.modal.
 * Depends on App.dom (must be loaded first).
 */

(function () {
  "use strict";
  window.App = window.App || {};

  const { h, clearElement } = App.dom;

  let activeCloseHandler = null;

  /**
   * Open a modal dialog. Closes on Escape, backdrop click, or the close button.
   * @param {{title: string, body: HTMLElement|HTMLElement[], footer?: HTMLElement|HTMLElement[], onClose?: () => void, wide?: boolean}} options
   *   `wide` widens the dialog for content that needs more room (e.g. a data table).
   * @returns {() => void} A function that closes this modal.
   */
  function openModal({ title, body, footer, onClose, wide }) {
    const root = document.getElementById("modal-root");
    if (!root) throw new Error("Modal root element (#modal-root) is missing from the page.");

    if (activeCloseHandler) activeCloseHandler();

    const lastFocusedElement = document.activeElement;
    clearElement(root);

    function onKeyDown(event) {
      if (event.key === "Escape") close();
    }

    function close() {
      clearElement(root);
      document.removeEventListener("keydown", onKeyDown);
      activeCloseHandler = null;
      if (lastFocusedElement instanceof HTMLElement) lastFocusedElement.focus();
      onClose?.();
    }
    activeCloseHandler = close;

    document.addEventListener("keydown", onKeyDown);

    const dialog = h(
      "div",
      { class: wide ? "modal modal--wide" : "modal", role: "dialog", "aria-modal": "true", "aria-label": title },
      [
        h("div", { class: "modal__header" }, [
          h("h2", {}, title),
          h("button", { class: "btn-icon", type: "button", "aria-label": "Fermer" }, "✕"),
        ]),
        h("div", { class: "modal__body" }, body),
        footer ? h("div", { class: "modal__footer" }, footer) : null,
      ].filter(Boolean),
    );
    dialog.querySelector(".btn-icon").addEventListener("click", close);

    const overlay = h("div", { class: "modal-overlay" }, dialog);
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) close();
    });

    root.append(overlay);
    const firstField = dialog.querySelector("input, select, textarea");
    (firstField ?? dialog.querySelector(".btn-icon"))?.focus();

    return close;
  }

  /**
   * Close whichever modal is currently open, if any.
   * @returns {void}
   */
  function closeModal() {
    activeCloseHandler?.();
  }

  App.modal = { openModal, closeModal };
})();

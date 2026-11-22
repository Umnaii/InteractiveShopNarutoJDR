/**
 * Minimal DOM-building helpers shared by components and views.
 * Kept deliberately tiny: no virtual DOM, no diffing — views rebuild their
 * subtree on each render and rely on this to stay terse and readable.
 * Plain script: attaches its API to the shared App namespace as App.dom.
 */

(function () {
  "use strict";
  window.App = window.App || {};

  const BOOLEAN_PROPS = new Set(["checked", "disabled", "selected", "value", "id"]);

  /**
   * Create a DOM element.
   * @param {string} tag - Tag name, e.g. "div", "button".
   * @param {Object<string, *>} [attrs] - Attributes/properties. Keys starting with "on"
   *   and a function value are wired as event listeners (e.g. onClick -> "click").
   *   "class" sets className. checked/disabled/selected/value/id are set as IDL
   *   properties for correctness; everything else is set via setAttribute.
   * @param {*|Array<*>} [children] - A child (Node or string) or array of children. Falsy entries are skipped.
   * @returns {HTMLElement}
   */
  function h(tag, attrs, children) {
    attrs = attrs || {};
    children = children === undefined ? [] : children;
    const element = document.createElement(tag);

    for (const [key, value] of Object.entries(attrs)) {
      if (value === undefined || value === null) continue;

      if (key === "class") {
        element.className = value;
        continue;
      }
      if (key.startsWith("on") && typeof value === "function") {
        element.addEventListener(key.slice(2).toLowerCase(), value);
        continue;
      }
      if (BOOLEAN_PROPS.has(key)) {
        element[key] = value;
        continue;
      }
      if (value === false) continue;
      if (value === true) {
        element.setAttribute(key, "");
        continue;
      }
      element.setAttribute(key, value);
    }

    for (const child of [].concat(children)) {
      if (child === undefined || child === null || child === false) continue;
      element.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }

    return element;
  }

  /**
   * Remove all children from a DOM node.
   * @param {HTMLElement} node
   * @returns {void}
   */
  function clearElement(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  /**
   * Run a view's render function without losing the page's scroll position.
   * Views rebuild by clearing their container first; for that instant the page is
   * nearly empty, so the browser clamps the scroll to the top and never scrolls back.
   * Restoring synchronously, before the next paint, means no visible jump.
   * Use it for re-renders triggered by state changes (buy, consume, resell...), not
   * for navigating to a new route, where starting at the top is expected.
   * @param {() => void} render
   * @returns {void}
   */
  function rerenderKeepingScroll(render) {
    const { scrollX, scrollY } = window;
    render();
    window.scrollTo(scrollX, scrollY);
  }

  /**
   * Like rerenderKeepingScroll, and also puts the keyboard focus (and text cursor) back on
   * the "same" control after the rebuild. A control is recognized by its `data-focus-key`
   * attribute, so give one to every input/button that can be focused while the view
   * re-renders (e.g. the character sheet's fields and +/- buttons).
   * @param {HTMLElement} container - The subtree being rebuilt.
   * @param {() => void} render
   * @returns {void}
   */
  function rerenderKeepingFocus(container, render) {
    const active = document.activeElement;
    const key = active instanceof HTMLElement && container.contains(active) ? active.dataset.focusKey : null;
    let selection = null;
    if (key && typeof active.selectionStart === "number") {
      selection = [active.selectionStart, active.selectionEnd];
    }

    rerenderKeepingScroll(render);

    if (!key) return;
    const target = Array.from(container.querySelectorAll("[data-focus-key]")).find((element) => element.dataset.focusKey === key);
    if (!target) return;
    target.focus({ preventScroll: true });
    if (selection) {
      try {
        target.setSelectionRange(selection[0], selection[1]);
      } catch (error) {
        // Some input types (number, checkbox...) have no text selection: nothing to restore.
      }
    }
  }

  App.dom = { h, clearElement, rerenderKeepingScroll, rerenderKeepingFocus };
})();

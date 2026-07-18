/**
 * Minimal hash-based router. Views register a path pattern (e.g. "/item/:id")
 * and a handler that renders into the app's view container; the handler may
 * return a cleanup function, called automatically before the next navigation.
 * Plain script: attaches its API to the shared App namespace as App.router.
 * No dependencies on other App.* modules.
 */

(function () {
  "use strict";
  window.App = window.App || {};

  const routes = [];
  let notFoundPath = "/shop";
  let currentCleanup = null;

  /**
   * Compile a path pattern like "/item/:id" into a matching regex and its param names.
   * @param {string} pattern
   * @returns {{regex: RegExp, keys: string[]}}
   */
  function compilePattern(pattern) {
    const keys = [];
    const regexSource = pattern
      .split("/")
      .map((segment) => {
        if (segment.startsWith(":")) {
          keys.push(segment.slice(1));
          return "([^/]+)";
        }
        return segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      })
      .join("/");
    return { regex: new RegExp(`^${regexSource}$`), keys };
  }

  /**
   * Register a route.
   * @param {string} pattern - e.g. "/shop" or "/item/:id".
   * @param {(params: Record<string, string>) => (void|(() => void))} handler
   * @returns {void}
   */
  function registerRoute(pattern, handler) {
    const { regex, keys } = compilePattern(pattern);
    routes.push({ pattern, handler, regex, keys });
  }

  /**
   * Set the fallback path used when the current hash matches no route.
   * @param {string} path
   * @returns {void}
   */
  function setNotFoundPath(path) {
    notFoundPath = path;
  }

  /**
   * Navigate to a path by updating the URL hash (triggers "hashchange").
   * @param {string} path
   * @returns {void}
   */
  function navigate(path) {
    window.location.hash = `#${path}`;
  }

  /**
   * Highlight the nav link whose path matches the current top-level route segment.
   * @param {string} path
   * @returns {void}
   */
  function updateActiveNavLink(path) {
    const topSegment = `/${path.split("/")[1] ?? ""}`;
    document.querySelectorAll(".app-nav__link").forEach((link) => {
      const linkPath = link.getAttribute("href")?.replace(/^#/, "") ?? "";
      if (linkPath === topSegment) {
        link.setAttribute("aria-current", "page");
      } else {
        link.removeAttribute("aria-current");
      }
    });
  }

  /**
   * Resolve and render whatever route matches the current URL hash.
   * @returns {void}
   */
  function resolveRoute() {
    const path = window.location.hash.replace(/^#/, "") || notFoundPath;

    for (const route of routes) {
      const match = path.match(route.regex);
      if (!match) continue;

      const params = {};
      route.keys.forEach((key, index) => {
        params[key] = decodeURIComponent(match[index + 1]);
      });

      if (typeof currentCleanup === "function") currentCleanup();
      currentCleanup = route.handler(params) || null;
      updateActiveNavLink(path);
      return;
    }

    navigate(notFoundPath);
  }

  /**
   * Start the router: resolve the current hash and listen for future changes.
   * @returns {void}
   */
  function initRouter() {
    window.addEventListener("hashchange", resolveRoute);
    resolveRoute();
  }

  App.router = { registerRoute, setNotFoundPath, navigate, initRouter };
})();

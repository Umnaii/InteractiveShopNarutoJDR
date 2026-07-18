/**
 * Ryo formatting, star rendering helpers and small French label lookups.
 * Pure, side-effect-free formatting functions only.
 * Plain script: attaches its API to the shared App namespace as App.format.
 * Depends on App.items (must be loaded first).
 */

(function () {
  "use strict";
  window.App = window.App || {};

  const { CATEGORY_LABELS } = App.items;

  const TYPE_LABELS = {
    consommable: "Consommable",
    permanent: "Permanent",
    restreint: "Restreint (conteur)",
    intrigue: "Objet d'intrigue",
  };

  const TRANSACTION_KIND_LABELS = {
    purchase: "Achat",
    resale: "Revente",
    mission: "Mission",
    adjustment: "Ajustement",
    undo: "Annulation",
  };

  const RANK_LABELS = ["Genin", "Chûnin", "Jônin"];

  /**
   * Format a Ryo amount with French thousands separators, e.g. 12000 -> "12 000 Ryo".
   * @param {number} amount
   * @returns {string}
   */
  function formatRyo(amount) {
    const value = Number.isFinite(amount) ? amount : 0;
    const sign = value < 0 ? "−" : "";
    return `${sign}${Math.abs(value).toLocaleString("fr-FR")} Ryo`;
  }

  /**
   * Format a signed Ryo delta for transaction history, e.g. +1 200 Ryo / −500 Ryo.
   * @param {number} amount
   * @returns {string}
   */
  function formatSignedRyo(amount) {
    const value = Number.isFinite(amount) ? amount : 0;
    const sign = value > 0 ? "+" : value < 0 ? "−" : "";
    return `${sign}${Math.abs(value).toLocaleString("fr-FR")} Ryo`;
  }

  /**
   * Build the plain-text star glyph string for a rarity, e.g. rarity 3 -> "★★★☆☆".
   * @param {number} rarity - Integer 1..5.
   * @param {number} [max]
   * @returns {string}
   */
  function starGlyphs(rarity, max) {
    max = max === undefined ? 5 : max;
    const filled = Math.max(0, Math.min(max, Math.round(rarity)));
    return "★".repeat(filled) + "☆".repeat(max - filled);
  }

  /**
   * French label for a category letter (A..J).
   * @param {string} category
   * @returns {string}
   */
  function categoryLabel(category) {
    return CATEGORY_LABELS[category] ?? category;
  }

  /**
   * French label for an item type.
   * @param {"consommable"|"permanent"|"restreint"|"intrigue"} type
   * @returns {string}
   */
  function typeLabel(type) {
    return TYPE_LABELS[type] ?? type;
  }

  /**
   * French label for a transaction kind.
   * @param {"purchase"|"resale"|"mission"|"adjustment"|"undo"} kind
   * @returns {string}
   */
  function transactionKindLabel(kind) {
    return TRANSACTION_KIND_LABELS[kind] ?? kind;
  }

  /**
   * Escape a single value for inclusion as one CSV field: wraps it in quotes (doubling
   * any inner quotes) whenever it contains a comma, quote or newline. Shared by every
   * CSV export in the app (transaction history, mission journal, ...).
   * @param {*} value
   * @returns {string}
   */
  function csvEscape(value) {
    const text = String(value ?? "");
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  /** @returns {string[]} The three playable ranks, in ascending order. */
  function getRankOptions() {
    return RANK_LABELS;
  }

  /**
   * Format a timestamp (ms since epoch) as a French date/time string.
   * @param {number} timestamp
   * @returns {string}
   */
  function formatDateTime(timestamp) {
    try {
      return new Date(timestamp).toLocaleString("fr-FR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch (error) {
      return "";
    }
  }

  App.format = {
    formatRyo,
    formatSignedRyo,
    starGlyphs,
    categoryLabel,
    typeLabel,
    transactionKindLabel,
    getRankOptions,
    formatDateTime,
  };
})();

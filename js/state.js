/**
 * In-memory application state and change notifications.
 * The single source of truth at runtime; every mutation goes through the setters
 * here, which persist to storage.js and notify subscribers. Views must never call
 * storage.js directly — they read via the getters below and mutate via profiles.js /
 * economy.js, which in turn call the setters here.
 * Plain script: attaches its API to the shared App namespace as App.state.
 * Depends on App.storage (must be loaded first).
 */

(function () {
  "use strict";
  window.App = window.App || {};

  const { loadAppState, saveProfiles, saveActiveProfileId, saveSettings, saveMissionLog, resetAllData, getDefaultAppState } = App.storage;

  /** @type {{profiles: Array, activeProfileId: string|null, settings: {gmMode: boolean, showHorsCommerce: boolean}, missionLog: Array}} */
  let state = getDefaultAppState();

  /**
   * The shop cart ("panier"). Deliberately session-only, not persisted to localStorage:
   * it is a staging area for a purchase in progress, not durable data worth keeping
   * around across page reloads.
   * @type {{itemId: string, quantity: number}[]}
   */
  let cart = [];

  /** @type {Set<(state: object) => void>} */
  const listeners = new Set();

  function notify() {
    for (const listener of listeners) listener(state);
  }

  /**
   * Load persisted data into memory. Call once at boot, before any view renders.
   * @returns {void}
   */
  function initState() {
    state = loadAppState();
    notify();
  }

  /**
   * Subscribe to any state change. Returns an unsubscribe function.
   * @param {(state: object) => void} listener
   * @returns {() => void}
   */
  function subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  /** @returns {object} The full current state (read-only by convention). */
  function getState() {
    return state;
  }

  /** @returns {Array} All profiles. */
  function getProfiles() {
    return state.profiles;
  }

  /** @returns {string|null} The active profile id, or null if none is selected. */
  function getActiveProfileId() {
    return state.activeProfileId;
  }

  /** @returns {object|null} The active profile, or null if none is selected/exists. */
  function getActiveProfile() {
    return state.profiles.find((profile) => profile.id === state.activeProfileId) ?? null;
  }

  /** @returns {{gmMode: boolean, showHorsCommerce: boolean}} Current UI settings. */
  function getSettings() {
    return state.settings;
  }

  /** @returns {Array} The GM-only mission journal, newest first. */
  function getMissionLog() {
    return state.missionLog;
  }

  /**
   * Replace the profiles array, persist it, and notify subscribers.
   * @param {Array} profiles
   * @returns {void}
   */
  function setProfiles(profiles) {
    state = { ...state, profiles };
    saveProfiles(profiles);
    notify();
  }

  /**
   * Set the active profile id, persist it, and notify subscribers.
   * @param {string|null} profileId
   * @returns {void}
   */
  function setActiveProfileId(profileId) {
    state = { ...state, activeProfileId: profileId };
    saveActiveProfileId(profileId);
    notify();
  }

  /**
   * Merge and persist UI settings, then notify subscribers.
   * @param {Partial<{gmMode: boolean, showHorsCommerce: boolean}>} partialSettings
   * @returns {void}
   */
  function setSettings(partialSettings) {
    state = { ...state, settings: { ...state.settings, ...partialSettings } };
    saveSettings(state.settings);
    notify();
  }

  /**
   * Replace the mission journal, persist it, and notify subscribers.
   * @param {Array} missionLog
   * @returns {void}
   */
  function setMissionLog(missionLog) {
    state = { ...state, missionLog };
    saveMissionLog(missionLog);
    notify();
  }

  /**
   * Wipe all persisted data and reset in-memory state to a clean slate.
   * @returns {void}
   */
  function resetState() {
    resetAllData();
    state = getDefaultAppState();
    cart = [];
    notify();
  }

  /** @returns {{itemId: string, quantity: number}[]} Current cart contents (session-only). */
  function getCart() {
    return cart;
  }

  /**
   * Add a quantity of an item to the cart, merging with any existing line for that item.
   * @param {string} itemId
   * @param {number} quantity
   * @returns {void}
   */
  function addToCart(itemId, quantity) {
    const qty = Math.max(1, Math.floor(quantity));
    const existing = cart.find((line) => line.itemId === itemId);
    cart = existing
      ? cart.map((line) => (line.itemId === itemId ? { ...line, quantity: line.quantity + qty } : line))
      : [...cart, { itemId, quantity: qty }];
    notify();
  }

  /**
   * Set a cart line's quantity directly (e.g. typed into a quantity field). A quantity
   * of 0 or less removes the line.
   * @param {string} itemId
   * @param {number} quantity
   * @returns {void}
   */
  function setCartQuantity(itemId, quantity) {
    const qty = Math.floor(quantity);
    cart = qty > 0
      ? cart.map((line) => (line.itemId === itemId ? { ...line, quantity: qty } : line))
      : cart.filter((line) => line.itemId !== itemId);
    notify();
  }

  /**
   * Remove one item's line from the cart entirely.
   * @param {string} itemId
   * @returns {void}
   */
  function removeFromCart(itemId) {
    cart = cart.filter((line) => line.itemId !== itemId);
    notify();
  }

  /** Empty the cart. @returns {void} */
  function clearCart() {
    cart = [];
    notify();
  }

  App.state = {
    initState,
    subscribe,
    getState,
    getProfiles,
    getActiveProfileId,
    getActiveProfile,
    getSettings,
    getMissionLog,
    setProfiles,
    setActiveProfileId,
    setSettings,
    setMissionLog,
    resetState,
    getCart,
    addToCart,
    setCartQuantity,
    removeFromCart,
    clearCart,
  };
})();

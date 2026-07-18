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

  const { loadAppState, saveProfiles, saveActiveProfileId, saveSettings, resetAllData, getDefaultAppState } = App.storage;

  /** @type {{profiles: Array, activeProfileId: string|null, settings: {gmMode: boolean, showHorsCommerce: boolean}}} */
  let state = getDefaultAppState();

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
   * Wipe all persisted data and reset in-memory state to a clean slate.
   * @returns {void}
   */
  function resetState() {
    resetAllData();
    state = getDefaultAppState();
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
    setProfiles,
    setActiveProfileId,
    setSettings,
    resetState,
  };
})();

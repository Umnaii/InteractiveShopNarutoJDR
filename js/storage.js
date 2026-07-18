/**
 * localStorage persistence: read/write, key naming, schema versioning and migrations.
 * This is the ONLY module allowed to call localStorage directly. state.js is the only
 * module allowed to call this one.
 * Plain script: attaches its API to the shared App namespace as App.storage.
 */

(function () {
  "use strict";
  window.App = window.App || {};

  const STORAGE_PREFIX = "shinobi-shop";
  const SCHEMA_VERSION = 1;

  const KEYS = {
    schemaVersion: `${STORAGE_PREFIX}:schema-version`,
    profiles: `${STORAGE_PREFIX}:v${SCHEMA_VERSION}:profiles`,
    activeProfileId: `${STORAGE_PREFIX}:v${SCHEMA_VERSION}:active-profile-id`,
    settings: `${STORAGE_PREFIX}:v${SCHEMA_VERSION}:settings`,
    missionLog: `${STORAGE_PREFIX}:v${SCHEMA_VERSION}:mission-log`,
  };

  /**
   * Build the default, empty-but-valid application state.
   * Used whenever localStorage is empty, corrupted, or missing keys.
   * @returns {{profiles: Array, activeProfileId: string|null, settings: {gmMode: boolean, showHorsCommerce: boolean}, missionLog: Array}}
   */
  function getDefaultAppState() {
    return {
      profiles: [],
      activeProfileId: null,
      settings: { gmMode: false, showHorsCommerce: false },
      missionLog: [],
    };
  }

  /**
   * Read and JSON-parse a localStorage key, falling back cleanly on any error
   * (missing key, corrupted JSON, storage unavailable).
   * @param {string} key
   * @param {*} fallback
   * @returns {*}
   */
  function readJSON(key, fallback) {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw === null) return fallback;
      return JSON.parse(raw);
    } catch (error) {
      console.warn(`[storage] Failed to read "${key}", using fallback.`, error);
      return fallback;
    }
  }

  /**
   * JSON-stringify and write a value to localStorage. Failures (e.g. quota exceeded,
   * storage disabled) are logged but never thrown, so the app keeps working in memory.
   * @param {string} key
   * @param {*} value
   * @returns {void}
   */
  function writeJSON(key, value) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      console.warn(`[storage] Failed to write "${key}".`, error);
    }
  }

  /**
   * Run any schema migrations needed to bring stored data up to SCHEMA_VERSION.
   * There is only one schema version so far; this exists so future migrations have
   * a single, well-known place to live instead of being scattered across the app.
   * @returns {void}
   */
  function ensureSchemaVersion() {
    const storedVersion = Number(window.localStorage.getItem(KEYS.schemaVersion) || 0);
    if (storedVersion < SCHEMA_VERSION) {
      // No migrations exist yet between versions; just stamp the current version.
      try {
        window.localStorage.setItem(KEYS.schemaVersion, String(SCHEMA_VERSION));
      } catch (error) {
        console.warn("[storage] Failed to stamp schema version.", error);
      }
    }
  }

  /**
   * Load the full application state from localStorage, applying migrations and
   * falling back to a clean default state for any piece that is missing or corrupted.
   * @returns {{profiles: Array, activeProfileId: string|null, settings: {gmMode: boolean, showHorsCommerce: boolean}, missionLog: Array}}
   */
  function loadAppState() {
    ensureSchemaVersion();
    const defaults = getDefaultAppState();

    const profiles = readJSON(KEYS.profiles, defaults.profiles);
    const activeProfileId = readJSON(KEYS.activeProfileId, defaults.activeProfileId);
    const storedSettings = readJSON(KEYS.settings, defaults.settings);
    const missionLog = readJSON(KEYS.missionLog, defaults.missionLog);

    return {
      profiles: Array.isArray(profiles) ? profiles : defaults.profiles,
      activeProfileId: typeof activeProfileId === "string" ? activeProfileId : defaults.activeProfileId,
      settings: {
        gmMode: Boolean(storedSettings?.gmMode),
        showHorsCommerce: Boolean(storedSettings?.showHorsCommerce),
      },
      missionLog: Array.isArray(missionLog) ? missionLog : defaults.missionLog,
    };
  }

  /**
   * Persist the profiles array.
   * @param {Array} profiles
   * @returns {void}
   */
  function saveProfiles(profiles) {
    writeJSON(KEYS.profiles, profiles);
  }

  /**
   * Persist the active profile id.
   * @param {string|null} profileId
   * @returns {void}
   */
  function saveActiveProfileId(profileId) {
    writeJSON(KEYS.activeProfileId, profileId);
  }

  /**
   * Persist app-wide UI settings (GM mode, hors-commerce visibility, ...).
   * @param {{gmMode: boolean, showHorsCommerce: boolean}} settings
   * @returns {void}
   */
  function saveSettings(settings) {
    writeJSON(KEYS.settings, settings);
  }

  /**
   * Persist the GM-only mission journal (see App.economy.creditMissionPayout).
   * @param {Array} missionLog
   * @returns {void}
   */
  function saveMissionLog(missionLog) {
    writeJSON(KEYS.missionLog, missionLog);
  }

  /**
   * Erase all Boutique Shinobi data from localStorage, restoring a clean slate.
   * @returns {void}
   */
  function resetAllData() {
    try {
      window.localStorage.removeItem(KEYS.profiles);
      window.localStorage.removeItem(KEYS.activeProfileId);
      window.localStorage.removeItem(KEYS.settings);
      window.localStorage.removeItem(KEYS.missionLog);
      window.localStorage.removeItem(KEYS.schemaVersion);
    } catch (error) {
      console.warn("[storage] Failed to reset data.", error);
    }
  }

  App.storage = {
    getDefaultAppState,
    loadAppState,
    saveProfiles,
    saveActiveProfileId,
    saveSettings,
    saveMissionLog,
    resetAllData,
  };
})();

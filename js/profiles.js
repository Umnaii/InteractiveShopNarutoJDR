/**
 * Profile CRUD and the active-profile concept, plus export/import of a single
 * profile as a portable JSON file (for moving a character between devices).
 * Mutates state via state.js only.
 * Plain script: attaches its API to the shared App namespace as App.profiles.
 * Depends on App.state, App.format (must be loaded first).
 *
 * @typedef {Object} InventoryEntry
 * @property {string} itemId
 * @property {number} quantity
 */

/**
 * @typedef {Object} Transaction
 * @property {string} id
 * @property {number} timestamp
 * @property {"purchase"|"resale"|"mission"|"adjustment"} kind
 * @property {number} amount - Signed Ryo delta.
 * @property {string} reason
 */

/**
 * @typedef {Object} Profile
 * @property {string} id
 * @property {string} name
 * @property {"Genin"|"Chûnin"|"Jônin"} rank
 * @property {number} balance
 * @property {InventoryEntry[]} inventory
 * @property {Transaction[]} history
 */

(function () {
  "use strict";
  window.App = window.App || {};

  const { getProfiles, setProfiles, getActiveProfileId, setActiveProfileId } = App.state;
  const { getRankOptions } = App.format;

  /** Schema version for the standalone profile export file format (independent of the localStorage schema). */
  const PROFILE_EXPORT_VERSION = 1;

  /**
   * Generate a reasonably unique id, prefixed for readability in storage/debugging.
   * @param {string} prefix
   * @returns {string}
   */
  function generateId(prefix) {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return `${prefix}-${crypto.randomUUID()}`;
    }
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  /**
   * Look up a profile by id.
   * @param {string} profileId
   * @returns {Profile|null}
   */
  function getProfileById(profileId) {
    return getProfiles().find((profile) => profile.id === profileId) ?? null;
  }

  /**
   * Create a new character profile and make it active if it's the first one.
   * @param {string} name
   * @param {"Genin"|"Chûnin"|"Jônin"} rank
   * @returns {{ok: boolean, profile?: Profile, message?: string}}
   */
  function createProfile(name, rank) {
    const trimmed = (name ?? "").trim();
    if (!trimmed) {
      return { ok: false, message: "Le nom du profil ne peut pas être vide." };
    }

    /** @type {Profile} */
    const profile = {
      id: generateId("profile"),
      name: trimmed,
      rank,
      balance: 0,
      inventory: [],
      history: [],
    };

    setProfiles([...getProfiles(), profile]);
    if (!getActiveProfileId()) {
      setActiveProfileId(profile.id);
    }
    return { ok: true, profile };
  }

  /**
   * Rename a profile.
   * @param {string} profileId
   * @param {string} newName
   * @returns {{ok: boolean, message?: string}}
   */
  function renameProfile(profileId, newName) {
    const trimmed = (newName ?? "").trim();
    if (!trimmed) {
      return { ok: false, message: "Le nom du profil ne peut pas être vide." };
    }
    const profiles = getProfiles();
    const exists = profiles.some((profile) => profile.id === profileId);
    if (!exists) {
      return { ok: false, message: "Profil introuvable." };
    }
    setProfiles(profiles.map((profile) => (profile.id === profileId ? { ...profile, name: trimmed } : profile)));
    return { ok: true };
  }

  /**
   * Change a profile's rank.
   * @param {string} profileId
   * @param {"Genin"|"Chûnin"|"Jônin"} rank
   * @returns {{ok: boolean, message?: string}}
   */
  function setProfileRank(profileId, rank) {
    const profiles = getProfiles();
    const exists = profiles.some((profile) => profile.id === profileId);
    if (!exists) {
      return { ok: false, message: "Profil introuvable." };
    }
    setProfiles(profiles.map((profile) => (profile.id === profileId ? { ...profile, rank } : profile)));
    return { ok: true };
  }

  /**
   * Duplicate a profile (balance, inventory and history included), appending "(copie)" to its name.
   * @param {string} profileId
   * @returns {{ok: boolean, profile?: Profile, message?: string}}
   */
  function duplicateProfile(profileId) {
    const original = getProfileById(profileId);
    if (!original) {
      return { ok: false, message: "Profil introuvable." };
    }

    /** @type {Profile} */
    const copy = {
      ...original,
      id: generateId("profile"),
      name: `${original.name} (copie)`,
      inventory: original.inventory.map((entry) => ({ ...entry })),
      history: original.history.map((entry) => ({ ...entry })),
    };

    setProfiles([...getProfiles(), copy]);
    return { ok: true, profile: copy };
  }

  /**
   * Delete a profile. If it was the active profile, activates another one (or null).
   * Callers are responsible for confirming this destructive action with the user first.
   * @param {string} profileId
   * @returns {{ok: boolean, message?: string}}
   */
  function deleteProfile(profileId) {
    const profiles = getProfiles();
    const remaining = profiles.filter((profile) => profile.id !== profileId);
    if (remaining.length === profiles.length) {
      return { ok: false, message: "Profil introuvable." };
    }
    setProfiles(remaining);
    if (getActiveProfileId() === profileId) {
      setActiveProfileId(remaining[0]?.id ?? null);
    }
    return { ok: true };
  }

  /**
   * Set the active profile. No-op (with an error) if the id does not exist.
   * @param {string} profileId
   * @returns {{ok: boolean, message?: string}}
   */
  function setActiveProfile(profileId) {
    if (!getProfileById(profileId)) {
      return { ok: false, message: "Profil introuvable." };
    }
    setActiveProfileId(profileId);
    return { ok: true };
  }

  /**
   * Build a portable, JSON-serializable export of one profile (for download-and-transfer
   * to another device). Wrapped in a small envelope so the file format can evolve
   * independently of the app's localStorage schema.
   * @param {string} profileId
   * @returns {{app: string, exportVersion: number, exportedAt: number, profile: Profile}|null}
   */
  function exportProfile(profileId) {
    const profile = getProfileById(profileId);
    if (!profile) return null;
    return {
      app: "boutique-shinobi",
      exportVersion: PROFILE_EXPORT_VERSION,
      exportedAt: Date.now(),
      profile,
    };
  }

  /**
   * Parse and sanitize a profile export file's contents. Never throws: corrupted,
   * hand-edited, or unrelated JSON degrades to a clear error rather than crashing
   * the import. Accepts either the full export envelope or a bare profile object.
   * @param {string} jsonText
   * @returns {{ok: true, profile: Profile}|{ok: false, message: string}}
   */
  function parseProfileExport(jsonText) {
    let data;
    try {
      data = JSON.parse(jsonText);
    } catch (error) {
      return { ok: false, message: "Ce fichier n'est pas un JSON valide." };
    }

    const raw = data && typeof data === "object" && !Array.isArray(data) && data.profile && typeof data.profile === "object"
      ? data.profile
      : data;

    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return { ok: false, message: "Ce fichier ne contient pas de profil valide." };
    }

    const rankOptions = getRankOptions();
    const id = typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : generateId("profile");
    const name = typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : "Profil importé";
    const rank = rankOptions.includes(raw.rank) ? raw.rank : rankOptions[0];
    const balance = Number.isFinite(raw.balance) ? Math.max(0, Math.round(raw.balance)) : 0;

    const inventory = Array.isArray(raw.inventory)
      ? raw.inventory
          .filter((entry) => entry && typeof entry.itemId === "string" && Number.isFinite(entry.quantity) && entry.quantity > 0)
          .map((entry) => ({ itemId: entry.itemId, quantity: Math.floor(entry.quantity) }))
      : [];

    const validKinds = ["purchase", "resale", "mission", "adjustment"];
    const history = Array.isArray(raw.history)
      ? raw.history
          .filter((entry) => entry && typeof entry === "object")
          .map((entry) => ({
            id: typeof entry.id === "string" && entry.id ? entry.id : generateId("txn"),
            timestamp: Number.isFinite(entry.timestamp) ? entry.timestamp : Date.now(),
            kind: validKinds.includes(entry.kind) ? entry.kind : "adjustment",
            amount: Number.isFinite(entry.amount) ? Math.round(entry.amount) : 0,
            reason: typeof entry.reason === "string" ? entry.reason : "",
          }))
      : [];

    return { ok: true, profile: { id, name, rank, balance, inventory, history } };
  }

  /**
   * Import an already-parsed profile (see parseProfileExport) into the local profile list.
   * If a profile with the same id already exists and no strategy is given, the import is
   * refused with `conflict: true` so the caller can ask the user how to proceed, then
   * retry with an explicit strategy.
   * @param {Profile} importedProfile
   * @param {"replace"|"duplicate"} [strategy] - Only consulted when the id already exists.
   * @returns {{ok: boolean, profile?: Profile, conflict?: boolean, message?: string}}
   */
  function importProfile(importedProfile, strategy) {
    const existing = getProfileById(importedProfile.id);

    if (existing && !strategy) {
      return { ok: false, conflict: true, message: `Un profil « ${existing.name} » existe déjà sur cet appareil avec le même identifiant.` };
    }

    if (existing && strategy === "replace") {
      setProfiles(getProfiles().map((profile) => (profile.id === importedProfile.id ? importedProfile : profile)));
      return { ok: true, profile: importedProfile };
    }

    const profileToAdd = existing && strategy === "duplicate" ? { ...importedProfile, id: generateId("profile") } : importedProfile;

    setProfiles([...getProfiles(), profileToAdd]);
    if (!getActiveProfileId()) {
      setActiveProfileId(profileToAdd.id);
    }
    return { ok: true, profile: profileToAdd };
  }

  App.profiles = {
    getProfileById,
    createProfile,
    renameProfile,
    setProfileRank,
    duplicateProfile,
    deleteProfile,
    setActiveProfile,
    exportProfile,
    parseProfileExport,
    importProfile,
  };
})();

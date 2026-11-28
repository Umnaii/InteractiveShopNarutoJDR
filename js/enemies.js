/**
 * The GM's enemies (PNJ, rules p. 108-109): "seconds couteaux" and groups of figurants,
 * kept deliberately simple: a name, a dice pool, automatic successes and énergie vitale.
 * The "Valeur d'un PNJ" table (App.ninjaRules.NPC_TIERS) only pre-fills suggestions; the
 * GM can set any value afterwards. Enemies can be filed in named groups (folders), and a
 * group can be exported to / imported from a .json file in one go.
 * The only module that changes App.state's enemies and enemy groups.
 *
 * Plain script: attaches its API to the shared App namespace as App.enemies.
 * Depends on App.ninjaRules, App.sheetCalc, App.state.
 */

(function () {
  "use strict";
  window.App = window.App || {};

  const R = App.ninjaRules;
  const C = App.sheetCalc;
  const { getEnemies: getRawEnemies, getEnemyGroups: getRawGroups, setEnemies, setEnemyData } = App.state;

  /** Marks a file made by exportGroup(), so importGroup() can refuse anything else. */
  const EXPORT_FORMAT = "shinobi-enemy-group";
  const EXPORT_VERSION = 1;

  const NAME_MAX_LENGTH = 60;
  const DICE_MAX = 99;
  const AUTO_MIN = -20;
  const AUTO_MAX = 99;
  const VITALITY_MAX = 999;
  const KIND_KEYS = R.NPC_KINDS.map((kind) => kind.key);

  // --- Helpers ---

  function clampInt(value, min, max, fallback) {
    const number = Math.round(Number(value));
    if (!Number.isFinite(number)) return fallback;
    return Math.min(max, Math.max(min, number));
  }

  function generateEnemyId() {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return `enemy-${crypto.randomUUID()}`;
    return `enemy-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  /** @returns {object|null} A row of the "Valeur d'un PNJ" table. */
  function tierDef(key) {
    return R.NPC_TIERS.find((tier) => tier.key === key) ?? null;
  }

  /** Middle of a range of the table, rounded ("25 ou +" gives 25). */
  function middleOf(range) {
    return range.max === null ? range.min : Math.round((range.min + range.max) / 2);
  }

  /** "3 à 8", "25 ou +". */
  function rangeLabel(range) {
    return range.max === null ? `${range.min} ou +` : `${range.min} à ${range.max}`;
  }

  /**
   * Starting values for a new enemy.
   * @param {"second"|"figurants"} kind
   * @param {string} tierKey - a NPC_TIERS key (seconds couteaux), ignored for figurants
   * @param {number} [count] - figurants in the group
   * @returns {{dice: number, auto: number, vitality: number}}
   */
  function suggestedValues(kind, tierKey, count) {
    if (kind === "figurants") {
      const size = clampInt(count, 1, VITALITY_MAX, R.FIGURANTS_DEFAULT_COUNT);
      return { dice: Math.min(size, DICE_MAX), auto: 0, vitality: size };
    }
    const tier = tierDef(tierKey) ?? R.NPC_TIERS[0];
    return { dice: middleOf(tier.dice), auto: middleOf(tier.auto), vitality: R.GRADE_RULES[tier.grade].vitality };
  }

  /**
   * Sanitize one stored enemy (idempotent). `groupId` is kept as is here; getEnemies()
   * drops it when the group no longer exists.
   * @param {*} raw
   * @returns {object|null}
   */
  function normalizeEnemy(raw) {
    if (!raw || typeof raw !== "object") return null;
    const kind = KIND_KEYS.includes(raw.kind) ? raw.kind : "second";
    const max = clampInt(raw.vitality?.max, 1, VITALITY_MAX, 5);
    return {
      id: typeof raw.id === "string" && raw.id ? raw.id : generateEnemyId(),
      name: typeof raw.name === "string" ? raw.name.slice(0, NAME_MAX_LENGTH) : "",
      kind,
      tier: kind === "second" && tierDef(raw.tier) ? raw.tier : "",
      dice: clampInt(raw.dice, 0, DICE_MAX, 0),
      auto: clampInt(raw.auto, AUTO_MIN, AUTO_MAX, 0),
      vitality: { current: clampInt(raw.vitality?.current, 0, max, max), max },
      groupId: typeof raw.groupId === "string" ? raw.groupId : "",
    };
  }

  /**
   * Sanitize one stored group (idempotent).
   * @param {*} raw
   * @returns {{id: string, name: string}|null}
   */
  function normalizeGroup(raw) {
    if (!raw || typeof raw !== "object") return null;
    return {
      id: typeof raw.id === "string" && raw.id ? raw.id : generateEnemyId().replace("enemy-", "group-"),
      name: typeof raw.name === "string" && raw.name.trim() ? raw.name.trim().slice(0, NAME_MAX_LENGTH) : "Groupe sans nom",
    };
  }

  /** @returns {{id: string, name: string}[]} Every enemy group, in creation order. */
  function getGroups() {
    const seen = new Set();
    return getRawGroups()
      .map(normalizeGroup)
      .filter((group) => group && !seen.has(group.id) && seen.add(group.id));
  }

  /** @returns {object[]} Every enemy, sanitized, newest first. `groupId` is "" when not filed. */
  function getEnemies() {
    const groupIds = new Set(getGroups().map((group) => group.id));
    return getRawEnemies()
      .map(normalizeEnemy)
      .filter(Boolean)
      .map((enemy) => (enemy.groupId && !groupIds.has(enemy.groupId) ? { ...enemy, groupId: "" } : enemy));
  }

  function updateList(mutate) {
    const list = getEnemies();
    const result = mutate(list) ?? { ok: true };
    if (result.ok) setEnemies(list);
    return result;
  }

  /** "Name", or "Name (2)", "Name (3)"... so it differs from every name in `taken`. */
  function uniqueName(name, taken) {
    const base = name.replace(/\s\(\d+\)$/, "");
    if (!taken.includes(name)) return name;
    let number = 2;
    while (taken.includes(`${base} (${number})`)) number += 1;
    return `${base} (${number})`;
  }

  function updateOne(enemyId, change) {
    return updateList((list) => {
      const index = list.findIndex((enemy) => enemy.id === enemyId);
      if (index === -1) return { ok: false, message: "Ennemi introuvable." };
      list[index] = normalizeEnemy(change({ ...list[index], vitality: { ...list[index].vitality } }));
      return { ok: true };
    });
  }

  // --- Mutations ---

  /**
   * Add an enemy at the top of the list, filed in a group or not.
   * @param {{name?: string, kind?: "second"|"figurants", tier?: string, count?: number, groupId?: string}} fields
   * @returns {{ok: boolean, enemy?: object}}
   */
  function createEnemy(fields) {
    const groupId = getGroups().some((group) => group.id === fields?.groupId) ? fields.groupId : "";
    const kind = KIND_KEYS.includes(fields?.kind) ? fields.kind : "second";
    const tier = kind === "second" ? (tierDef(fields?.tier)?.key ?? R.NPC_TIERS[0].key) : "";
    const values = suggestedValues(kind, tier, fields?.count);
    const fallbackName = kind === "figurants" ? "Groupe de figurants" : "Second couteau";
    const enemy = normalizeEnemy({
      id: generateEnemyId(),
      name: String(fields?.name ?? "").trim() || fallbackName,
      kind,
      tier,
      dice: values.dice,
      auto: values.auto,
      vitality: { current: values.vitality, max: values.vitality },
      groupId,
    });
    setEnemies([enemy, ...getEnemies()]);
    return { ok: true, enemy };
  }

  function renameEnemy(enemyId, name) {
    return updateOne(enemyId, (enemy) => ({ ...enemy, name: String(name ?? "").trim() || enemy.name }));
  }

  /** Pick a row of the table: refills the dice and automatic successes with its suggestion. */
  function setEnemyTier(enemyId, tierKey) {
    return updateOne(enemyId, (enemy) => {
      if (enemy.kind !== "second") return enemy;
      if (!tierDef(tierKey)) return { ...enemy, tier: "" };
      const values = suggestedValues("second", tierKey);
      return { ...enemy, tier: tierKey, dice: values.dice, auto: values.auto };
    });
  }

  /** Set dice or automatic successes to any value (clamped to sane limits). */
  function setEnemyValue(enemyId, field, value) {
    if (field !== "dice" && field !== "auto") return { ok: false, message: "Champ inconnu." };
    return updateOne(enemyId, (enemy) => ({ ...enemy, [field]: value }));
  }

  /**
   * Set the current énergie vitale. For a group of figurants it is the number still
   * standing: when the dice matched that number (1 D10 per figurant), they follow it.
   */
  function setEnemyVitality(enemyId, current) {
    return updateOne(enemyId, (enemy) => {
      const next = clampInt(current, 0, enemy.vitality.max, enemy.vitality.current);
      const followDice = enemy.kind === "figurants" && enemy.dice === enemy.vitality.current;
      return { ...enemy, dice: followDice ? next : enemy.dice, vitality: { ...enemy.vitality, current: next } };
    });
  }

  /** Change the maximum; a full gauge stays full. */
  function setEnemyVitalityMax(enemyId, max) {
    return updateOne(enemyId, (enemy) => {
      const newMax = clampInt(max, 1, VITALITY_MAX, enemy.vitality.max);
      const wasFull = enemy.vitality.current === enemy.vitality.max;
      const current = wasFull ? newMax : Math.min(enemy.vitality.current, newMax);
      const followDice = enemy.kind === "figurants" && enemy.dice === enemy.vitality.current;
      return { ...enemy, dice: followDice ? Math.min(current, DICE_MAX) : enemy.dice, vitality: { max: newMax, current } };
    });
  }

  /** Copy an enemy (e.g. a second henchman), placed right after it, at full énergie vitale. */
  function duplicateEnemy(enemyId) {
    let copy = null;
    const result = updateList((list) => {
      const index = list.findIndex((enemy) => enemy.id === enemyId);
      if (index === -1) return { ok: false, message: "Ennemi introuvable." };
      const source = list[index];
      const name = uniqueName(source.name, list.map((enemy) => enemy.name));
      // Same group as the original.
      copy = normalizeEnemy({ ...source, id: generateEnemyId(), name, vitality: { current: source.vitality.max, max: source.vitality.max } });
      list.splice(index + 1, 0, copy);
      return { ok: true };
    });
    return result.ok ? { ok: true, enemy: copy } : result;
  }

  function removeEnemy(enemyId) {
    return updateList((list) => {
      const index = list.findIndex((enemy) => enemy.id === enemyId);
      if (index === -1) return { ok: false, message: "Ennemi introuvable." };
      list.splice(index, 1);
      return { ok: true };
    });
  }

  /** Remove every enemy and every group. */
  function clearEnemies() {
    setEnemyData([], []);
    return { ok: true };
  }

  /** Remove the enemies that are not filed in a group (e.g. at the end of a fight). */
  function clearUnfiledEnemies() {
    setEnemies(getEnemies().filter((enemy) => enemy.groupId));
    return { ok: true };
  }

  // --- Groups: named folders to sort enemies and export them together ---

  /**
   * @param {string} [name]
   * @returns {{ok: boolean, group: {id: string, name: string}}}
   */
  function createGroup(name) {
    const groups = getGroups();
    const wanted = String(name ?? "").trim().slice(0, NAME_MAX_LENGTH) || `Groupe ${groups.length + 1}`;
    const group = normalizeGroup({ name: uniqueName(wanted, groups.map((entry) => entry.name)) });
    setEnemyData(getEnemies(), [...groups, group]);
    return { ok: true, group };
  }

  function renameGroup(groupId, name) {
    const groups = getGroups();
    const group = groups.find((entry) => entry.id === groupId);
    if (!group) return { ok: false, message: "Groupe introuvable." };
    const wanted = String(name ?? "").trim().slice(0, NAME_MAX_LENGTH);
    if (!wanted) return { ok: false, message: "Le groupe doit avoir un nom." };
    const others = groups.filter((entry) => entry.id !== groupId).map((entry) => entry.name);
    group.name = uniqueName(wanted, others);
    setEnemyData(getEnemies(), groups);
    return { ok: true, group };
  }

  /**
   * Delete a group. Its enemies are deleted too, or put back among the unfiled ones.
   * @param {string} groupId
   * @param {{withEnemies?: boolean}} [options]
   */
  function deleteGroup(groupId, options) {
    const groups = getGroups();
    if (!groups.some((group) => group.id === groupId)) return { ok: false, message: "Groupe introuvable." };
    const enemies = getEnemies()
      .filter((enemy) => !(options?.withEnemies && enemy.groupId === groupId))
      .map((enemy) => (enemy.groupId === groupId ? { ...enemy, groupId: "" } : enemy));
    setEnemyData(enemies, groups.filter((group) => group.id !== groupId));
    return { ok: true };
  }

  /**
   * File an enemy in a group, or take it out ("" = not filed).
   * @param {string} enemyId
   * @param {string} groupId
   */
  function moveEnemy(enemyId, groupId) {
    if (groupId && !getGroups().some((group) => group.id === groupId)) return { ok: false, message: "Groupe introuvable." };
    return updateOne(enemyId, (enemy) => ({ ...enemy, groupId: groupId || "" }));
  }

  /** @returns {object[]} The enemies of a group ("" = the unfiled ones). */
  function enemiesInGroup(groupId) {
    return getEnemies().filter((enemy) => enemy.groupId === (groupId || ""));
  }

  // --- Export / import of a group (.json file) ---

  /**
   * Everything needed to recreate a group elsewhere: its name and its enemies (without ids,
   * which are regenerated on import).
   * @param {string} groupId
   * @returns {object|null}
   */
  function exportGroup(groupId) {
    const group = getGroups().find((entry) => entry.id === groupId);
    if (!group) return null;
    return {
      format: EXPORT_FORMAT,
      version: EXPORT_VERSION,
      exportedAt: new Date().toISOString(),
      group: { name: group.name },
      enemies: enemiesInGroup(groupId).map(({ name, kind, tier, dice, auto, vitality }) => ({ name, kind, tier, dice, auto, vitality })),
    };
  }

  /**
   * Read a file made by exportGroup(). Untrusted input: every enemy goes through
   * normalizeEnemy().
   * @param {string} text
   * @returns {{ok: true, name: string, enemies: object[]}|{ok: false, message: string}}
   */
  function parseGroupExport(text) {
    let data;
    try {
      data = JSON.parse(text);
    } catch (error) {
      return { ok: false, message: "Ce fichier n'est pas un fichier JSON valide." };
    }
    if (!data || data.format !== EXPORT_FORMAT || !Array.isArray(data.enemies)) {
      return { ok: false, message: "Ce fichier n'est pas un groupe d'ennemis exporté depuis cette page." };
    }
    if (data.version > EXPORT_VERSION) {
      return { ok: false, message: "Ce fichier vient d'une version plus récente de l'application." };
    }
    const enemies = data.enemies.map((raw) => normalizeEnemy(raw && typeof raw === "object" ? { ...raw, id: "", groupId: "" } : null)).filter(Boolean);
    return { ok: true, name: normalizeGroup({ name: data.group?.name }).name, enemies };
  }

  /**
   * Add an exported group as a new group (renamed "Nom (2)" if the name is taken), with
   * fresh ids so it never collides with what is already here.
   * @param {{name: string, enemies: object[]}} parsed - from parseGroupExport()
   * @returns {{ok: boolean, group: {id: string, name: string}, count: number}}
   */
  function importGroup(parsed) {
    const groups = getGroups();
    const group = normalizeGroup({ name: uniqueName(parsed.name, groups.map((entry) => entry.name)) });
    const added = parsed.enemies.map((enemy) => normalizeEnemy({ ...enemy, id: generateEnemyId(), groupId: group.id }));
    setEnemyData([...added, ...getEnemies()], [...groups, group]);
    return { ok: true, group, count: added.length };
  }

  // --- Rolls (pure) ---

  /**
   * Roll a pool the GM chose: same dice rules as the players (10 = 2 succès, 5-9 = 1,
   * 4 = −1, 1-3 = 0), plus automatic successes.
   * @param {number} dice
   * @param {number} auto
   * @returns {{values: number[], diceSuccesses: number, auto: number, total: number, quality: {label: string, difficulty: string}}}
   */
  function rollPool(dice, auto) {
    const count = clampInt(dice, 0, DICE_MAX, 0);
    const bonus = clampInt(auto, AUTO_MIN, AUTO_MAX, 0);
    const values = Array.from({ length: count }, () => C.rollD10());
    const diceSuccesses = C.countSuccesses(values);
    const total = diceSuccesses + bonus;
    return { values, diceSuccesses, auto: bonus, total, quality: C.qualityFor(total) };
  }

  /**
   * What the enemy brings when it helps a protagonist (p. 108-109): a second couteau adds
   * half its successes (rounded down) to the protagonist's test; a group of figurants
   * offers one automatic success per figurant present.
   * @param {object} enemy
   * @param {{total: number}} [roll] - the second couteau's roll
   * @returns {number}
   */
  function helpBonus(enemy, roll) {
    if (enemy.kind === "figurants") return enemy.vitality.current;
    return roll ? Math.max(0, Math.floor(roll.total / 2)) : 0;
  }

  /**
   * Short state line shown under the gauge, or "" when nothing to say.
   * @param {object} enemy
   * @returns {string}
   */
  function enemyStatus(enemy) {
    const { current, max } = enemy.vitality;
    if (enemy.kind === "figurants") {
      if (current === 0) return "Groupe vaincu.";
      if (current <= max / 2) return "La moitié du groupe est décimée : testez sa volonté de poursuivre le combat.";
      return "";
    }
    return current === 0 ? "Hors combat." : "";
  }

  App.enemies = {
    DICE_MAX,
    AUTO_MIN,
    AUTO_MAX,
    VITALITY_MAX,
    NAME_MAX_LENGTH,
    tierDef,
    rangeLabel,
    suggestedValues,
    normalizeEnemy,
    normalizeGroup,
    getEnemies,
    getGroups,
    enemiesInGroup,
    createEnemy,
    renameEnemy,
    setEnemyTier,
    setEnemyValue,
    setEnemyVitality,
    setEnemyVitalityMax,
    duplicateEnemy,
    removeEnemy,
    clearEnemies,
    clearUnfiledEnemies,
    createGroup,
    renameGroup,
    deleteGroup,
    moveEnemy,
    exportGroup,
    parseGroupExport,
    importGroup,
    rollPool,
    helpBonus,
    enemyStatus,
  };
})();

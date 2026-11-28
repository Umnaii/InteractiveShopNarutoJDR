/**
 * The GM's enemies (PNJ, rules p. 108-109): "seconds couteaux" and groups of figurants,
 * kept deliberately simple: a name, a dice pool, automatic successes and énergie vitale.
 * The "Valeur d'un PNJ" table (App.ninjaRules.NPC_TIERS) only pre-fills suggestions; the
 * GM can set any value afterwards. The only module that changes App.state's enemies.
 *
 * Plain script: attaches its API to the shared App namespace as App.enemies.
 * Depends on App.ninjaRules, App.sheetCalc, App.state.
 */

(function () {
  "use strict";
  window.App = window.App || {};

  const R = App.ninjaRules;
  const C = App.sheetCalc;
  const { getEnemies: getRawEnemies, setEnemies } = App.state;

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
   * Sanitize one stored enemy (idempotent).
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
    };
  }

  /** @returns {object[]} Every enemy, sanitized, in display order (newest first). */
  function getEnemies() {
    return getRawEnemies().map(normalizeEnemy).filter(Boolean);
  }

  function updateList(mutate) {
    const list = getEnemies();
    const result = mutate(list) ?? { ok: true };
    if (result.ok) setEnemies(list);
    return result;
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
   * Add an enemy at the top of the list.
   * @param {{name?: string, kind?: "second"|"figurants", tier?: string, count?: number}} fields
   * @returns {{ok: boolean, enemy?: object}}
   */
  function createEnemy(fields) {
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
      const base = source.name.replace(/\s\(\d+\)$/, "");
      let number = 2;
      while (list.some((enemy) => enemy.name === `${base} (${number})`)) number += 1;
      copy = normalizeEnemy({ ...source, id: generateEnemyId(), name: `${base} (${number})`, vitality: { current: source.vitality.max, max: source.vitality.max } });
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

  function clearEnemies() {
    setEnemies([]);
    return { ok: true };
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
    getEnemies,
    createEnemy,
    renameEnemy,
    setEnemyTier,
    setEnemyValue,
    setEnemyVitality,
    setEnemyVitalityMax,
    duplicateEnemy,
    removeEnemy,
    clearEnemies,
    rollPool,
    helpBonus,
    enemyStatus,
  };
})();

/**
 * Character sheet maths: the default sheet, sanitizing a stored/imported sheet, creation
 * budgets, progression costs, dice and successes, combined natures, equipment caps and
 * initiative piles. Pure functions only: nothing here reads App.state or touches the DOM,
 * so js/sheet.js (mutations) and the views can both rely on the same rules.
 * Plain script: attaches its API to the shared App namespace as App.sheetCalc.
 * Depends on App.ninjaRules, App.items (must be loaded first).
 *
 * @typedef {Object} Technique
 * @property {string} id
 * @property {string} name
 * @property {string} art        - key of App.ninjaRules.ARTS (the art rolled with it)
 * @property {string} rank       - "E".."S"
 * @property {string} mastery    - "D" | "C" | "A" | "M" | "P" | "S"
 * @property {string} element    - "" | base element key | nature key
 * @property {"start"|"creation"|"play"} origin - Where it came from: the three free starting
 *   techniques, bought with creation PA, or learned in play (paid in the PA ledger or added by hand).
 *
 * @typedef {Object} Spending - One PX/PA expense in the progression ledger.
 * @property {string} id
 * @property {number} timestamp
 * @property {"px"|"pa"} currency
 * @property {number} cost
 * @property {string} label
 * @property {{type: string, key?: string, techniqueId?: string, previous?: (number|string)}} undo -
 *   What "Annuler la dernière dépense" must put back.
 *
 * @typedef {Object} Sheet - Stored on Profile.sheet (see STRUCTURE.md, section 4).
 */

(function () {
  "use strict";
  window.App = window.App || {};

  const R = App.ninjaRules;
  const { ITEMS } = App.items;

  const STAT_KEYS = R.STATS.map((stat) => stat.key);
  const ART_KEYS = R.ARTS.map((art) => art.key);
  const ELEMENT_KEYS = R.ELEMENTS.map((element) => element.key);
  const ASPECT_KEYS = R.ASPECT_CATEGORIES.map((category) => category.key);
  const NATURE_KEYS = R.NATURES.map((nature) => nature.key);
  const KG_NATURE_KEYS = R.NATURES.filter((nature) => nature.kind === "kg2" || nature.kind === "kg3").map((nature) => nature.key);
  const MASTERY_KEYS = R.MASTERY_LEVELS.map((level) => level.key);
  const RANK_KEYS = R.TECHNIQUE_RANKS.map((rank) => rank.key);
  const ASPECT_EFFECT_KEYS = R.ASPECT_EFFECTS.map((effect) => effect.key);
  const ORIGINS = ["start", "creation", "play"];
  const ITEMS_BY_ID = new Map(ITEMS.map((item) => [item.id, item]));

  // --- Small sanitizing helpers ---

  function isObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  /**
   * Coerce to an integer within [min, max], or `fallback` when it isn't a finite number.
   * @returns {number}
   */
  function clampInt(value, min, max, fallback) {
    const number = Number(value);
    if (value === null || value === "" || !Number.isFinite(number)) return fallback;
    return Math.min(max, Math.max(min, Math.round(number)));
  }

  function cleanString(value, maxLength) {
    return typeof value === "string" ? value.slice(0, maxLength ?? 500) : "";
  }

  /** Exactly `length` strings, padding with "" (extra entries dropped). */
  function fixedStrings(value, length) {
    const source = Array.isArray(value) ? value : [];
    return Array.from({ length }, (_, index) => cleanString(source[index], 200));
  }

  function mapKeys(keys, valueFor) {
    return Object.fromEntries(keys.map((key) => [key, valueFor(key)]));
  }

  /**
   * Generate a reasonably unique id, prefixed for readability in storage/debugging.
   * @param {string} prefix
   * @returns {string}
   */
  function generateSheetId(prefix) {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return `${prefix}-${crypto.randomUUID()}`;
    }
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  // --- Lookups ---

  /**
   * Grade-dependent rules (creation budgets, equipment cap). Unknown grades read as Genin.
   * @param {string} grade
   * @returns {object}
   */
  function gradeRules(grade) {
    return R.GRADE_RULES[grade] ?? R.GRADE_RULES.Genin;
  }

  /** @returns {object|null} The stat definition for a key. */
  function statDef(key) {
    return R.STATS.find((stat) => stat.key === key) ?? null;
  }

  /** @returns {object|null} The art definition for a key. */
  function artDef(key) {
    return R.ARTS.find((art) => art.key === key) ?? null;
  }

  /** @returns {object|null} The base element definition for a key. */
  function elementDef(key) {
    return R.ELEMENTS.find((element) => element.key === key) ?? null;
  }

  /** @returns {object|null} The combined nature definition for a key. */
  function natureDef(key) {
    return R.NATURES.find((nature) => nature.key === key) ?? null;
  }

  /**
   * Display name of anything a technique's "Élément" can hold.
   * @param {string} key - "" | base element key | nature key
   * @returns {string}
   */
  function elementLabel(key) {
    if (!key) return "Aucun";
    const base = elementDef(key);
    if (base) return `${base.label} (${base.name})`;
    const nature = natureDef(key);
    return nature ? `${nature.name} (${nature.label})` : key;
  }

  /** @returns {number} Index of a mastery key in MASTERY_LEVELS (0 = Débutant). */
  function masteryIndex(key) {
    return Math.max(0, MASTERY_KEYS.indexOf(key));
  }

  /** @returns {object} The mastery level definition for a key. */
  function masteryLevel(key) {
    return R.MASTERY_LEVELS[masteryIndex(key)];
  }

  /**
   * Chakra cost of a technique rank: E = 1 ... S = 6.
   * @param {string} rank
   * @returns {number}
   */
  function rankCost(rank) {
    return R.TECHNIQUE_RANKS.find((entry) => entry.key === rank)?.cost ?? 1;
  }

  /**
   * Total PA to bring a technique from Débutant up to a mastery level (D = 0 ... S = 8).
   * @param {string} masteryKey
   * @returns {number}
   */
  function masteryCostFromStart(masteryKey) {
    return R.MASTERY_LEVELS.slice(1, masteryIndex(masteryKey) + 1).reduce((sum, level) => sum + level.cost, 0);
  }

  // --- Default sheet and sanitizing ---

  /**
   * A technique with defaults for every field not given.
   * @param {Partial<Technique>} [fields]
   * @returns {Technique}
   */
  function createTechnique(fields) {
    return { id: generateSheetId("tech"), name: "", art: "ninjutsu", rank: "E", mastery: "D", element: "", origin: "play", ...fields };
  }

  /**
   * A brand-new sheet: creation mode, every characteristic at 1, arts at 0, the three
   * starting techniques (free, Débutant). Grade-dependent values (chakra, énergie vitale,
   * elements) are filled by applyCreationDerivations() through normalizeSheet().
   * @returns {object}
   */
  function createDefaultSheet() {
    return {
      mode: "creation",
      identity: { surnom: "", description: "", joueur: "", clan: "", sexe: "", age: "" },
      stats: mapKeys(STAT_KEYS, () => R.STAT_MIN),
      traits: mapKeys(STAT_KEYS, () => fixedStrings([], R.STAT_MAX)),
      arts: mapKeys(ART_KEYS, () => 0),
      elementRoles: { affinity: "", second: "", weak: "" },
      elements: mapKeys(ELEMENT_KEYS, () => -1),
      unlockedNatures: [],
      kekkeiGenkai: Array.from({ length: R.KEKKEI_GENKAI_SLOTS }, () => ""),
      techniques: R.STARTING_TECHNIQUES.map((technique) => createTechnique({ ...technique, mastery: "D", origin: "start" })),
      aspects: mapKeys(ASPECT_KEYS, () => fixedStrings([], R.ASPECTS_PER_CATEGORY)),
      pendingAspects: [],
      vitality: { current: R.GRADE_RULES.Genin.vitality, max: R.GRADE_RULES.Genin.vitality },
      chakra: { current: R.GRADE_RULES.Genin.chakra, max: R.GRADE_RULES.Genin.chakra },
      creationChakraPa: 0,
      earned: { px: 0, pa: 0 },
      spending: [],
      customItems: [],
      rolls: [],
      initiative: { total: null, die: null, bonus: null, piles: [] },
    };
  }

  function normalizeTechnique(raw) {
    const element = ELEMENT_KEYS.includes(raw.element) || NATURE_KEYS.includes(raw.element) ? raw.element : "";
    return {
      id: typeof raw.id === "string" && raw.id ? raw.id : generateSheetId("tech"),
      name: cleanString(raw.name, 120),
      art: ART_KEYS.includes(raw.art) ? raw.art : "ninjutsu",
      rank: RANK_KEYS.includes(raw.rank) ? raw.rank : "E",
      mastery: MASTERY_KEYS.includes(raw.mastery) ? raw.mastery : "D",
      element,
      origin: ORIGINS.includes(raw.origin) ? raw.origin : "play",
    };
  }

  function normalizeSpending(raw) {
    return {
      id: typeof raw.id === "string" && raw.id ? raw.id : generateSheetId("spend"),
      timestamp: Number.isFinite(raw.timestamp) ? raw.timestamp : Date.now(),
      currency: raw.currency === "pa" ? "pa" : "px",
      cost: clampInt(raw.cost, 0, 9999, 0),
      label: cleanString(raw.label, 200),
      undo: isObject(raw.undo) && typeof raw.undo.type === "string" ? { ...raw.undo } : { type: "none" },
    };
  }

  function normalizeCustomItem(raw) {
    return {
      id: typeof raw.id === "string" && raw.id ? raw.id : generateSheetId("item"),
      name: cleanString(raw.name, 120),
      stat: STAT_KEYS.includes(raw.stat) ? raw.stat : "combat",
      dice: clampInt(raw.dice, 0, 9, 0),
      successes: clampInt(raw.successes, 0, 9, 0),
      legendary: Boolean(raw.legendary),
    };
  }

  function normalizeRoll(raw) {
    const dice = Array.isArray(raw.dice)
      ? raw.dice.filter(isObject).map((die) => ({ value: clampInt(die.value, 1, 10, 1), rerolled: Boolean(die.rerolled) }))
      : [];
    return {
      id: typeof raw.id === "string" && raw.id ? raw.id : generateSheetId("roll"),
      timestamp: Number.isFinite(raw.timestamp) ? raw.timestamp : Date.now(),
      label: cleanString(raw.label, 160),
      dice,
      auto: clampInt(raw.auto, -999, 999, 0),
      total: clampInt(raw.total, -999, 999, 0),
    };
  }

  /**
   * Turn whatever is stored (or imported) into a complete, valid sheet. Never throws:
   * missing or malformed fields fall back to defaults, exactly like storage.js does for
   * the rest of the app. In creation mode, grade-dependent values are recomputed
   * (see applyCreationDerivations).
   * @param {*} raw - Profile.sheet as stored, possibly undefined (profiles from before the sheet existed).
   * @param {string} grade - The profile's rank.
   * @returns {object} A fresh object; mutating it never touches `raw`.
   */
  function normalizeSheet(raw, grade) {
    const base = createDefaultSheet();
    const src = isObject(raw) ? raw : {};

    const roles = { affinity: "", second: "", weak: "" };
    for (const role of Object.keys(roles)) {
      const value = src.elementRoles?.[role];
      if (ELEMENT_KEYS.includes(value) && !Object.values(roles).includes(value)) roles[role] = value;
    }

    const vitalityMax = clampInt(src.vitality?.max, 1, 999, base.vitality.max);
    const chakraMax = clampInt(src.chakra?.max, 0, 9999, base.chakra.max);

    const sheet = {
      mode: src.mode === "jeu" ? "jeu" : "creation",
      identity: mapKeys(Object.keys(base.identity), (key) => cleanString(src.identity?.[key], key === "description" ? 1000 : 120)),
      stats: mapKeys(STAT_KEYS, (key) => clampInt(src.stats?.[key], R.STAT_MIN, R.STAT_MAX, R.STAT_MIN)),
      traits: mapKeys(STAT_KEYS, (key) => fixedStrings(src.traits?.[key], R.STAT_MAX)),
      arts: mapKeys(ART_KEYS, (key) => clampInt(src.arts?.[key], 0, 99, 0)),
      elementRoles: roles,
      elements: mapKeys(ELEMENT_KEYS, (key) => clampInt(src.elements?.[key], -20, 20, -1)),
      unlockedNatures: Array.isArray(src.unlockedNatures) ? [...new Set(src.unlockedNatures.filter((key) => NATURE_KEYS.includes(key)))] : [],
      kekkeiGenkai: Array.from({ length: R.KEKKEI_GENKAI_SLOTS }, (_, index) => {
        const value = Array.isArray(src.kekkeiGenkai) ? src.kekkeiGenkai[index] : "";
        return KG_NATURE_KEYS.includes(value) ? value : "";
      }),
      techniques: Array.isArray(src.techniques) ? src.techniques.filter(isObject).map(normalizeTechnique) : base.techniques,
      aspects: mapKeys(ASPECT_KEYS, (key) => fixedStrings(src.aspects?.[key], R.ASPECTS_PER_CATEGORY)),
      pendingAspects: Array.isArray(src.pendingAspects) ? src.pendingAspects.filter((key) => ASPECT_EFFECT_KEYS.includes(key)) : [],
      vitality: { max: vitalityMax, current: clampInt(src.vitality?.current, -vitalityMax, vitalityMax, vitalityMax) },
      chakra: { max: chakraMax, current: clampInt(src.chakra?.current, 0, chakraMax, chakraMax) },
      creationChakraPa: clampInt(src.creationChakraPa, 0, 999, 0),
      earned: { px: clampInt(src.earned?.px, 0, 99999, 0), pa: clampInt(src.earned?.pa, 0, 99999, 0) },
      spending: Array.isArray(src.spending) ? src.spending.filter(isObject).map(normalizeSpending) : [],
      customItems: Array.isArray(src.customItems) ? src.customItems.filter(isObject).map(normalizeCustomItem) : [],
      rolls: Array.isArray(src.rolls) ? src.rolls.filter(isObject).slice(0, R.ROLL_HISTORY_SIZE).map(normalizeRoll) : [],
      initiative: {
        total: src.initiative?.total === null || src.initiative?.total === undefined ? null : clampInt(src.initiative.total, 0, 999, null),
        die: clampInt(src.initiative?.die, 1, 10, null),
        bonus: clampInt(src.initiative?.bonus, -99, 999, null),
        piles: Array.isArray(src.initiative?.piles) ? src.initiative.piles.map((pile) => clampInt(pile, 0, 999, 0)).slice(0, 30) : [],
      },
    };

    if (sheet.mode === "creation") applyCreationDerivations(sheet, grade);
    return sheet;
  }

  /** How many ledger entries of a given undo type (optionally for one key) exist. */
  function countPurchases(sheet, type, key) {
    return sheet.spending.filter((entry) => entry.undo.type === type && (key === undefined || entry.undo.key === key)).length;
  }

  /**
   * In creation mode, the values set by the grade are computed, not typed: énergie vitale
   * max, chakra max (+2 per creation PA) and the five element values from the chosen roles.
   * Anything bought later with PX/PA (the ledger) is added on top, so going back to
   * creation mode never loses a purchase. Mutates `sheet`.
   * @param {object} sheet
   * @param {string} grade
   * @returns {void}
   */
  function applyCreationDerivations(sheet, grade) {
    const rules = gradeRules(grade);
    if (rules.second === null) sheet.elementRoles.second = "";

    sheet.vitality.max = rules.vitality + countPurchases(sheet, "vitalityMax") * R.PROGRESSION.vitalityGain;
    sheet.vitality.current = sheet.vitality.max;
    sheet.chakra.max = rules.chakra + (sheet.creationChakraPa + countPurchases(sheet, "chakraMax")) * R.PROGRESSION.chakraGain;
    sheet.chakra.current = sheet.chakra.max;

    for (const key of ELEMENT_KEYS) {
      const { affinity, second, weak } = sheet.elementRoles;
      const roleValue = key === affinity ? rules.affinity : key === second ? rules.second : key === weak ? rules.weak : rules.other;
      sheet.elements[key] = roleValue + countPurchases(sheet, "element", key);
    }
  }

  // --- Creation budgets ---

  /**
   * PA spent on a technique since its creation-mode baseline: learning it (unless it's one
   * of the free starting ones) plus every mastery step above Débutant.
   * @param {Technique} technique
   * @returns {number}
   */
  function techniquePaValue(technique) {
    return (technique.origin === "creation" ? R.NEW_TECHNIQUE_COST : 0) + masteryCostFromStart(technique.mastery);
  }

  /**
   * Remaining creation budgets. Play-mode purchases (the PX/PA ledger) are excluded, so
   * the counters stay right even after switching back to creation mode.
   * @param {object} sheet
   * @param {string} grade
   * @returns {{stats: {spent: number, total: number, remaining: number}, arts: {spent: number, total: number, remaining: number, max: number}, pa: {spent: number, total: number, remaining: number}, aspects: {filled: number, max: number, toStart: number}}}
   */
  function creationBudget(sheet, grade) {
    const rules = gradeRules(grade);
    const sum = (values) => values.reduce((total, value) => total + value, 0);

    const statsSpent = sum(Object.values(sheet.stats)) - countPurchases(sheet, "stat");
    const artsSpent = sum(Object.values(sheet.arts)) - countPurchases(sheet, "art");

    const playMasteryPa = sheet.spending
      .filter((entry) => entry.undo.type === "mastery" && sheet.techniques.some((tech) => tech.id === entry.undo.techniqueId && tech.origin !== "play"))
      .reduce((total, entry) => total + entry.cost, 0);
    const paSpent =
      sheet.creationChakraPa +
      sum(sheet.techniques.filter((tech) => tech.origin !== "play").map(techniquePaValue)) -
      playMasteryPa;

    const filled = sum(Object.values(sheet.aspects).map((pair) => pair.filter((text) => text.trim()).length));

    return {
      stats: { spent: statsSpent, total: rules.statPoints, remaining: rules.statPoints - statsSpent },
      arts: { spent: artsSpent, total: rules.artPoints, remaining: rules.artPoints - artsSpent, max: rules.artMax },
      pa: { spent: paSpent, total: rules.pa, remaining: rules.pa - paSpent },
      aspects: { filled, max: R.ASPECT_CATEGORIES.length * R.ASPECTS_PER_CATEGORY, toStart: R.ASPECTS_TO_START },
    };
  }

  /**
   * Non-blocking warnings for creation mode (book recommendations, Genin restrictions).
   * @param {object} sheet
   * @param {string} grade
   * @returns {string[]}
   */
  function creationWarnings(sheet, grade) {
    const warnings = [];
    const rules = gradeRules(grade);

    if (grade === "Genin") {
      for (const key of R.RESTRICTED_ARTS) {
        if (sheet.arts[key] > 0) {
          warnings.push(`${artDef(key).label} est réservé aux Chûnin et plus, sauf exception accordée par le conteur.`);
        }
      }
    }
    for (const art of R.ARTS) {
      if (sheet.arts[art.key] > rules.artMax) {
        warnings.push(`${art.label} dépasse le maximum de création pour ce grade (${rules.artMax}).`);
      }
    }

    const names = sheet.techniques.map((tech) => tech.name.toLowerCase());
    if (names.some((name) => name.includes("sharingan") && /(2|3|deux|trois|mangek|éternel|eternel)/.test(name))) {
      warnings.push("Le livre recommande de ne pas dépasser le 1er Tomoe du Sharingan à la création.");
    }
    if (names.some((name) => /senjutsu|ermite/.test(name))) {
      warnings.push("Le livre recommande de ne pas prendre de Senjutsu à la création.");
    }
    if (names.some((name) => /\byin\b|\byang\b|onmy|in'?y[oô]/.test(name))) {
      warnings.push("Le livre recommande de ne pas prendre de Yin-Yang à la création.");
    }
    return warnings;
  }

  // --- Elements and natures ---

  /** @returns {number} How many base elements are above 0. */
  function countPositiveElements(sheet) {
    return ELEMENT_KEYS.filter((key) => sheet.elements[key] > 0).length;
  }

  /**
   * Level of a combined nature: the base element's value for a sublimated one, otherwise
   * the weakest of its elements (p. 51, 55, 56).
   * @param {object} sheet
   * @param {object} nature
   * @returns {number}
   */
  function natureLevel(sheet, nature) {
    return Math.min(...nature.elements.map((key) => sheet.elements[key]));
  }

  /**
   * Successes added by the element of a technique (base element value or nature level;
   * negative values remove successes).
   * @param {object} sheet
   * @param {string} key - "" | base element key | nature key
   * @returns {number}
   */
  function elementValue(sheet, key) {
    if (!key) return 0;
    if (ELEMENT_KEYS.includes(key)) return sheet.elements[key];
    const nature = natureDef(key);
    return nature ? natureLevel(sheet, nature) : 0;
  }

  /** @returns {boolean} True when the Hérédité aspect has at least one filled field. */
  function hasHeredityAspect(sheet) {
    return sheet.aspects.heredite.some((text) => text.trim());
  }

  /**
   * Prerequisites of a combined nature, checked against the sheet's techniques.
   * @param {object} sheet
   * @param {object} nature
   * @returns {{lit: boolean, unlocked: boolean, level: number, missing: string[]}}
   */
  function natureStatus(sheet, nature) {
    const hasTechnique = (elementKey, minMastery) =>
      sheet.techniques.some((tech) => tech.element === elementKey && masteryIndex(tech.mastery) >= masteryIndex(minMastery));
    const label = (key) => elementDef(key).label;
    const missing = [];

    const needPositive = nature.kind === "sublime" || nature.kind === "triple";
    const minMastery = { sublime: "S", double: "P", kg2: "P", triple: "M", kg3: "M" }[nature.kind];

    if ((nature.kind === "kg2" || nature.kind === "kg3") && !hasHeredityAspect(sheet)) {
      missing.push("un aspect Hérédité");
    }
    for (const key of nature.elements) {
      if (needPositive && sheet.elements[key] <= 0) missing.push(`${label(key)} positif`);
      if (!hasTechnique(key, minMastery)) missing.push(`une technique ${label(key)} ${masteryLevel(minMastery).label.toLowerCase()}`);
    }

    return {
      lit: missing.length === 0,
      unlocked: sheet.unlockedNatures.includes(nature.key),
      level: natureLevel(sheet, nature),
      missing,
    };
  }

  /**
   * On-roll effect text of a nature (its own, or its kind's).
   * @param {object} nature
   * @returns {string}
   */
  function natureEffect(nature) {
    return R.NATURE_EFFECTS[nature.key] ?? R.NATURE_KINDS[nature.kind].effect;
  }

  /**
   * Choices for a technique's "Élément" field: none, the five base elements, every
   * unlocked nature, plus `current` so a value never silently disappears from its select.
   * @param {object} sheet
   * @param {string} [current]
   * @returns {{value: string, label: string}[]}
   */
  function techniqueElementOptions(sheet, current) {
    const natureKeys = new Set(sheet.unlockedNatures);
    if (current && NATURE_KEYS.includes(current)) natureKeys.add(current);
    return [
      { value: "", label: "Aucun" },
      ...R.ELEMENTS.map((element) => ({ value: element.key, label: `${element.label} (${element.name})` })),
      ...R.NATURES.filter((nature) => natureKeys.has(nature.key)).map((nature) => ({ value: nature.key, label: `${nature.name} (${nature.label})` })),
    ];
  }

  // --- Techniques ---

  /**
   * Everything the "Lancer la technique" button needs.
   * @param {object} sheet
   * @param {Technique} technique
   * @returns {{cost: number, artLabel: string, artValue: number, usable: boolean, maxExtra: number, mastery: object, elementBonus: number}}
   */
  function techniqueInfo(sheet, technique) {
    const cost = rankCost(technique.rank);
    const artValue = sheet.arts[technique.art] ?? 0;
    return {
      cost,
      artLabel: artDef(technique.art)?.label ?? technique.art,
      artValue,
      usable: artValue >= cost,
      // p. 107: chakra per action (cost + extra) can't exceed the art's level.
      maxExtra: Math.max(0, artValue - cost),
      mastery: masteryLevel(technique.mastery),
      elementBonus: elementValue(sheet, technique.element),
    };
  }

  // --- Progression (PX / PA ledger) ---

  /**
   * PX or PA spent so far, from the ledger.
   * @param {object} sheet
   * @param {"px"|"pa"} currency
   * @returns {number}
   */
  function spentTotal(sheet, currency) {
    return sheet.spending.filter((entry) => entry.currency === currency).reduce((total, entry) => total + entry.cost, 0);
  }

  /**
   * Earned, spent and available PX/PA.
   * @param {object} sheet
   * @returns {{px: {earned: number, spent: number, available: number}, pa: {earned: number, spent: number, available: number}}}
   */
  function experienceSummary(sheet) {
    const summary = (currency) => {
      const earned = sheet.earned[currency];
      const spent = spentTotal(sheet, currency);
      return { earned, spent, available: earned - spent };
    };
    return { px: summary("px"), pa: summary("pa") };
  }

  /**
   * Cost and limits of each purchase. Every function returns {cost, currency, target,
   * blocked} where `blocked` is a short French reason, or null when the purchase is allowed
   * by the rules (affordability is checked separately, see canAfford()).
   */
  function statUpgrade(sheet, key) {
    const target = sheet.stats[key] + 1;
    return {
      currency: "px",
      target,
      cost: target * R.PROGRESSION.statCostFactor,
      blocked: target > R.STAT_MAX ? `Maximum ${R.STAT_MAX} atteint` : null,
    };
  }

  function artUpgrade(sheet, key) {
    const target = sheet.arts[key] + 1;
    return { currency: "px", target, cost: target * R.PROGRESSION.artCostFactor, blocked: null };
  }

  function vitalityUpgrade(sheet) {
    return { currency: "px", target: sheet.vitality.max + R.PROGRESSION.vitalityGain, cost: R.PROGRESSION.vitalityCostPx, blocked: null };
  }

  function chakraUpgrade(sheet) {
    return { currency: "pa", target: sheet.chakra.max + R.PROGRESSION.chakraGain, cost: R.PROGRESSION.chakraCostPa, blocked: null };
  }

  function newTechniqueCost() {
    return { currency: "pa", target: null, cost: R.NEW_TECHNIQUE_COST, blocked: null };
  }

  function masteryUpgrade(technique) {
    const index = masteryIndex(technique.mastery);
    const next = R.MASTERY_LEVELS[index + 1];
    if (!next) return { currency: "pa", target: null, cost: 0, blocked: "Déjà Sublimée" };
    return { currency: "pa", target: next.key, cost: next.cost, blocked: null };
  }

  /**
   * +1 in an element: 1 PA while it's 0 or negative, else the target level in PA; at most
   * three elements above 0 (p. 115).
   */
  function elementUpgrade(sheet, key) {
    const current = sheet.elements[key];
    const target = current + 1;
    const cost = current <= 0 ? 1 : target;
    const crossesZero = current <= 0 && target > 0;
    const blocked =
      crossesZero && countPositiveElements(sheet) >= R.MAX_POSITIVE_ELEMENTS
        ? `Déjà ${R.MAX_POSITIVE_ELEMENTS} éléments au-dessus de 0`
        : null;
    return { currency: "pa", target, cost, blocked };
  }

  /**
   * @param {object} sheet
   * @param {{currency: "px"|"pa", cost: number}} purchase
   * @returns {boolean}
   */
  function canAfford(sheet, purchase) {
    return experienceSummary(sheet)[purchase.currency].available >= purchase.cost;
  }

  // --- Equipment ---

  /**
   * Bonus items the character carries: shop purchases with a bonus (inventory) plus items
   * added by hand on the sheet.
   * @param {object} profile
   * @param {object} sheet
   * @returns {{id: string, name: string, stat: string, dice: number, successes: number, legendary: boolean, source: "shop"|"custom", quantity: number}[]}
   */
  function equipmentList(profile, sheet) {
    const fromShop = (profile.inventory ?? [])
      .map((entry) => ({ entry, item: ITEMS_BY_ID.get(entry.itemId) }))
      .filter(({ item }) => item && item.bonus)
      .map(({ entry, item }) => ({
        id: `shop:${item.id}`,
        name: item.name,
        stat: item.bonus.stat,
        dice: item.bonus.dice,
        successes: item.bonus.successes,
        legendary: item.bonus.legendary,
        source: "shop",
        quantity: entry.quantity,
      }));
    const custom = sheet.customItems.map((item) => ({
      id: `custom:${item.id}`,
      name: item.name || "Objet sans nom",
      stat: item.stat,
      dice: item.dice,
      successes: item.successes,
      legendary: item.legendary,
      source: "custom",
      quantity: 1,
    }));
    return [...fromShop, ...custom];
  }

  /**
   * Bonus actually granted by a set of items for one roll. Items stack, but the total is
   * capped by grade (Genin +1 dé, Chûnin +2 dés, Jônin +3 dés et +1 succès). A legendary
   * weapon replaces the cap: its own bonus counts and nothing else is added.
   * @param {{name: string, dice: number, successes: number, legendary: boolean}[]} items
   * @param {string} grade
   * @returns {{dice: number, successes: number, rawDice: number, rawSuccesses: number, capped: boolean, legendary: string|null}}
   */
  function equipmentBonus(items, grade) {
    const legendary = items.find((item) => item.legendary);
    const rawDice = items.reduce((total, item) => total + item.dice, 0);
    const rawSuccesses = items.reduce((total, item) => total + item.successes, 0);
    if (legendary) {
      return { dice: legendary.dice, successes: legendary.successes, rawDice, rawSuccesses, capped: false, legendary: legendary.name };
    }
    const rules = gradeRules(grade);
    const dice = Math.min(rawDice, rules.equipDice);
    const successes = Math.min(rawSuccesses, rules.equipSuccesses);
    return { dice, successes, rawDice, rawSuccesses, capped: dice < rawDice || successes < rawSuccesses, legendary: null };
  }

  // --- Dice ---

  /** @returns {number} A fair d10 result, 1..10. */
  function rollD10() {
    if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
      // Rejection sampling: 250 is the largest multiple of 10 below 256, so no bias.
      const buffer = new Uint8Array(1);
      do crypto.getRandomValues(buffer);
      while (buffer[0] >= 250);
      return (buffer[0] % 10) + 1;
    }
    return Math.floor(Math.random() * 10) + 1;
  }

  /**
   * Successes from one die (p. 105): 10 = 2, 5..9 = 1, 4 = cancels one (unless an aspect
   * says to ignore the 4s), 1..3 = nothing.
   * @param {number} value
   * @param {boolean} [ignoreFours]
   * @returns {number}
   */
  function dieSuccesses(value, ignoreFours) {
    if (value === 10) return 2;
    if (value >= 5) return 1;
    if (value === 4) return ignoreFours ? 0 : -1;
    return 0;
  }

  /** @returns {"crit"|"success"|"cancel"|"fail"} Color family of a die. */
  function dieKind(value) {
    if (value === 10) return "crit";
    if (value >= 5) return "success";
    if (value === 4) return "cancel";
    return "fail";
  }

  /**
   * @param {number[]} values
   * @param {boolean} [ignoreFours]
   * @returns {number}
   */
  function countSuccesses(values, ignoreFours) {
    return values.reduce((total, value) => total + dieSuccesses(value, ignoreFours), 0);
  }

  /**
   * Quality of a result (p. 106).
   * @param {number} total
   * @returns {{label: string, difficulty: string}}
   */
  function qualityFor(total) {
    let found = R.QUALITY_LEVELS[0];
    for (const level of R.QUALITY_LEVELS) if (total >= level.min) found = level;
    return found;
  }

  /**
   * "Réussite spontanée" (p. 106): the action succeeds without rolling against any fixed
   * difficulty up to (dice + automatic successes) ÷ 2, rounded down.
   * @param {number} diceCount
   * @param {number} autoSuccesses
   * @returns {number}
   */
  function spontaneousDifficulty(diceCount, autoSuccesses) {
    return Math.floor((Math.max(0, diceCount) + autoSuccesses) / 2);
  }

  // --- Initiative ---

  /**
   * Parts of the initiative bonus (p. 109): Combat + Hayaiton (when unlocked) + 2 per
   * aspect called for initiative.
   * @param {object} sheet
   * @returns {{combat: number, hayaiton: number, aspects: number, total: number}}
   */
  function initiativeBonus(sheet) {
    const hayaitonNature = natureDef("hayaiton");
    const hayaiton = sheet.unlockedNatures.includes("hayaiton") ? natureLevel(sheet, hayaitonNature) : 0;
    const aspects = sheet.pendingAspects.filter((key) => key === "initiative").length * 2;
    const combat = sheet.stats.combat;
    return { combat, hayaiton, aspects, total: combat + hayaiton + aspects };
  }

  /**
   * Check a split of initiative tokens into piles (p. 109-110): every pile a different
   * size, all tokens used, and no more piles than actions (current énergie vitale).
   * @param {number[]} piles
   * @param {number} total
   * @param {number} maxPiles
   * @returns {{ok: boolean, errors: string[], sum: number}}
   */
  function validatePiles(piles, total, maxPiles) {
    const errors = [];
    const sum = piles.reduce((acc, pile) => acc + pile, 0);
    if (maxPiles <= 0) errors.push("Hors combat : aucune action possible ce tour.");
    if (piles.some((pile) => pile < 1)) errors.push("Chaque tas doit contenir au moins 1 jeton.");
    const duplicates = [...new Set(piles.filter((pile, index) => piles.indexOf(pile) !== index))];
    if (duplicates.length) errors.push(`Deux tas ne peuvent pas avoir la même taille (${duplicates.join(", ")}).`);
    if (sum !== total) {
      errors.push(sum < total ? `Il reste ${total - sum} jeton${total - sum > 1 ? "s" : ""} à placer.` : `${sum - total} jeton${sum - total > 1 ? "s" : ""} de trop.`);
    }
    if (maxPiles > 0 && piles.length > maxPiles) {
      errors.push(`${piles.length} tas, mais seulement ${maxPiles} action${maxPiles > 1 ? "s" : ""} possible${maxPiles > 1 ? "s" : ""} (énergie vitale actuelle).`);
    }
    return { ok: errors.length === 0 && piles.length > 0, errors, sum };
  }

  /**
   * A valid split that gives as many actions as possible: 1, 2, 3, ... k, the leftover
   * tokens going on the biggest pile (sizes stay different).
   * @param {number} total
   * @param {number} maxPiles
   * @returns {number[]} Ascending pile sizes.
   */
  function suggestPiles(total, maxPiles) {
    if (total <= 0 || maxPiles <= 0) return [];
    let count = 0;
    while (count < maxPiles && ((count + 1) * (count + 2)) / 2 <= total) count += 1;
    const piles = Array.from({ length: count }, (_, index) => index + 1);
    const leftover = total - (count * (count + 1)) / 2;
    piles[piles.length - 1] += leftover;
    return piles;
  }

  App.sheetCalc = {
    STAT_KEYS,
    ART_KEYS,
    ELEMENT_KEYS,
    ASPECT_KEYS,
    KG_NATURE_KEYS,
    generateSheetId,
    gradeRules,
    statDef,
    artDef,
    elementDef,
    natureDef,
    elementLabel,
    masteryIndex,
    masteryLevel,
    rankCost,
    masteryCostFromStart,
    createTechnique,
    createDefaultSheet,
    normalizeSheet,
    applyCreationDerivations,
    creationBudget,
    creationWarnings,
    countPositiveElements,
    natureLevel,
    elementValue,
    natureStatus,
    natureEffect,
    techniqueElementOptions,
    techniqueInfo,
    spentTotal,
    experienceSummary,
    statUpgrade,
    artUpgrade,
    vitalityUpgrade,
    chakraUpgrade,
    newTechniqueCost,
    masteryUpgrade,
    elementUpgrade,
    canAfford,
    equipmentList,
    equipmentBonus,
    rollD10,
    dieSuccesses,
    dieKind,
    countSuccesses,
    qualityFor,
    spontaneousDifficulty,
    initiativeBonus,
    validatePiles,
    suggestPiles,
  };
})();

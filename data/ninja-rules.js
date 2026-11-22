/**
 * Static rules of the character sheet ("fiche de ninja"), taken from the rulebook
 * "References/ShinobiNarutoJdr.pdf": creation p. 36-55, natures p. 50-58,
 * game system p. 105-115. Plain data only — every calculation lives in js/sheet-calc.js.
 * Plain script: attaches its data to the shared App namespace as App.ninjaRules.
 * No dependencies.
 */

(function () {
  "use strict";
  window.App = window.App || {};

  /** The four characteristics, in sheet order. Each one is 1..5 and has as many traits as its value. */
  const STATS = [
    { key: "combat", label: "Combat" },
    { key: "infiltration", label: "Infiltration" },
    { key: "perception", label: "Perception" },
    { key: "soutien", label: "Soutien" },
  ];
  const STAT_MIN = 1;
  const STAT_MAX = 5;

  /** The five ninja arts. `abbr` is the technique "Type" written on the sheet. */
  const ARTS = [
    { key: "ninjutsu", label: "Ninjutsu", abbr: "Nin" },
    { key: "taijutsu", label: "Taijutsu", abbr: "Tai" },
    { key: "genjutsu", label: "Genjutsu", abbr: "Gen" },
    { key: "fuinjutsu", label: "Fûinjutsu", abbr: "Fûin" },
    { key: "kuchiyose", label: "Kuchiyose", abbr: "Kuchi" },
  ];
  /** Arts reserved to Chûnin and above "sauf exception" (p. 37): a Genin only gets a warning. */
  const RESTRICTED_ARTS = ["fuinjutsu", "kuchiyose"];

  /**
   * Everything that depends on the grade. Creation budgets (p. 36-47) and the shop's
   * equipment cap (data/items.js). `second: null` = no second affinity for this grade.
   */
  const GRADE_RULES = {
    Genin: {
      statPoints: 8, artPoints: 12, artMax: 6, pa: 6, chakra: 20, vitality: 5,
      affinity: 1, second: null, weak: -2, other: -1, equipDice: 1, equipSuccesses: 0,
    },
    "Chûnin": {
      statPoints: 12, artPoints: 24, artMax: 9, pa: 18, chakra: 30, vitality: 10,
      affinity: 2, second: 0, weak: -2, other: -1, equipDice: 2, equipSuccesses: 0,
    },
    "Jônin": {
      statPoints: 16, artPoints: 48, artMax: 12, pa: 30, chakra: 40, vitality: 15,
      affinity: 3, second: 1, weak: -2, other: -1, equipDice: 3, equipSuccesses: 1,
    },
  };

  /**
   * The five base elements, in wheel order: each one dominates the next (p. 47, p. 111):
   * Feu > Vent > Foudre > Terre > Eau > Feu. `x`/`y`: position on the wheel (a regular
   * pentagon around the center 300,262 of the wheel's 600×510 drawing).
   */
  const ELEMENTS = [
    { key: "feu", label: "Feu", name: "Katon", color: "#e0431c", x: 300, y: 174 },
    { key: "vent", label: "Vent", name: "Fûton", color: "#1f9d6b", x: 384, y: 235 },
    { key: "foudre", label: "Foudre", name: "Raiton", color: "#b89200", x: 352, y: 333 },
    { key: "terre", label: "Terre", name: "Doton", color: "#8a5a2b", x: 248, y: 333 },
    { key: "eau", label: "Eau", name: "Suiton", color: "#2a74c9", x: 216, y: 235 },
  ];
  /** At most this many elements can be above 0 (p. 115). */
  const MAX_POSITIVE_ELEMENTS = 3;

  /** Element roles chosen at creation. "second" only exists from Chûnin up. */
  const ELEMENT_ROLES = [
    { key: "affinity", label: "Affinité" },
    { key: "second", label: "Seconde affinité" },
    { key: "weak", label: "Élément faible" },
  ];

  /** Technique ranks and their chakra cost (p. 42). */
  const TECHNIQUE_RANKS = [
    { key: "E", cost: 1 },
    { key: "D", cost: 2 },
    { key: "C", cost: 3 },
    { key: "B", cost: 4 },
    { key: "A", cost: 5 },
    { key: "S", cost: 6 },
  ];

  /**
   * Mastery levels, lowest first. `dice`/`successes` = effect on the roll;
   * `cost` = PA to reach this level from the previous one (p. 42, p. 115).
   * Learning a technique (Débutant) costs NEW_TECHNIQUE_COST; D -> S totals 9 PA.
   */
  const MASTERY_LEVELS = [
    { key: "D", label: "Débutant", dice: -2, successes: 0, cost: 0 },
    { key: "C", label: "Connue", dice: -1, successes: 0, cost: 1 },
    { key: "A", label: "Acquise", dice: 0, successes: 0, cost: 1 },
    { key: "M", label: "Maîtrisée", dice: 0, successes: 1, cost: 2 },
    { key: "P", label: "Perfectionnée", dice: 0, successes: 2, cost: 2 },
    { key: "S", label: "Sublimée", dice: 0, successes: 3, cost: 2 },
  ];
  const NEW_TECHNIQUE_COST = 1;

  /** Already written on the paper sheet. Free, Débutant by default (open point of the spec). */
  const STARTING_TECHNIQUES = [
    { name: "Henge – Métamorphose", art: "genjutsu", rank: "E" },
    { name: "Kawarimi – Substitution", art: "ninjutsu", rank: "E" },
    { name: "Bunshin – Clone", art: "genjutsu", rank: "E" },
  ];

  /** The six aspect categories, two fields each (p. 40-41). */
  const ASPECT_CATEGORIES = [
    { key: "reputations", label: "Réputations" },
    { key: "clan", label: "Clan" },
    { key: "personnalite", label: "Personnalité" },
    { key: "heredite", label: "Hérédité" },
    { key: "liens", label: "Liens" },
    { key: "autres", label: "Autres" },
  ];
  const ASPECTS_PER_CATEGORY = 2;
  /** Six aspects are enough to start playing (p. 40). */
  const ASPECTS_TO_START = 6;

  /** Calling an aspect (p. 107). */
  const ASPECT_POSITIVE_COST = 2;
  const ASPECT_NEGATIVE_GAIN = 2;
  /**
   * Effects of a positive call. `target` says what consumes it: the next dice roll, the
   * next initiative, or nothing (display only).
   */
  const ASPECT_EFFECTS = [
    { key: "successes", label: "+2 succès au prochain jet", short: "+2 succès", target: "roll" },
    { key: "initiative", label: "+2 à la prochaine initiative", short: "+2 initiative", target: "initiative" },
    { key: "ignore4", label: "Ignorer les 4 au prochain jet", short: "4 ignorés", target: "roll" },
    { key: "rerollFails", label: "Relancer tous les échecs (4 inclus) au prochain jet", short: "Relance des échecs", target: "roll" },
    { key: "ignoreWounds", label: "Ignorer le malus des blessures (rappel pour la table)", short: "Malus de blessures ignoré", target: "roll" },
    { key: "decree", label: "Décréter quelque chose sur un PNJ mineur (à annoncer au conteur)", short: "Décret sur un PNJ mineur", target: "display" },
  ];

  /**
   * Combined natures (p. 50-58). `kind`:
   *  - "sublime": base element positive + one technique of it at Sublimée.
   *  - "double":  two techniques at Perfectionnée or more, one of each element.
   *  - "triple":  the three elements positive + one technique at Maîtrisée or more in each.
   *  - "kg2":     Kekkei Genkai (two elements): Hérédité aspect + two Perfectionnée techniques.
   *  - "kg3":     Kekkei Tôta (three elements): Hérédité aspect + three Maîtrisée techniques.
   * `x`/`y` place the nature on the wheel (js/components/element-wheel.js), copied from
   * the paper sheet; Kekkei Genkai natures have no fixed spot (they go in the two slots).
   */
  const NATURES = [
    { key: "enton", name: "Enton", label: "Brasier", kind: "sublime", elements: ["feu"], x: 300, y: 97 },
    { key: "kutton", name: "Kutton", label: "Ciel & vide", kind: "sublime", elements: ["vent"], x: 457, y: 211 },
    { key: "denton", name: "Denton", label: "Éclairs noirs", kind: "sublime", elements: ["foudre"], x: 397, y: 395 },
    { key: "shoton", name: "Shôton", label: "Cristal", kind: "sublime", elements: ["terre"], x: 203, y: 395 },
    { key: "awaton", name: "Awaton", label: "Bulles", kind: "sublime", elements: ["eau"], x: 143, y: 211 },

    { key: "shakuton", name: "Shakuton", label: "Incinération", kind: "double", elements: ["feu", "vent"], x: 403, y: 120 },
    { key: "futton", name: "Futton", label: "Vapeur", kind: "double", elements: ["eau", "feu"], x: 197, y: 120 },
    { key: "saifoton", name: "Saifôton", label: "Siphon", kind: "double", elements: ["eau", "vent"], x: 300, y: 24 },
    { key: "yoton", name: "Yôton", label: "Lave", kind: "double", elements: ["terre", "feu"], x: 86, y: 153 },
    { key: "hiton", name: "Hiton", label: "Lumière", kind: "double", elements: ["foudre", "feu"], x: 514, y: 153 },
    { key: "nendoton", name: "Nendoton", label: "Argile", kind: "double", elements: ["terre", "eau"], x: 134, y: 316 },
    { key: "hayaiton", name: "Hayaiton", label: "Vitesse", kind: "double", elements: ["foudre", "vent"], x: 466, y: 316 },
    { key: "ranton", name: "Ranton", label: "Tempête", kind: "double", elements: ["foudre", "eau"], x: 149, y: 442 },
    { key: "bakuton", name: "Bakuton", label: "Explosion", kind: "double", elements: ["foudre", "terre"], x: 300, y: 437 },
    { key: "sunaton", name: "Sunaton", label: "Sable", kind: "double", elements: ["terre", "vent"], x: 451, y: 442 },

    { key: "jiton", name: "Jiton", label: "Magnétisme", kind: "triple", elements: ["terre", "foudre", "vent"], x: 300, y: 262 },

    { key: "mokuton", name: "Mokuton", label: "Bois", kind: "kg2", elements: ["terre", "eau"] },
    { key: "hyoton", name: "Hyôton", label: "Glace", kind: "kg2", elements: ["vent", "eau"] },
    { key: "kennaiton", name: "Kennaiton", label: "Sphère", kind: "kg2", elements: ["foudre", "eau"] },
    { key: "jinton", name: "Jinton", label: "Poussière", kind: "kg3", elements: ["terre", "vent", "feu"], note: "Coût en chakra des techniques : +3." },
    { key: "meiton", name: "Meiton", label: "Ténèbres", kind: "kg3", elements: ["terre", "foudre", "feu"] },
    { key: "inkuton", name: "Inkuton", label: "Encre", kind: "kg3", elements: ["terre", "eau", "feu"] },
    { key: "shikotsumyaku", name: "Shikotsumyaku", label: "Os", kind: "kg3", elements: ["eau", "terre", "vent"] },
  ];

  /** Label and on-roll effect shown for each kind of nature. */
  const NATURE_KINDS = {
    sublime: { label: "Nature sublimée", effect: "Chaque succès de marge compte double." },
    double: { label: "Nature double", effect: "" },
    triple: { label: "Nature triple", effect: "2 blessures par succès de marge." },
    kg2: { label: "Kekkei Genkai", effect: "2 blessures par succès de marge." },
    kg3: { label: "Kekkei Tôta", effect: "2 blessures par succès de marge." },
  };
  /** Per-nature effects that override the kind's default. */
  const NATURE_EFFECTS = {
    hayaiton: "Sa valeur s'ajoute à l'initiative.",
    nendoton: "Soin : 1 point d'énergie vitale par succès (Soutien + Ninjutsu).",
  };
  /** Two Kekkei Genkai slots on the sheet; only the first can be filled at creation. */
  const KEKKEI_GENKAI_SLOTS = 2;

  /** Quality of the result, by total successes (p. 106). */
  const QUALITY_LEVELS = [
    { min: -Infinity, label: "Lamentable", difficulty: "Échec critique" },
    { min: 0, label: "Médiocre", difficulty: "Échec" },
    { min: 1, label: "Moyenne", difficulty: "Moyen" },
    { min: 3, label: "Honnête", difficulty: "Ardu" },
    { min: 6, label: "Bonne", difficulty: "Difficile" },
    { min: 10, label: "Grande", difficulty: "Grandiose" },
    { min: 15, label: "Excellente", difficulty: "Héroïque" },
    { min: 20, label: "Superbe", difficulty: "Surhumain" },
    { min: 25, label: "Fantastique", difficulty: "Épique" },
    { min: 30, label: "Légendaire", difficulty: "Divin" },
  ];

  /** Quick manual adjustments offered by the dice launcher (p. 111, p. 113). */
  const ROLL_ADJUSTMENT_PRESETS = [
    { label: "Mi-distance", value: -5, title: "Technique de corps à corps à mi-distance (5 à 50 m) : −5 succès" },
    { label: "Longue distance", value: -10, title: "Technique de corps à corps à longue distance (50 m et plus) : −10 succès" },
    { label: "Domination", value: 5, title: "Élément dominant contre l'élément dominé : +5 succès" },
  ];

  /** Progression costs (p. 115). */
  const PROGRESSION = {
    /** PX to raise a characteristic: target level × 2. */
    statCostFactor: 2,
    /** PX to raise an art: target level × 1. */
    artCostFactor: 1,
    vitalityCostPx: 4,
    vitalityGain: 1,
    chakraCostPa: 1,
    chakraGain: 2,
  };

  /** The legendary weapon bonus (shop rules, data/items.js): replaces the grade cap. */
  const LEGENDARY_BONUS = { dice: 3, successes: 2 };

  /** How many dice rolls the sheet remembers. */
  const ROLL_HISTORY_SIZE = 10;

  App.ninjaRules = {
    STATS,
    STAT_MIN,
    STAT_MAX,
    ARTS,
    RESTRICTED_ARTS,
    GRADE_RULES,
    ELEMENTS,
    MAX_POSITIVE_ELEMENTS,
    ELEMENT_ROLES,
    TECHNIQUE_RANKS,
    MASTERY_LEVELS,
    NEW_TECHNIQUE_COST,
    STARTING_TECHNIQUES,
    ASPECT_CATEGORIES,
    ASPECTS_PER_CATEGORY,
    ASPECTS_TO_START,
    ASPECT_POSITIVE_COST,
    ASPECT_NEGATIVE_GAIN,
    ASPECT_EFFECTS,
    NATURES,
    NATURE_KINDS,
    NATURE_EFFECTS,
    KEKKEI_GENKAI_SLOTS,
    QUALITY_LEVELS,
    ROLL_ADJUSTMENT_PRESETS,
    PROGRESSION,
    LEGENDARY_BONUS,
    ROLL_HISTORY_SIZE,
  };
})();

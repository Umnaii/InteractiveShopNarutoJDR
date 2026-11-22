/**
 * Full shinobi shop catalogue, from the "Système d'argent — JDR Naruto" rules.
 * Plain script (no build step): attaches its data to the shared App namespace
 * as App.items. Must be loaded before any script that reads App.items.
 *
 * Equipment rule (applies to every bonus item): any number of items can be carried,
 * but the total bonus per characteristic is capped by the PJ's rank
 * (Genin +1 dé, Chûnin +2 dés, Jônin +3 dés et +1 succès). An item can be bought
 * above the cap, but only the cap counts. Legendary weapons replace the cap instead.
 *
 * @typedef {Object} Item
 * @property {string} id - Stable kebab-case slug, e.g. "wakizashi-acier".
 * @property {string} name - French display name.
 * @property {string} category - Single letter "A".."G", matches CATEGORY_LABELS.
 * @property {number} rarity - Integer 1..5 (star count).
 * @property {number|{min:number,max:number}|null} price - Ryo price, a range, or null when hors-commerce/non vendu.
 * @property {string} priceLabel - Raw French price string, exactly as shown to players.
 * @property {{quantity:number,price:number}} [bulk] - Optional bulk-pack discount. Applied
 *   automatically by economy.js when the purchased quantity reaches `quantity`.
 * @property {"consommable"|"permanent"|"restreint"|"intrigue"} type
 * @property {string} usage - French conditions of use.
 * @property {string} effect - French mechanical effect text.
 * @property {boolean} purchasable - False for items that can't be bought (legendary weapons).
 * @property {boolean} gmOnly - True for items only the GM should see.
 */

(function () {
  "use strict";
  window.App = window.App || {};

  /** Category letter -> French section label, in catalogue order. */
  const CATEGORY_LABELS = {
    A: "Combat",
    B: "Infiltration",
    C: "Perception",
    D: "Soutien",
    E: "Armes de jet",
    F: "Parchemins et informations",
    G: "Armes légendaires",
  };

  const CAP_USAGE = "Bonus plafonné selon le rang (Genin +1 dé, Chûnin +2 dés, Jônin +3 dés et +1 succès).";

  /**
   * Build a bonus-equipment entry (sections A..D): permanent, purchasable, rank-capped.
   * @param {string} id
   * @param {string} name
   * @param {string} category
   * @param {number} rarity
   * @param {number} price
   * @param {string} priceLabel
   * @param {string} effect
   * @returns {Item}
   */
  function equipment(id, name, category, rarity, price, priceLabel, effect) {
    return {
      id,
      name,
      category,
      rarity,
      price,
      priceLabel,
      type: "permanent",
      usage: `Équipement, utilisable quand la situation s'y prête. ${CAP_USAGE}`,
      effect,
      purchasable: true,
      gmOnly: false,
    };
  }

  /** @type {Item[]} */
  const ITEMS = [
    // A. Combat
    equipment("wakizashi-acier", "Wakizashi d'acier", "A", 2, 15000, "15 000",
      "+1 dé en Combat avec la lame."),
    equipment("gantelets-renforces", "Gantelets renforcés", "A", 2, 25000, "25 000",
      "+1 dé en Combat à mains nues."),
    equipment("katana-forgeron-renomme", "Katana de forgeron renommé", "A", 3, 90000, "90 000",
      "+2 dés en Combat avec la lame."),
    equipment("plastron-chakra-acier", "Plastron en chakra-acier", "A", 3, 140000, "140 000",
      "+2 dés en Combat."),
    equipment("lames-conductrices-chakra", "Lames conductrices de chakra", "A", 4, 350000, "350 000",
      "+2 dés et +1 succès en Combat ; le chakra prolonge la lame, avec n'importe quel art ninja."),
    equipment("sabre-maitre-armes", "Sabre de maître d'armes", "A", 4, 500000, "500 000",
      "+2 dés et +1 succès en Combat avec la lame."),

    // B. Infiltration
    equipment("tenue-camouflage", "Tenue de camouflage", "B", 2, 10000, "10 000",
      "+1 dé en Infiltration en terrain naturel."),
    equipment("malle-deguisements", "Malle de déguisements", "B", 2, 18000, "18 000",
      "+1 dé en Infiltration pour se faire passer pour quelqu'un d'autre et baratiner."),
    equipment("manteau-brume", "Manteau de brume", "B", 3, 70000, "70 000",
      "+2 dés en Infiltration de nuit ou dans le brouillard."),
    equipment("semelles-silencieuses", "Semelles silencieuses", "B", 3, 120000, "120 000",
      "+2 dés en Infiltration pour se déplacer sans bruit."),
    equipment("manteau-ombre", "Manteau d'ombre", "B", 4, 280000, "280 000",
      "+2 dés et +1 succès en Infiltration."),

    // C. Perception
    equipment("jumelles-campagne", "Jumelles de campagne", "C", 2, 12000, "12 000",
      "+1 dé en Perception pour observer à distance."),
    equipment("kit-pistage", "Kit de pistage", "C", 2, 22000, "22 000",
      "+1 dé en Perception pour suivre des traces."),
    equipment("lentilles-reperage", "Lentilles de repérage", "C", 3, 80000, "80 000",
      "+2 dés en Perception pour repérer à distance."),
    equipment("detecteur-sceaux", "Détecteur de sceaux", "C", 3, 130000, "130 000",
      "+2 dés en Perception pour déceler pièges et sceaux."),
    equipment("lorgnon-chasseur-primes", "Lorgnon de chasseur de primes", "C", 4, 300000, "300 000",
      "+2 dés et +1 succès en Perception pour identifier une cible."),

    // D. Soutien
    equipment("trousse-soin-campagne", "Trousse de soin de campagne", "D", 2, 15000, "15 000",
      "+1 dé en Soutien pour les premiers soins."),
    equipment("sacoche-atelier", "Sacoche d'atelier", "D", 2, 20000, "20 000",
      "+1 dé en Soutien pour réparer et préparer le matériel."),
    equipment("mallette-soins-complete", "Mallette de soins complète", "D", 3, 85000, "85 000",
      "+2 dés en Soutien pour soigner une blessure."),
    equipment("oiseau-messager-dresse", "Oiseau messager dressé", "D", 3, 110000, "110 000",
      "+2 dés en Soutien pour coordonner l'équipe à distance."),
    equipment("mallette-medecin-ninja-elite", "Mallette de médecin-ninja d'élite", "D", 4, 260000, "260 000",
      "+2 dés et +1 succès en Soutien pour les soins."),

    // E. Armes de jet (aucun bonus, munitions comptées)
    {
      id: "pack-kunai",
      name: "Pack de 5 kunai",
      category: "E",
      rarity: 1,
      price: 1500,
      priceLabel: "1 500 le pack de 5",
      type: "consommable",
      usage: "Jet sans art ninja. Les munitions se comptent.",
      effect: "Jet avec la seule caractéristique Combat. Aucun bonus.",
      purchasable: true,
      gmOnly: false,
    },
    {
      id: "pack-shuriken",
      name: "Pack de 5 shuriken",
      category: "E",
      rarity: 1,
      price: 1500,
      priceLabel: "1 500 le pack de 5",
      type: "consommable",
      usage: "Jet sans art ninja. Les munitions se comptent.",
      effect: "Jet avec la seule caractéristique Combat. Aucun bonus.",
      purchasable: true,
      gmOnly: false,
    },

    // F. Parchemins et informations
    {
      id: "parchemin-technique-base",
      name: "Parchemin de technique de base",
      category: "F",
      rarity: 2,
      price: 30000,
      priceLabel: "30 000",
      type: "consommable",
      usage: "Usage unique.",
      effect: "Débloque une technique de niveau de base.",
      purchasable: true,
      gmOnly: false,
    },
    {
      id: "informateur-fiable",
      name: "Informateur fiable",
      category: "F",
      rarity: 3,
      price: 60000,
      priceLabel: "60 000",
      type: "consommable",
      usage: "Usage unique.",
      effect: "Une information fiable sur une cible ou un lieu.",
      purchasable: true,
      gmOnly: false,
    },
    {
      id: "parchemin-technique-intermediaire",
      name: "Parchemin de technique intermédiaire",
      category: "F",
      rarity: 3,
      price: 150000,
      priceLabel: "150 000",
      type: "consommable",
      usage: "Usage unique.",
      effect: "Débloque une technique de niveau intermédiaire.",
      purchasable: true,
      gmOnly: false,
    },
    {
      id: "grande-information",
      name: "Grande information",
      category: "F",
      rarity: 4,
      price: 400000,
      priceLabel: "400 000",
      type: "consommable",
      usage: "Usage unique.",
      effect: "Une information majeure (cache d'un ennemi, plan d'un village).",
      purchasable: true,
      gmOnly: false,
    },
    {
      id: "parchemin-technique-avancee",
      name: "Parchemin de technique avancée",
      category: "F",
      rarity: 4,
      price: 600000,
      priceLabel: "600 000",
      type: "consommable",
      usage: "Usage unique.",
      effect: "Débloque une technique de niveau avancé.",
      purchasable: true,
      gmOnly: false,
    },

    // G. Armes légendaires (ne s'achètent pas : butin, don d'un village, vol)
    ...[
      ["lorgnon-du-sage", "Lorgnon du Sage", 15000000, "15 000 000", "Perception"],
      ["trousse-sannin-soigneur", "Trousse du Sannin soigneur", 18000000, "18 000 000", "Soutien"],
      ["kubikiribocho", "Kubikiribōchō, le hachoir géant de Kiri", 25000000, "25 000 000", "Combat"],
      ["samehada", "Samehada, l'épée qui dévore le chakra", 40000000, "40 000 000", "Combat"],
      ["kunai-dieu-tonnerre", "Kunai du Dieu du Tonnerre", 80000000, "80 000 000", "Infiltration"],
      ["kusanagi", "Kusanagi, l'épée de légende", 120000000, "120 000 000", "Combat"],
    ].map(([id, name, price, priceLabel, stat]) => ({
      id,
      name,
      category: "G",
      rarity: 5,
      price,
      priceLabel: `${priceLabel} (hors-commerce)`,
      type: "intrigue",
      usage: "Ne s'achète pas : s'obtient par le scénario (butin, don d'un village, vol). Un PJ n'en porte qu'une.",
      effect: `+3 dés et +2 succès en ${stat}. Remplace le plafond du rang : aucun autre objet ne s'ajoute en ${stat}.`,
      purchasable: false,
      gmOnly: false,
    })),
  ];

  App.items = { ITEMS, CATEGORY_LABELS };
})();

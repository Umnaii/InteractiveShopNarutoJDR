/**
 * Rarity legend, extracted from boutique_shinobi_catalogue.md, section 2.
 * Rarity is not just a price: it says where and from whom the item can be obtained.
 * Plain script: attaches its data to the shared App namespace as App.rarities.
 *
 * @typedef {Object} RarityTier
 * @property {number} stars - 1..5.
 * @property {string} label - Star glyphs, e.g. "★★★".
 * @property {string} whereToFind - French text: where the item can be found.
 * @property {string} meaning - French text: what that difficulty represents.
 */

(function () {
  "use strict";
  window.App = window.App || {};

  /** @type {RarityTier[]} */
  const RARITY_TIERS = [
    {
      stars: 1,
      label: "★",
      whereToFind: "Armurerie et intendance de base de tout village, académie, échoppes civiles.",
      meaning: "Achat immédiat, aucune difficulté. Matériel courant du ninja.",
    },
    {
      stars: 2,
      label: "★★",
      whereToFind: "Boutique ninja spécialisée du village, corps du génie, intendance militaire.",
      meaning: "Disponible sur place mais réservé aux ninjas en service.",
    },
    {
      stars: 3,
      label: "★★★",
      whereToFind: "Artisans réputés, fournisseurs agréés, sur commande, ou obtenu en butin de mission.",
      meaning: "Demande un déplacement, une réputation, du délai ou de la chance. La boutique du village s'arrête ici.",
    },
    {
      stars: 4,
      label: "★★★★",
      whereToFind: "Marché noir (Fuzen Machi), spécialistes de clan, butin de missions de rang A ou S.",
      meaning: "Contacts illégaux ou hauts faits. Souvent risqué à acquérir comme à posséder.",
    },
    {
      stars: 5,
      label: "★★★★★",
      whereToFind: "Hors-commerce : reliques, transmissions de clan, pactes, armes nommées.",
      meaning: "Ne s'achète pas : se gagne en scénario. Le prix indiqué n'est qu'un ordre de grandeur si l'objet réapparaît un jour sur un marché.",
    },
  ];

  /** Closing note from the catalogue's rarity legend. */
  const RARITY_NOTE =
    "Un même objet peut monter d'une étoile s'il est cherché hors de son contexte (une veste de Chûnin pour un Genin, un masque ANBU en réplique, une tenue de désert achetée à Kiri…).";

  App.rarities = { RARITY_TIERS, RARITY_NOTE };
})();

/**
 * Mission payout rules, extracted from the campaign's homebrew economy.
 * Plain script: attaches its data to the shared App namespace as App.missions.
 *
 * @typedef {Object} MissionRank
 * @property {string} rank - "D" | "C" | "B" | "A" | "S".
 * @property {number} defaultReward - Default total Ryo reward for this rank.
 * @property {number} min - Minimum Ryo in the typical range.
 * @property {number|null} max - Maximum Ryo in the typical range, or null for an open-ended range (e.g. "S: 1 000 000+").
 */

(function () {
  "use strict";
  window.App = window.App || {};

  /** @type {MissionRank[]} */
  const MISSION_RANKS = [
    { rank: "D", defaultReward: 20000, min: 5000, max: 50000 },
    { rank: "C", defaultReward: 60000, min: 30000, max: 100000 },
    { rank: "B", defaultReward: 130000, min: 80000, max: 200000 },
    { rank: "A", defaultReward: 400000, min: 150000, max: 1000000 },
    { rank: "S", defaultReward: 1500000, min: 1000000, max: null },
  ];

  /** Fraction of the gross mission reward kept by the village. */
  const VILLAGE_CUT_RATE = 0.15;

  /** Default number of ninja splitting a mission's net reward. */
  const DEFAULT_PARTY_SIZE = 6;

  /** Share multiplier applied to the team leader when the "leader bonus" is enabled. */
  const LEADER_SHARE_MULTIPLIER = 1.5;

  /**
   * Look up a mission rank's payout rules by its letter.
   * @param {string} rank - "D" | "C" | "B" | "A" | "S".
   * @returns {MissionRank|undefined}
   */
  function getMissionRank(rank) {
    return MISSION_RANKS.find((entry) => entry.rank === rank);
  }

  App.missions = { MISSION_RANKS, VILLAGE_CUT_RATE, DEFAULT_PARTY_SIZE, LEADER_SHARE_MULTIPLIER, getMissionRank };
})();

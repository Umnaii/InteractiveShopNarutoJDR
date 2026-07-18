/**
 * All Ryo money math lives here: purchases, resales, manual adjustments and
 * mission payout arithmetic. No other module may mutate a profile's balance,
 * inventory or transaction history.
 * Plain script: attaches its API to the shared App namespace as App.economy.
 * Depends on App.items, App.missions, App.state, App.profiles (must be loaded first).
 */

(function () {
  "use strict";
  window.App = window.App || {};

  const { ITEMS } = App.items;
  const { VILLAGE_CUT_RATE, LEADER_SHARE_MULTIPLIER } = App.missions;
  const { getProfiles, setProfiles } = App.state;
  const { getProfileById } = App.profiles;

  /**
   * Look up a catalogue item by id.
   * @param {string} itemId
   * @returns {object|null}
   */
  function getItemById(itemId) {
    return ITEMS.find((item) => item.id === itemId) ?? null;
  }

  /**
   * Resolve a single, concrete Ryo price for an item, used for purchase/resale math.
   * Ranged prices resolve to their lower bound; hors-commerce items resolve to 0.
   * @param {object} item
   * @returns {number}
   */
  function getItemUnitPrice(item) {
    if (item.price === null || item.price === undefined) return 0;
    if (typeof item.price === "number") return item.price;
    return item.price.min;
  }

  /**
   * Total Ryo price for buying a given quantity of an item, automatically applying the
   * catalogue's bulk-pack discount (item.bulk, e.g. shuriken: 5 for 450 instead of 5x100)
   * as many times as it fits, with any remainder priced per unit. This is the only place
   * that should compute what a purchase costs — views must not multiply price by quantity
   * themselves, or they'll silently skip the discount.
   * @param {object} item
   * @param {number} quantity
   * @returns {number}
   */
  function getItemTotalPrice(item, quantity) {
    const unitPrice = getItemUnitPrice(item);
    if (!item.bulk || quantity < item.bulk.quantity) {
      return unitPrice * quantity;
    }
    const packCount = Math.floor(quantity / item.bulk.quantity);
    const remainder = quantity % item.bulk.quantity;
    return packCount * item.bulk.price + remainder * unitPrice;
  }

  /**
   * Generate a reasonably unique transaction id.
   * @returns {string}
   */
  function generateTransactionId() {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return `txn-${crypto.randomUUID()}`;
    }
    return `txn-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  /**
   * Build a transaction record.
   * @param {"purchase"|"resale"|"mission"|"adjustment"} kind
   * @param {number} amount
   * @param {string} reason
   * @returns {object}
   */
  function createTransaction(kind, amount, reason) {
    return { id: generateTransactionId(), timestamp: Date.now(), kind, amount, reason };
  }

  /**
   * Replace one profile in the profiles array and persist the whole array.
   * @param {object} updatedProfile
   * @returns {void}
   */
  function commitProfile(updatedProfile) {
    setProfiles(getProfiles().map((profile) => (profile.id === updatedProfile.id ? updatedProfile : profile)));
  }

  /**
   * Purchase an item into a profile's inventory, deducting its price from the balance.
   * @param {string} profileId
   * @param {string} itemId
   * @param {number} [quantity]
   * @returns {{ok: boolean, message?: string}}
   */
  function purchaseItem(profileId, itemId, quantity) {
    quantity = quantity === undefined ? 1 : quantity;
    const profile = getProfileById(profileId);
    if (!profile) return { ok: false, message: "Profil introuvable." };

    const item = getItemById(itemId);
    if (!item) return { ok: false, message: "Objet introuvable." };

    if (!item.purchasable) {
      return { ok: false, message: `« ${item.name} » est hors-commerce et ne peut pas être acheté.` };
    }

    const qty = Math.max(1, Math.floor(quantity));
    const totalPrice = getItemTotalPrice(item, qty);

    if (profile.balance < totalPrice) {
      return { ok: false, message: `Fonds insuffisants : « ${item.name} » coûte ${totalPrice} Ryo, solde actuel ${profile.balance} Ryo.` };
    }

    const existingEntry = profile.inventory.find((entry) => entry.itemId === itemId);
    const inventory = existingEntry
      ? profile.inventory.map((entry) => (entry.itemId === itemId ? { ...entry, quantity: entry.quantity + qty } : entry))
      : [...profile.inventory, { itemId, quantity: qty }];

    const transaction = createTransaction("purchase", -totalPrice, `Achat : ${item.name} ×${qty}`);

    commitProfile({
      ...profile,
      balance: profile.balance - totalPrice,
      inventory,
      history: [transaction, ...profile.history],
    });

    return { ok: true };
  }

  /**
   * Resell owned units of an item back for 50% of its purchase price.
   * @param {string} profileId
   * @param {string} itemId
   * @param {number} [quantity]
   * @returns {{ok: boolean, message?: string}}
   */
  function resellItem(profileId, itemId, quantity) {
    quantity = quantity === undefined ? 1 : quantity;
    const profile = getProfileById(profileId);
    if (!profile) return { ok: false, message: "Profil introuvable." };

    const item = getItemById(itemId);
    if (!item) return { ok: false, message: "Objet introuvable." };

    const qty = Math.max(1, Math.floor(quantity));
    const entry = profile.inventory.find((inv) => inv.itemId === itemId);
    if (!entry || entry.quantity < qty) {
      return { ok: false, message: `« ${item.name} » n'est pas possédé en quantité suffisante.` };
    }

    const resaleValue = Math.round(getItemUnitPrice(item) * 0.5) * qty;
    const inventory = profile.inventory
      .map((inv) => (inv.itemId === itemId ? { ...inv, quantity: inv.quantity - qty } : inv))
      .filter((inv) => inv.quantity > 0);

    const transaction = createTransaction("resale", resaleValue, `Revente : ${item.name} ×${qty}`);

    commitProfile({
      ...profile,
      balance: profile.balance + resaleValue,
      inventory,
      history: [transaction, ...profile.history],
    });

    return { ok: true };
  }

  /**
   * Consume/remove owned units of an item without any Ryo refund (e.g. using a consumable).
   * @param {string} profileId
   * @param {string} itemId
   * @param {number} [quantity]
   * @returns {{ok: boolean, message?: string}}
   */
  function consumeItem(profileId, itemId, quantity) {
    quantity = quantity === undefined ? 1 : quantity;
    const profile = getProfileById(profileId);
    if (!profile) return { ok: false, message: "Profil introuvable." };

    const item = getItemById(itemId);
    if (!item) return { ok: false, message: "Objet introuvable." };

    const qty = Math.max(1, Math.floor(quantity));
    const entry = profile.inventory.find((inv) => inv.itemId === itemId);
    if (!entry || entry.quantity < qty) {
      return { ok: false, message: `« ${item.name} » n'est pas possédé en quantité suffisante.` };
    }

    const inventory = profile.inventory
      .map((inv) => (inv.itemId === itemId ? { ...inv, quantity: inv.quantity - qty } : inv))
      .filter((inv) => inv.quantity > 0);

    commitProfile({ ...profile, inventory });
    return { ok: true };
  }

  /**
   * Apply a manual GM balance adjustment (e.g. a ruling, a fine, a found pouch of Ryo).
   * @param {string} profileId
   * @param {number} amount - Signed Ryo delta.
   * @param {string} reason
   * @returns {{ok: boolean, message?: string}}
   */
  function adjustBalance(profileId, amount, reason) {
    const profile = getProfileById(profileId);
    if (!profile) return { ok: false, message: "Profil introuvable." };

    const delta = Math.round(amount);
    if (!delta) return { ok: false, message: "Le montant de l'ajustement ne peut pas être nul." };
    if (profile.balance + delta < 0) {
      return { ok: false, message: "Cet ajustement rendrait le solde négatif." };
    }

    const trimmedReason = (reason ?? "").trim() || "Ajustement du conteur";
    const transaction = createTransaction("adjustment", delta, trimmedReason);

    commitProfile({
      ...profile,
      balance: profile.balance + delta,
      history: [transaction, ...profile.history],
    });

    return { ok: true };
  }

  /**
   * Total resale value of a profile's whole inventory (50% of each item's unit price).
   * @param {object} profile
   * @returns {number}
   */
  function getInventoryValue(profile) {
    return profile.inventory.reduce((total, entry) => {
      const item = getItemById(entry.itemId);
      if (!item) return total;
      return total + Math.round(getItemUnitPrice(item) * 0.5) * entry.quantity;
    }, 0);
  }

  /**
   * @typedef {Object} MissionPayoutInput
   * @property {string} rank - "D" | "C" | "B" | "A" | "S".
   * @property {number} totalReward - Gross Ryo reward before the village cut.
   * @property {number} partySize - Number of participating ninja.
   * @property {boolean} leaderBonus - Whether the team leader gets 1.5 shares.
   */

  /**
   * @typedef {Object} MissionPayoutBreakdown
   * @property {number} gross
   * @property {number} villageCut
   * @property {number} net
   * @property {number} partySize
   * @property {boolean} leaderBonus
   * @property {number} shareEach - Share for a regular member (or everyone, if no leader bonus).
   * @property {number|null} leaderShare - Leader's share, or null if leaderBonus is false.
   */

  /**
   * Compute the gross -> village cut -> net -> per-ninja breakdown of a mission reward.
   * Pure function: does not touch state or storage.
   * @param {MissionPayoutInput} input
   * @returns {MissionPayoutBreakdown}
   */
  function computeMissionPayout({ rank, totalReward, partySize, leaderBonus }) {
    const gross = Math.max(0, Math.round(totalReward));
    const villageCut = Math.round(gross * VILLAGE_CUT_RATE);
    const net = gross - villageCut;
    const size = Math.max(1, Math.floor(partySize));

    if (leaderBonus && size > 1) {
      const totalShares = size - 1 + LEADER_SHARE_MULTIPLIER;
      const shareUnit = net / totalShares;
      return {
        gross,
        villageCut,
        net,
        partySize: size,
        leaderBonus: true,
        shareEach: Math.round(shareUnit),
        leaderShare: Math.round(shareUnit * LEADER_SHARE_MULTIPLIER),
      };
    }

    return {
      gross,
      villageCut,
      net,
      partySize: size,
      leaderBonus: false,
      shareEach: Math.round(net / size),
      leaderShare: null,
    };
  }

  /**
   * Credit a computed mission payout to one or more profiles in a single call,
   * logging one transaction per profile.
   * @param {string[]} profileIds
   * @param {MissionPayoutBreakdown} breakdown
   * @param {string} rank
   * @param {string|null} leaderProfileId
   * @returns {{ok: boolean, message?: string}}
   */
  function creditMissionPayout(profileIds, breakdown, rank, leaderProfileId) {
    if (!profileIds.length) {
      return { ok: false, message: "Sélectionnez au moins un profil à créditer." };
    }

    const profiles = getProfiles();
    const updated = profiles.map((profile) => {
      if (!profileIds.includes(profile.id)) return profile;

      const isLeader = breakdown.leaderBonus && profile.id === leaderProfileId;
      const share = isLeader ? breakdown.leaderShare : breakdown.shareEach;
      const label = isLeader ? " (chef d'équipe)" : "";
      const transaction = createTransaction("mission", share, `Mission de rang ${rank}${label} : part de mission`);

      return {
        ...profile,
        balance: profile.balance + share,
        history: [transaction, ...profile.history],
      };
    });

    setProfiles(updated);
    return { ok: true };
  }

  App.economy = {
    getItemById,
    getItemUnitPrice,
    getItemTotalPrice,
    purchaseItem,
    resellItem,
    consumeItem,
    adjustBalance,
    getInventoryValue,
    computeMissionPayout,
    creditMissionPayout,
  };
})();

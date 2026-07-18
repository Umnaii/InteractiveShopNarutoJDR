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
  const { getProfiles, setProfiles, getMissionLog, setMissionLog } = App.state;
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
   * Generate a reasonably unique id, prefixed for readability in storage/debugging.
   * @param {string} prefix
   * @returns {string}
   */
  function generateEconomyId(prefix) {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return `${prefix}-${crypto.randomUUID()}`;
    }
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  /**
   * Build a transaction record. `itemId`/`quantity` are only set for purchase/resale
   * transactions, so later code (e.g. undoLastPurchase) can identify exactly which
   * purchase to reverse without having to parse the French `reason` text.
   * @param {"purchase"|"resale"|"mission"|"adjustment"|"undo"} kind
   * @param {number} amount
   * @param {string} reason
   * @param {{itemId?: string, quantity?: number}} [meta]
   * @returns {object}
   */
  function createTransaction(kind, amount, reason, meta) {
    return { id: generateEconomyId("txn"), timestamp: Date.now(), kind, amount, reason, ...meta };
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

    const transaction = createTransaction("purchase", -totalPrice, `Achat : ${item.name} ×${qty}`, { itemId, quantity: qty });

    commitProfile({
      ...profile,
      balance: profile.balance - totalPrice,
      inventory,
      history: [transaction, ...profile.history],
    });

    return { ok: true };
  }

  /**
   * Purchase every line of a cart (itemId + quantity) for a profile in a single atomic
   * operation: the whole cart is validated (existence, purchasability, affordability of
   * the combined total) before anything is committed, so a single unaffordable line can't
   * leave the profile partially charged. Logs one "purchase" transaction per line, so
   * per-item undo (undoLastPurchase) and the transaction history read exactly as if each
   * line had been bought individually.
   * @param {string} profileId
   * @param {{itemId: string, quantity: number}[]} lines
   * @returns {{ok: boolean, message?: string}}
   */
  function purchaseCart(profileId, lines) {
    const profile = getProfileById(profileId);
    if (!profile) return { ok: false, message: "Profil introuvable." };
    if (!lines || !lines.length) return { ok: false, message: "Le panier est vide." };

    const resolved = [];
    for (const line of lines) {
      const item = getItemById(line.itemId);
      if (!item) return { ok: false, message: "Un objet du panier est introuvable." };
      if (!item.purchasable) {
        return { ok: false, message: `« ${item.name} » est hors-commerce et ne peut pas être acheté.` };
      }
      const qty = Math.max(1, Math.floor(line.quantity));
      resolved.push({ item, qty, total: getItemTotalPrice(item, qty) });
    }

    const grandTotal = resolved.reduce((sum, { total }) => sum + total, 0);
    if (profile.balance < grandTotal) {
      return { ok: false, message: `Fonds insuffisants : le panier coûte ${grandTotal} Ryo, solde actuel ${profile.balance} Ryo.` };
    }

    let inventory = profile.inventory;
    const transactions = [];
    for (const { item, qty, total } of resolved) {
      const existingEntry = inventory.find((entry) => entry.itemId === item.id);
      inventory = existingEntry
        ? inventory.map((entry) => (entry.itemId === item.id ? { ...entry, quantity: entry.quantity + qty } : entry))
        : [...inventory, { itemId: item.id, quantity: qty }];
      transactions.push(createTransaction("purchase", -total, `Achat : ${item.name} ×${qty}`, { itemId: item.id, quantity: qty }));
    }

    commitProfile({
      ...profile,
      balance: profile.balance - grandTotal,
      inventory,
      history: [...transactions, ...profile.history],
    });

    return { ok: true };
  }

  /**
   * Undo the most recent still-reversible purchase of a given item for a profile,
   * fully refunding it and removing the exact quantity purchased. Unlike resellItem
   * (which pays out only 50% of the price), this reverses a specific purchase outright,
   * for the "I bought the wrong thing" case. Only the original purchase transaction is
   * removed from history (replaced by an "undo" record); it never touches other
   * purchases of the same item, so calling it repeatedly walks back one purchase at a
   * time. Refuses if that purchase's items have since been partially resold/consumed
   * (inventory would go negative), since there's nothing consistent left to undo.
   * @param {string} profileId
   * @param {string} itemId
   * @returns {{ok: boolean, message?: string}}
   */
  function undoLastPurchase(profileId, itemId) {
    const profile = getProfileById(profileId);
    if (!profile) return { ok: false, message: "Profil introuvable." };

    const item = getItemById(itemId);
    if (!item) return { ok: false, message: "Objet introuvable." };

    const lastPurchase = profile.history.find((entry) => entry.kind === "purchase" && entry.itemId === itemId);
    if (!lastPurchase) {
      return { ok: false, message: `Aucun achat de « ${item.name} » à annuler.` };
    }

    const owned = profile.inventory.find((entry) => entry.itemId === itemId);
    if (!owned || owned.quantity < lastPurchase.quantity) {
      return { ok: false, message: `« ${item.name} » a déjà été revendu ou consommé : cet achat ne peut plus être annulé.` };
    }

    const inventory = profile.inventory
      .map((entry) => (entry.itemId === itemId ? { ...entry, quantity: entry.quantity - lastPurchase.quantity } : entry))
      .filter((entry) => entry.quantity > 0);

    const refund = -lastPurchase.amount;
    const transaction = createTransaction("undo", refund, `Annulation de l'achat : ${item.name} ×${lastPurchase.quantity}`, {
      itemId,
      quantity: lastPurchase.quantity,
    });

    commitProfile({
      ...profile,
      balance: profile.balance + refund,
      inventory,
      history: [transaction, ...profile.history.filter((entry) => entry.id !== lastPurchase.id)],
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
   * @typedef {Object} MissionLogEntry
   * @property {string} id
   * @property {number} timestamp
   * @property {string} rank
   * @property {number} gross
   * @property {number} villageCut
   * @property {number} net
   * @property {number} partySize
   * @property {boolean} leaderBonus
   * @property {number} shareEach
   * @property {number|null} leaderShare
   * @property {string[]} participantNames - Snapshot of names at the time of the mission,
   *   so the journal stays meaningful even if a profile is later renamed or deleted.
   * @property {string|null} leaderName
   */

  /**
   * Credit a computed mission payout to one or more profiles in a single call, logging
   * one "mission" transaction per profile plus one GM-only MissionLogEntry summarizing
   * the whole mission. The mission journal is a separate, GM-facing record (see
   * App.state.getMissionLog) — it is never shown on the player-facing profile view.
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
    const participants = profiles.filter((profile) => profileIds.includes(profile.id));

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

    const leaderProfile = leaderProfileId ? participants.find((profile) => profile.id === leaderProfileId) : null;
    /** @type {MissionLogEntry} */
    const logEntry = {
      id: generateEconomyId("mission-log"),
      timestamp: Date.now(),
      rank,
      gross: breakdown.gross,
      villageCut: breakdown.villageCut,
      net: breakdown.net,
      partySize: breakdown.partySize,
      leaderBonus: breakdown.leaderBonus,
      shareEach: breakdown.shareEach,
      leaderShare: breakdown.leaderShare,
      participantNames: participants.map((profile) => profile.name),
      leaderName: leaderProfile?.name ?? null,
    };
    setMissionLog([logEntry, ...getMissionLog()]);

    return { ok: true };
  }

  App.economy = {
    getItemById,
    getItemUnitPrice,
    getItemTotalPrice,
    purchaseItem,
    purchaseCart,
    undoLastPurchase,
    resellItem,
    consumeItem,
    adjustBalance,
    getInventoryValue,
    computeMissionPayout,
    creditMissionPayout,
  };
})();

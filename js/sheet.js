/**
 * Character sheet mutations. Each profile carries its own sheet (Profile.sheet): this is
 * the only module that changes it, the same way economy.js is the only one that changes
 * Ryo and inventories. Every function reads the sanitized sheet (App.sheetCalc), applies
 * one change, enforces the rules that apply (creation budgets, PX/PA balance, limits) and
 * commits through App.state.setProfiles(), which saves and notifies the views.
 * Every mutator returns {ok: true} or {ok: false, message} with a short French reason.
 * Once creation is validated (play mode), characteristics, arts, elements, énergie vitale
 * max, chakra max, mastery and new techniques only change through a paid purchase (or a
 * technique scroll from the shop); there is no free correction.
 * Plain script: attaches its API to the shared App namespace as App.sheet.
 * Depends on App.ninjaRules, App.sheetCalc, App.state, App.profiles, App.economy (must be loaded first).
 */

(function () {
  "use strict";
  window.App = window.App || {};

  const R = App.ninjaRules;
  const C = App.sheetCalc;
  const { getProfiles, setProfiles } = App.state;
  const { getProfileById } = App.profiles;

  const PLAY_ONLY = "Disponible en mode Jeu (la création utilise ses propres budgets).";
  /**
   * Once creation is validated, nothing that costs PX/PA can be changed for free: it only
   * goes up through the buy* functions below (and back down through undoLastSpending).
   */
  const CREATION_ONLY_PX = "En jeu, cette valeur ne s'améliore qu'en dépensant des PX (onglet Progression).";
  const CREATION_ONLY_PA = "En jeu, la maîtrise ne s'améliore qu'en dépensant des PA (bouton « Maîtrise → » ou onglet Progression).";
  /** Shop items that teach a technique without spending PA (data/items.js, section F). */
  const TECHNIQUE_SCROLL_IDS = ["parchemin-technique-base", "parchemin-technique-intermediaire", "parchemin-technique-avancee"];

  /**
   * The sanitized sheet of a profile. Always a fresh object, safe to mutate.
   * @param {object|null} profile
   * @returns {object}
   */
  function getSheet(profile) {
    return C.normalizeSheet(profile?.sheet, profile?.rank);
  }

  /**
   * Apply one change to a profile's sheet and commit it. `mutate` receives a fresh,
   * sanitized copy of the sheet (and the profile, read-only) and may return
   * {ok: false, message} to abort without saving anything.
   * @param {string} profileId
   * @param {(sheet: object, profile: object) => ({ok: boolean, message?: string}|void)} mutate
   * @returns {{ok: boolean, message?: string}}
   */
  function updateSheet(profileId, mutate) {
    const profile = getProfileById(profileId);
    if (!profile) return { ok: false, message: "Profil introuvable." };
    const sheet = getSheet(profile);
    const result = mutate(sheet, profile) ?? { ok: true };
    if (!result.ok) return result;
    if (sheet.mode === "creation") C.applyCreationDerivations(sheet, profile.rank);
    setProfiles(getProfiles().map((entry) => (entry.id === profileId ? { ...entry, sheet } : entry)));
    return result;
  }

  /**
   * Add an entry to the PX/PA ledger (newest first).
   * @param {object} sheet
   * @param {{currency: "px"|"pa", cost: number}} purchase
   * @param {string} label
   * @param {object} undo
   * @returns {void}
   */
  function addSpending(sheet, purchase, label, undo) {
    sheet.spending.unshift({
      id: C.generateSheetId("spend"),
      timestamp: Date.now(),
      currency: purchase.currency,
      cost: purchase.cost,
      label,
      undo,
    });
  }

  /** Common checks before a PX/PA purchase. Returns an error result, or null when it can go ahead. */
  function refusePurchase(sheet, purchase) {
    if (sheet.mode !== "jeu") return { ok: false, message: PLAY_ONLY };
    if (purchase.blocked) return { ok: false, message: `${purchase.blocked}.` };
    if (!C.canAfford(sheet, purchase)) {
      const available = C.experienceSummary(sheet)[purchase.currency].available;
      return { ok: false, message: `Pas assez de ${purchase.currency.toUpperCase()} : il en faut ${purchase.cost}, ${available} disponible${available > 1 ? "s" : ""}.` };
    }
    return null;
  }

  // --- Mode and identity ---

  /**
   * Switch between "creation" (budgets apply) and "jeu" (gauges, dice, PX/PA).
   * @param {string} profileId
   * @param {"creation"|"jeu"} mode
   * @returns {{ok: boolean, message?: string}}
   */
  function setMode(profileId, mode) {
    return updateSheet(profileId, (sheet) => {
      sheet.mode = mode === "jeu" ? "jeu" : "creation";
    });
  }

  /**
   * Set a free-text identity field (surnom, description, joueur, clan, sexe, age). The name
   * and the grade are the profile's own name and rank (App.profiles).
   * @param {string} profileId
   * @param {string} field
   * @param {string} value
   * @returns {{ok: boolean, message?: string}}
   */
  function setIdentityField(profileId, field, value) {
    return updateSheet(profileId, (sheet) => {
      if (!(field in sheet.identity)) return { ok: false, message: "Champ inconnu." };
      sheet.identity[field] = String(value ?? "");
    });
  }

  /**
   * Set the text of one trait line under a characteristic.
   * @param {string} profileId
   * @param {string} statKey
   * @param {number} index - 0..4
   * @param {string} value
   * @returns {{ok: boolean, message?: string}}
   */
  function setTrait(profileId, statKey, index, value) {
    return updateSheet(profileId, (sheet) => {
      if (!sheet.traits[statKey] || index < 0 || index >= R.STAT_MAX) return { ok: false, message: "Trait inconnu." };
      sheet.traits[statKey][index] = String(value ?? "");
    });
  }

  /**
   * Set the text of one aspect field.
   * @param {string} profileId
   * @param {string} categoryKey
   * @param {number} index - 0..1
   * @param {string} value
   * @returns {{ok: boolean, message?: string}}
   */
  function setAspect(profileId, categoryKey, index, value) {
    return updateSheet(profileId, (sheet) => {
      if (!sheet.aspects[categoryKey] || index < 0 || index >= R.ASPECTS_PER_CATEGORY) return { ok: false, message: "Aspect inconnu." };
      sheet.aspects[categoryKey][index] = String(value ?? "");
    });
  }

  // --- Characteristics, arts, elements ---

  /**
   * Creation mode only: +/- on a characteristic, + refused once the grade's budget is spent.
   * In play mode a characteristic only goes up through buyStat (PX).
   * @param {string} profileId
   * @param {string} key
   * @param {number} delta
   * @returns {{ok: boolean, message?: string}}
   */
  function changeStat(profileId, key, delta) {
    return updateSheet(profileId, (sheet, profile) => {
      if (sheet.mode !== "creation") return { ok: false, message: CREATION_ONLY_PX };
      if (!(key in sheet.stats)) return { ok: false, message: "Caractéristique inconnue." };
      const next = sheet.stats[key] + delta;
      if (next < R.STAT_MIN || next > R.STAT_MAX) return { ok: false, message: `Une caractéristique va de ${R.STAT_MIN} à ${R.STAT_MAX}.` };
      if (sheet.mode === "creation" && delta > 0 && C.creationBudget(sheet, profile.rank).stats.remaining < delta) {
        return { ok: false, message: "Plus de points de caractéristique à répartir." };
      }
      sheet.stats[key] = next;
    });
  }

  /**
   * Creation mode only: +/- on a ninja art, + refused past the budget or the per-art
   * maximum of the grade. In play mode an art only goes up through buyArt (PX).
   * @param {string} profileId
   * @param {string} key
   * @param {number} delta
   * @returns {{ok: boolean, message?: string}}
   */
  function changeArt(profileId, key, delta) {
    return updateSheet(profileId, (sheet, profile) => {
      if (sheet.mode !== "creation") return { ok: false, message: CREATION_ONLY_PX };
      if (!(key in sheet.arts)) return { ok: false, message: "Art ninja inconnu." };
      const next = sheet.arts[key] + delta;
      if (next < 0) return { ok: false, message: "Un art ninja ne descend pas sous 0." };
      if (sheet.mode === "creation" && delta > 0) {
        const budget = C.creationBudget(sheet, profile.rank);
        if (budget.arts.remaining < delta) return { ok: false, message: "Plus de points d'art ninja à répartir." };
        if (next > budget.arts.max) return { ok: false, message: `Maximum ${budget.arts.max} par art à la création.` };
      }
      sheet.arts[key] = next;
    });
  }

  /**
   * Choose which element plays a role (affinité, seconde affinité, élément faible). An
   * element can only hold one role: picking it for a new role frees the old one.
   * @param {string} profileId
   * @param {"affinity"|"second"|"weak"} role
   * @param {string} elementKey - "" to clear the role.
   * @returns {{ok: boolean, message?: string}}
   */
  function setElementRole(profileId, role, elementKey) {
    return updateSheet(profileId, (sheet, profile) => {
      if (sheet.mode !== "creation") return { ok: false, message: "Les affinités se choisissent à la création. En jeu, un élément s'achète en PA (onglet Progression)." };
      if (!(role in sheet.elementRoles)) return { ok: false, message: "Rôle inconnu." };
      if (elementKey && !C.ELEMENT_KEYS.includes(elementKey)) return { ok: false, message: "Élément inconnu." };
      if (role === "second" && C.gradeRules(profile.rank).second === null) {
        return { ok: false, message: "La seconde affinité est réservée aux Chûnin et Jônin." };
      }
      for (const other of Object.keys(sheet.elementRoles)) {
        if (other !== role && elementKey && sheet.elementRoles[other] === elementKey) sheet.elementRoles[other] = "";
      }
      sheet.elementRoles[role] = elementKey || "";
    });
  }

  /**
   * Creation only: PA turned into chakra (1 PA = +2 chakra max).
   * @param {string} profileId
   * @param {number} delta
   * @returns {{ok: boolean, message?: string}}
   */
  function changeCreationChakraPa(profileId, delta) {
    return updateSheet(profileId, (sheet, profile) => {
      if (sheet.mode !== "creation") return { ok: false, message: "En jeu, le chakra s'achète dans l'onglet Progression." };
      const next = sheet.creationChakraPa + delta;
      if (next < 0) return { ok: false, message: "Aucun PA à retirer du chakra." };
      if (delta > 0 && C.creationBudget(sheet, profile.rank).pa.remaining < delta) return { ok: false, message: "Plus de PA de création." };
      sheet.creationChakraPa = next;
    });
  }

  // --- Techniques ---

  /**
   * Add a technique (Débutant). Creation mode: paid from the creation PA. Play mode: always
   * paid 1 PA from the ledger (or learned from a shop scroll, see learnTechniqueFromScroll).
   * @param {string} profileId
   * @returns {{ok: boolean, message?: string, techniqueId?: string}}
   */
  function addTechnique(profileId) {
    return updateSheet(profileId, (sheet, profile) => {
      if (sheet.mode === "creation") {
        if (C.creationBudget(sheet, profile.rank).pa.remaining < R.NEW_TECHNIQUE_COST) return { ok: false, message: "Plus de PA de création pour une nouvelle technique." };
        const technique = C.createTechnique({ origin: "creation" });
        sheet.techniques.push(technique);
        return { ok: true, techniqueId: technique.id };
      }
      const technique = C.createTechnique({ origin: "play" });
      const purchase = C.newTechniqueCost();
      const refusal = refusePurchase(sheet, purchase);
      if (refusal) return refusal;
      addSpending(sheet, purchase, "Nouvelle technique (Débutant)", { type: "techniqueNew", techniqueId: technique.id });
      sheet.techniques.push(technique);
      return { ok: true, techniqueId: technique.id };
    });
  }

  /**
   * Shop scrolls ("Parchemin de technique ...") the profile owns, which can each teach one
   * technique without spending PA.
   * @param {object} profile
   * @returns {{itemId: string, name: string, quantity: number}[]}
   */
  function ownedTechniqueScrolls(profile) {
    return (profile?.inventory ?? [])
      .filter((entry) => TECHNIQUE_SCROLL_IDS.includes(entry.itemId) && entry.quantity > 0)
      .map((entry) => ({ itemId: entry.itemId, name: App.economy.getItemById(entry.itemId)?.name ?? entry.itemId, quantity: entry.quantity }));
  }

  /**
   * Play mode: use up one technique scroll bought at the shop to learn a new technique
   * (Débutant) without spending PA. The scroll leaves the inventory.
   * @param {string} profileId
   * @param {string} itemId - One of the "parchemin-technique-*" items.
   * @returns {{ok: boolean, message?: string, techniqueId?: string}}
   */
  function learnTechniqueFromScroll(profileId, itemId) {
    const profile = getProfileById(profileId);
    if (!profile) return { ok: false, message: "Profil introuvable." };
    if (getSheet(profile).mode !== "jeu") return { ok: false, message: PLAY_ONLY };
    if (!ownedTechniqueScrolls(profile).some((scroll) => scroll.itemId === itemId)) {
      return { ok: false, message: "Aucun parchemin de technique de ce type dans l'inventaire." };
    }
    const consumed = App.economy.consumeItem(profileId, itemId, 1);
    if (!consumed.ok) return consumed;
    const scrollName = App.economy.getItemById(itemId)?.name ?? "parchemin";
    return updateSheet(profileId, (sheet) => {
      const technique = C.createTechnique({ origin: "play", name: "" });
      sheet.techniques.push(technique);
      return { ok: true, techniqueId: technique.id, message: `Technique apprise grâce au ${scrollName.toLowerCase()}.` };
    });
  }

  /**
   * Edit a technique's fields (name, art, rank, mastery, element). Changing the mastery in
   * creation mode is checked against the creation PA; in play mode it's refused (mastery
   * only goes up through buyMastery).
   * @param {string} profileId
   * @param {string} techniqueId
   * @param {{name?: string, art?: string, rank?: string, mastery?: string, element?: string}} patch
   * @returns {{ok: boolean, message?: string}}
   */
  function updateTechnique(profileId, techniqueId, patch) {
    return updateSheet(profileId, (sheet, profile) => {
      const technique = sheet.techniques.find((tech) => tech.id === techniqueId);
      if (!technique) return { ok: false, message: "Technique introuvable." };
      if (sheet.mode !== "creation" && patch.mastery !== undefined && patch.mastery !== technique.mastery) {
        return { ok: false, message: CREATION_ONLY_PA };
      }
      const before = C.creationBudget(sheet, profile.rank).pa.remaining;

      if (typeof patch.name === "string") technique.name = patch.name.slice(0, 120);
      if (C.ART_KEYS.includes(patch.art)) technique.art = patch.art;
      if (R.TECHNIQUE_RANKS.some((rank) => rank.key === patch.rank)) technique.rank = patch.rank;
      if (R.MASTERY_LEVELS.some((level) => level.key === patch.mastery)) technique.mastery = patch.mastery;
      if (patch.element === "" || C.ELEMENT_KEYS.includes(patch.element) || C.natureDef(patch.element)) technique.element = patch.element;

      if (sheet.mode === "creation" && patch.mastery !== undefined) {
        const after = C.creationBudget(sheet, profile.rank).pa.remaining;
        if (after < 0 && after < before) return { ok: false, message: "Pas assez de PA de création pour ce niveau de maîtrise." };
      }
    });
  }

  /**
   * Delete a technique. Natures it was the prerequisite for stay unlocked (the GM decides).
   * @param {string} profileId
   * @param {string} techniqueId
   * @returns {{ok: boolean, message?: string}}
   */
  function removeTechnique(profileId, techniqueId) {
    return updateSheet(profileId, (sheet) => {
      const before = sheet.techniques.length;
      sheet.techniques = sheet.techniques.filter((tech) => tech.id !== techniqueId);
      if (sheet.techniques.length === before) return { ok: false, message: "Technique introuvable." };
    });
  }

  /**
   * Play mode: raise a technique's mastery by one level, paid in PA (1 PA up to Acquise,
   * then 2 PA per level).
   * @param {string} profileId
   * @param {string} techniqueId
   * @returns {{ok: boolean, message?: string}}
   */
  function buyMastery(profileId, techniqueId) {
    return updateSheet(profileId, (sheet) => {
      const technique = sheet.techniques.find((tech) => tech.id === techniqueId);
      if (!technique) return { ok: false, message: "Technique introuvable." };
      const purchase = C.masteryUpgrade(technique);
      const refusal = refusePurchase(sheet, purchase);
      if (refusal) return refusal;
      const from = C.masteryLevel(technique.mastery).label;
      const to = C.masteryLevel(purchase.target).label;
      addSpending(sheet, purchase, `${technique.name || "Technique"} : ${from} → ${to}`, {
        type: "mastery",
        techniqueId,
        previous: technique.mastery,
      });
      technique.mastery = purchase.target;
    });
  }

  // --- PX / PA purchases ---

  /**
   * Play mode: +1 in a characteristic for (target level × 2) PX, max 5. The new level shows
   * one more trait line on the sheet.
   * @param {string} profileId
   * @param {string} key
   * @returns {{ok: boolean, message?: string}}
   */
  function buyStat(profileId, key) {
    return updateSheet(profileId, (sheet) => {
      if (!(key in sheet.stats)) return { ok: false, message: "Caractéristique inconnue." };
      const purchase = C.statUpgrade(sheet, key);
      const refusal = refusePurchase(sheet, purchase);
      if (refusal) return refusal;
      const previous = sheet.stats[key];
      addSpending(sheet, purchase, `${C.statDef(key).label} ${previous} → ${purchase.target}`, { type: "stat", key, previous });
      sheet.stats[key] = purchase.target;
    });
  }

  /**
   * Play mode: +1 in a ninja art for (target level) PX. No maximum after creation.
   * @param {string} profileId
   * @param {string} key
   * @returns {{ok: boolean, message?: string}}
   */
  function buyArt(profileId, key) {
    return updateSheet(profileId, (sheet) => {
      if (!(key in sheet.arts)) return { ok: false, message: "Art ninja inconnu." };
      const purchase = C.artUpgrade(sheet, key);
      const refusal = refusePurchase(sheet, purchase);
      if (refusal) return refusal;
      const previous = sheet.arts[key];
      addSpending(sheet, purchase, `${C.artDef(key).label} ${previous} → ${purchase.target}`, { type: "art", key, previous });
      sheet.arts[key] = purchase.target;
    });
  }

  /**
   * Play mode: +1 énergie vitale max for 4 PX. If the gauge was full, it stays full.
   * @param {string} profileId
   * @returns {{ok: boolean, message?: string}}
   */
  function buyVitality(profileId) {
    return updateSheet(profileId, (sheet) => {
      const purchase = C.vitalityUpgrade(sheet);
      const refusal = refusePurchase(sheet, purchase);
      if (refusal) return refusal;
      const wasFull = sheet.vitality.current === sheet.vitality.max;
      addSpending(sheet, purchase, `Énergie vitale max ${sheet.vitality.max} → ${purchase.target}`, { type: "vitalityMax" });
      sheet.vitality.max = purchase.target;
      if (wasFull) sheet.vitality.current = sheet.vitality.max;
    });
  }

  /**
   * Play mode: +2 chakra max for 1 PA. If the gauge was full, it stays full.
   * @param {string} profileId
   * @returns {{ok: boolean, message?: string}}
   */
  function buyChakra(profileId) {
    return updateSheet(profileId, (sheet) => {
      const purchase = C.chakraUpgrade(sheet);
      const refusal = refusePurchase(sheet, purchase);
      if (refusal) return refusal;
      const wasFull = sheet.chakra.current === sheet.chakra.max;
      addSpending(sheet, purchase, `Chakra max ${sheet.chakra.max} → ${purchase.target}`, { type: "chakraMax" });
      sheet.chakra.max = purchase.target;
      if (wasFull) sheet.chakra.current = sheet.chakra.max;
    });
  }

  /**
   * Play mode: +1 in an element (1 PA while ≤ 0, else the target level in PA; at most
   * three elements above 0).
   * @param {string} profileId
   * @param {string} key
   * @returns {{ok: boolean, message?: string}}
   */
  function buyElement(profileId, key) {
    return updateSheet(profileId, (sheet) => {
      if (!(key in sheet.elements)) return { ok: false, message: "Élément inconnu." };
      const purchase = C.elementUpgrade(sheet, key);
      const refusal = refusePurchase(sheet, purchase);
      if (refusal) return refusal;
      const previous = sheet.elements[key];
      const sign = (value) => (value > 0 ? `+${value}` : String(value));
      addSpending(sheet, purchase, `${C.elementDef(key).label} ${sign(previous)} → ${sign(purchase.target)}`, { type: "element", key, previous });
      sheet.elements[key] = purchase.target;
    });
  }

  /**
   * Cancel the most recent PX/PA expense: refunds it and puts back what it changed.
   * @param {string} profileId
   * @returns {{ok: boolean, message?: string}}
   */
  function undoLastSpending(profileId) {
    return updateSheet(profileId, (sheet) => {
      const entry = sheet.spending[0];
      if (!entry) return { ok: false, message: "Aucune dépense à annuler." };
      const { type, key, techniqueId, previous } = entry.undo;

      if (type === "stat" && key in sheet.stats) sheet.stats[key] = Math.max(R.STAT_MIN, Math.min(R.STAT_MAX, Number(previous) || R.STAT_MIN));
      if (type === "art" && key in sheet.arts) sheet.arts[key] = Math.max(0, Number(previous) || 0);
      if (type === "element" && key in sheet.elements) sheet.elements[key] = Number(previous) || 0;
      if (type === "vitalityMax") {
        sheet.vitality.max = Math.max(1, sheet.vitality.max - R.PROGRESSION.vitalityGain);
        sheet.vitality.current = Math.min(sheet.vitality.current, sheet.vitality.max);
      }
      if (type === "chakraMax") {
        sheet.chakra.max = Math.max(0, sheet.chakra.max - R.PROGRESSION.chakraGain);
        sheet.chakra.current = Math.min(sheet.chakra.current, sheet.chakra.max);
      }
      if (type === "techniqueNew") sheet.techniques = sheet.techniques.filter((tech) => tech.id !== techniqueId);
      if (type === "mastery") {
        const technique = sheet.techniques.find((tech) => tech.id === techniqueId);
        if (technique && typeof previous === "string") technique.mastery = previous;
      }

      sheet.spending.shift();
    });
  }

  /**
   * Set the total PX or PA earned so far (typed by the player after each session).
   * @param {string} profileId
   * @param {"px"|"pa"} currency
   * @param {number} value
   * @returns {{ok: boolean, message?: string}}
   */
  function setEarned(profileId, currency, value) {
    return updateSheet(profileId, (sheet) => {
      if (!(currency in sheet.earned)) return { ok: false, message: "Monnaie inconnue." };
      const number = Math.round(Number(value));
      if (!Number.isFinite(number) || number < 0) return { ok: false, message: "Entrez un nombre positif." };
      sheet.earned[currency] = number;
    });
  }

  /**
   * Add PX or PA earned during a session to the total.
   * @param {string} profileId
   * @param {"px"|"pa"} currency
   * @param {number} amount
   * @returns {{ok: boolean, message?: string}}
   */
  function addEarned(profileId, currency, amount) {
    return updateSheet(profileId, (sheet) => {
      if (!(currency in sheet.earned)) return { ok: false, message: "Monnaie inconnue." };
      const number = Math.round(Number(amount));
      if (!Number.isFinite(number) || number === 0) return { ok: false, message: "Entrez un nombre de points gagnés." };
      sheet.earned[currency] = Math.max(0, sheet.earned[currency] + number);
    });
  }

  // --- Gauges ---

  /**
   * +/- on the current énergie vitale, between −max ("Mort") and max.
   * @param {string} profileId
   * @param {number} delta
   * @returns {{ok: boolean, message?: string}}
   */
  function changeVitality(profileId, delta) {
    return updateSheet(profileId, (sheet) => {
      if (sheet.mode !== "jeu") return { ok: false, message: PLAY_ONLY };
      sheet.vitality.current = Math.max(-sheet.vitality.max, Math.min(sheet.vitality.max, sheet.vitality.current + delta));
    });
  }

  /**
   * +/- on the current chakra, between 0 and max.
   * @param {string} profileId
   * @param {number} delta
   * @returns {{ok: boolean, message?: string}}
   */
  function changeChakra(profileId, delta) {
    return updateSheet(profileId, (sheet) => {
      if (sheet.mode !== "jeu") return { ok: false, message: PLAY_ONLY };
      sheet.chakra.current = Math.max(0, Math.min(sheet.chakra.max, sheet.chakra.current + delta));
    });
  }

  /**
   * Refill the chakra gauge (rest, meditation).
   * @param {string} profileId
   * @returns {{ok: boolean, message?: string}}
   */
  function restoreChakra(profileId) {
    return updateSheet(profileId, (sheet) => {
      if (sheet.mode !== "jeu") return { ok: false, message: PLAY_ONLY };
      sheet.chakra.current = sheet.chakra.max;
    });
  }

  /**
   * Spend chakra (a technique's cost plus any extra). Refused when the gauge is too low.
   * @param {string} profileId
   * @param {number} amount
   * @returns {{ok: boolean, message?: string}}
   */
  function spendChakra(profileId, amount) {
    return updateSheet(profileId, (sheet) => {
      if (sheet.mode !== "jeu") return { ok: false, message: PLAY_ONLY };
      if (sheet.chakra.current < amount) return { ok: false, message: `Chakra insuffisant : ${amount} nécessaire, ${sheet.chakra.current} restant.` };
      sheet.chakra.current -= amount;
    });
  }

  // --- Aspects ---

  /**
   * Positive call of an aspect: −2 chakra, then the chosen effect waits for the next roll
   * or initiative (or is just announced, for the "décret").
   * @param {string} profileId
   * @param {string} effectKey - key of App.ninjaRules.ASPECT_EFFECTS
   * @returns {{ok: boolean, message?: string}}
   */
  function callAspectPositive(profileId, effectKey) {
    return updateSheet(profileId, (sheet) => {
      if (sheet.mode !== "jeu") return { ok: false, message: PLAY_ONLY };
      const effect = R.ASPECT_EFFECTS.find((entry) => entry.key === effectKey);
      if (!effect) return { ok: false, message: "Effet inconnu." };
      if (sheet.chakra.current < R.ASPECT_POSITIVE_COST) {
        return { ok: false, message: `Il faut ${R.ASPECT_POSITIVE_COST} points de chakra pour appeler un aspect en positif.` };
      }
      sheet.chakra.current -= R.ASPECT_POSITIVE_COST;
      if (effect.target !== "display") sheet.pendingAspects.push(effect.key);
    });
  }

  /**
   * Negative call of an aspect: +2 chakra, never above the maximum.
   * @param {string} profileId
   * @returns {{ok: boolean, message?: string}}
   */
  function callAspectNegative(profileId) {
    return updateSheet(profileId, (sheet) => {
      if (sheet.mode !== "jeu") return { ok: false, message: PLAY_ONLY };
      sheet.chakra.current = Math.min(sheet.chakra.max, sheet.chakra.current + R.ASPECT_NEGATIVE_GAIN);
    });
  }

  /**
   * Drop one waiting aspect effect without using it (no refund).
   * @param {string} profileId
   * @param {number} index
   * @returns {{ok: boolean, message?: string}}
   */
  function dropPendingAspect(profileId, index) {
    return updateSheet(profileId, (sheet) => {
      if (index < 0 || index >= sheet.pendingAspects.length) return { ok: false, message: "Effet introuvable." };
      sheet.pendingAspects.splice(index, 1);
    });
  }

  /**
   * Use up every waiting aspect effect for a target ("roll" or "initiative").
   * @param {string} profileId
   * @param {"roll"|"initiative"} target
   * @returns {{ok: boolean, message?: string, consumed?: string[]}}
   */
  function consumePendingAspects(profileId, target) {
    const targetOf = (key) => R.ASPECT_EFFECTS.find((effect) => effect.key === key)?.target;
    return updateSheet(profileId, (sheet) => {
      const consumed = sheet.pendingAspects.filter((key) => targetOf(key) === target);
      if (!consumed.length) return { ok: false, consumed: [] };
      sheet.pendingAspects = sheet.pendingAspects.filter((key) => targetOf(key) !== target);
      return { ok: true, consumed };
    });
  }

  // --- Natures and Kekkei Genkai ---

  /**
   * "Débloquer (enseignement reçu)": make a lit nature usable. Refused while its
   * prerequisites aren't met.
   * @param {string} profileId
   * @param {string} natureKey
   * @returns {{ok: boolean, message?: string}}
   */
  function unlockNature(profileId, natureKey) {
    return updateSheet(profileId, (sheet) => {
      const nature = C.natureDef(natureKey);
      if (!nature) return { ok: false, message: "Nature inconnue." };
      const status = C.natureStatus(sheet, nature);
      if (!status.lit) return { ok: false, message: `Prérequis manquants : ${status.missing.join(", ")}.` };
      if (!sheet.unlockedNatures.includes(natureKey)) sheet.unlockedNatures.push(natureKey);
    });
  }

  /**
   * Lock a nature again (e.g. unlocked by mistake).
   * @param {string} profileId
   * @param {string} natureKey
   * @returns {{ok: boolean, message?: string}}
   */
  function lockNature(profileId, natureKey) {
    return updateSheet(profileId, (sheet) => {
      sheet.unlockedNatures = sheet.unlockedNatures.filter((key) => key !== natureKey);
    });
  }

  /**
   * Put a Kekkei Genkai nature in one of the two slots. The second slot stays locked in
   * creation mode (one Kekkei Genkai at creation, p. 41).
   * @param {string} profileId
   * @param {number} slot - 0 or 1
   * @param {string} natureKey - "" to empty the slot.
   * @returns {{ok: boolean, message?: string}}
   */
  function setKekkeiGenkai(profileId, slot, natureKey) {
    return updateSheet(profileId, (sheet) => {
      if (slot < 0 || slot >= R.KEKKEI_GENKAI_SLOTS) return { ok: false, message: "Emplacement inconnu." };
      if (slot > 0 && sheet.mode === "creation") return { ok: false, message: "Un seul Kekkei Genkai à la création : le 2e emplacement s'ouvre en jeu." };
      if (natureKey && !C.KG_NATURE_KEYS.includes(natureKey)) return { ok: false, message: "Kekkei Genkai inconnu." };
      if (natureKey && sheet.kekkeiGenkai.some((key, index) => index !== slot && key === natureKey)) {
        return { ok: false, message: "Ce Kekkei Genkai occupe déjà l'autre emplacement." };
      }
      const previous = sheet.kekkeiGenkai[slot];
      sheet.kekkeiGenkai[slot] = natureKey || "";
      if (previous && previous !== natureKey) sheet.unlockedNatures = sheet.unlockedNatures.filter((key) => key !== previous);
    });
  }

  // --- Hand-added equipment ---

  /**
   * Add an item by hand (scenario reward, legendary weapon...).
   * @param {string} profileId
   * @param {{name: string, stat: string, dice: number, successes: number, legendary: boolean}} fields
   * @returns {{ok: boolean, message?: string}}
   */
  function addCustomItem(profileId, fields) {
    return updateSheet(profileId, (sheet) => {
      const name = String(fields.name ?? "").trim();
      if (!name) return { ok: false, message: "Donnez un nom à l'objet." };
      if (!C.STAT_KEYS.includes(fields.stat)) return { ok: false, message: "Choisissez une caractéristique." };
      if (fields.legendary && sheet.customItems.some((item) => item.legendary)) {
        return { ok: false, message: "Un personnage ne porte qu'une seule arme légendaire." };
      }
      sheet.customItems.push({
        id: C.generateSheetId("item"),
        name: name.slice(0, 120),
        stat: fields.stat,
        dice: Math.max(0, Math.min(9, Math.round(Number(fields.dice) || 0))),
        successes: Math.max(0, Math.min(9, Math.round(Number(fields.successes) || 0))),
        legendary: Boolean(fields.legendary),
      });
    });
  }

  /**
   * Remove a hand-added item.
   * @param {string} profileId
   * @param {string} itemId
   * @returns {{ok: boolean, message?: string}}
   */
  function removeCustomItem(profileId, itemId) {
    return updateSheet(profileId, (sheet) => {
      sheet.customItems = sheet.customItems.filter((item) => item.id !== itemId);
    });
  }

  // --- Dice history and initiative ---

  /**
   * Save a roll in the local history (newest first, last 10 kept). Saving a roll with an
   * id already in the history replaces it (used after rerolls).
   * @param {string} profileId
   * @param {{id: string, timestamp: number, label: string, dice: {value: number, rerolled: boolean}[], auto: number, total: number}} roll
   * @returns {{ok: boolean, message?: string}}
   */
  function recordRoll(profileId, roll) {
    return updateSheet(profileId, (sheet) => {
      sheet.rolls = [roll, ...sheet.rolls.filter((entry) => entry.id !== roll.id)].slice(0, R.ROLL_HISTORY_SIZE);
    });
  }

  /**
   * Remember the current initiative: total tokens, the d10 and bonus it came from, and the
   * token piles.
   * @param {string} profileId
   * @param {{total: number|null, die?: number|null, bonus?: number|null, piles: number[]}} initiative
   * @returns {{ok: boolean, message?: string}}
   */
  function setInitiative(profileId, initiative) {
    const toInt = (value) => (value === null || value === undefined ? null : Math.round(Number(value) || 0));
    return updateSheet(profileId, (sheet) => {
      sheet.initiative = {
        total: initiative.total === null ? null : Math.max(0, toInt(initiative.total)),
        die: toInt(initiative.die),
        bonus: toInt(initiative.bonus),
        piles: (initiative.piles ?? []).map((pile) => Math.max(0, Math.round(Number(pile) || 0))),
      };
    });
  }

  App.sheet = {
    getSheet,
    setMode,
    setIdentityField,
    setTrait,
    setAspect,
    changeStat,
    changeArt,
    setElementRole,
    changeCreationChakraPa,
    addTechnique,
    ownedTechniqueScrolls,
    learnTechniqueFromScroll,
    updateTechnique,
    removeTechnique,
    buyMastery,
    buyStat,
    buyArt,
    buyVitality,
    buyChakra,
    buyElement,
    undoLastSpending,
    setEarned,
    addEarned,
    changeVitality,
    changeChakra,
    restoreChakra,
    spendChakra,
    callAspectPositive,
    callAspectNegative,
    dropPendingAspect,
    consumePendingAspects,
    unlockNature,
    lockNature,
    setKekkeiGenkai,
    addCustomItem,
    removeCustomItem,
    recordRoll,
    setInitiative,
  };
})();

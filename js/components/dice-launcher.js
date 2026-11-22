/**
 * The d10 launcher of the character sheet (rules p. 105-111), in a modal so it opens from
 * any tab:
 *  1. dice pool = characteristic + ninja art (optional) + equipment (capped by grade)
 *     + extra chakra + mastery dice + manual adjustment; or Combat alone for a kunai/shuriken;
 *  2. "Réussite spontanée jusqu'à difficulté X" before rolling;
 *  3. colored dice; each checked trait gives one reroll (tap the die to reroll);
 *  4. automatic successes (mastery, element, equipment, aspect, manual adjustment);
 *  5. total + quality; the last 10 rolls are kept on the sheet.
 * Also the "Lancer la technique" step: check the art against the chakra cost, choose the
 * extra chakra, spend it, then open the launcher already filled in.
 * Plain script: attaches its API to the shared App namespace as App.diceLauncher.
 * Depends on App.ninjaRules, App.sheetCalc, App.sheet, App.profiles, App.dom, App.modal, App.format.
 */

(function () {
  "use strict";
  window.App = window.App || {};

  const R = App.ninjaRules;
  const C = App.sheetCalc;
  const { getSheet, spendChakra, consumePendingAspects, recordRoll } = App.sheet;
  const { getProfileById } = App.profiles;
  const { h, clearElement, rerenderKeepingFocus } = App.dom;
  const { openModal, closeModal } = App.modal;
  const { formatDateTime } = App.format;

  const DIE_KIND_LABELS = { crit: "2 succès", success: "1 succès", cancel: "annule 1 succès", fail: "rien" };

  function signed(value) {
    return value > 0 ? `+${value}` : value < 0 ? `−${Math.abs(value)}` : "0";
  }

  function plural(count, singular, pluralForm) {
    return `${count} ${Math.abs(count) > 1 ? pluralForm : singular}`;
  }

  /** −/value/+ control used for the manual adjustments. */
  function stepper({ label, value, onChange, focusKey, min, max }) {
    const minus = h("button", { class: "stepper__btn", type: "button", "data-focus-key": `${focusKey}-minus`, "aria-label": `${label} : moins`, disabled: min !== undefined && value <= min }, "−");
    const plus = h("button", { class: "stepper__btn", type: "button", "data-focus-key": `${focusKey}-plus`, "aria-label": `${label} : plus`, disabled: max !== undefined && value >= max }, "+");
    minus.addEventListener("click", () => onChange(value - 1));
    plus.addEventListener("click", () => onChange(value + 1));
    return h("div", { class: "stepper", role: "group", "aria-label": label }, [minus, h("output", { class: "stepper__value", "aria-live": "polite" }, signed(value)), plus]);
  }

  /** A die as a button (tappable for a reroll). */
  function dieButton(die, index, { canReroll, onReroll, ignoreFours }) {
    const kind = C.dieKind(die.value);
    const effect = die.value === 4 && ignoreFours ? "ignoré" : DIE_KIND_LABELS[kind];
    const button = h(
      "button",
      {
        class: `die die--${kind}${die.rerolled ? " die--rerolled" : ""}${die.value === 4 && ignoreFours ? " die--ignored" : ""}`,
        type: "button",
        "data-focus-key": `die-${index}`,
        disabled: !canReroll,
        "aria-label": `Dé ${index + 1} : ${die.value} (${effect})${die.rerolled ? ", relancé" : ""}${canReroll ? ". Relancer ce dé" : ""}`,
        title: canReroll ? "Relancer ce dé" : effect,
      },
      String(die.value),
    );
    button.addEventListener("click", () => onReroll(index));
    return button;
  }

  /**
   * Open the launcher for a profile.
   * @param {string} profileId
   * @param {{techniqueId?: string, extraChakra?: number}} [preset] - Filled in by the
   *   technique flow: the technique's art, mastery and element, and the extra chakra already spent.
   * @returns {void}
   */
  function openDiceLauncher(profileId, preset) {
    const options = preset || {};
    const freshSheet = () => getSheet(getProfileById(profileId));
    if (!getProfileById(profileId)) return;

    const initialSheet = freshSheet();
    const technique = options.techniqueId ? initialSheet.techniques.find((tech) => tech.id === options.techniqueId) ?? null : null;
    const extraChakra = technique ? Math.max(0, options.extraChakra ?? 0) : 0;

    const config = {
      stat: "combat",
      art: technique ? technique.art : "",
      kunai: false,
      excludedItems: new Set(),
      diceAdjust: 0,
      successAdjust: 0,
    };
    /** Current roll, or null while setting up. */
    let roll = null;

    const body = h("div", { class: "launcher" });

    function equipmentForStat(profile, sheet) {
      return C.equipmentList(profile, sheet).filter((item) => item.stat === config.stat);
    }

    /** Everything that goes into the pool for the current setup. */
    function computePool(profile, sheet) {
      const statDef = C.statDef(config.stat);
      const useArt = !config.kunai && config.art;
      const artValue = useArt ? sheet.arts[config.art] : 0;
      const items = config.kunai ? [] : equipmentForStat(profile, sheet).filter((item) => !config.excludedItems.has(item.id));
      const equipment = C.equipmentBonus(items, profile.rank);
      const mastery = technique ? C.masteryLevel(sheet.techniques.find((tech) => tech.id === technique.id)?.mastery ?? technique.mastery) : null;
      const elementBonus = technique ? C.elementValue(sheet, technique.element) : 0;
      const pendingSuccesses = sheet.pendingAspects.filter((key) => key === "successes").length * 2;

      const diceParts = [
        { label: statDef.label, value: sheet.stats[config.stat] },
        useArt ? { label: C.artDef(config.art).label, value: artValue } : null,
        equipment.dice ? { label: equipment.legendary ? `Arme légendaire (${equipment.legendary})` : "Équipement", value: equipment.dice } : null,
        extraChakra ? { label: "Chakra supplémentaire", value: extraChakra } : null,
        mastery && mastery.dice ? { label: `Maîtrise ${mastery.label}`, value: mastery.dice } : null,
        config.diceAdjust ? { label: "Ajustement", value: config.diceAdjust } : null,
      ].filter(Boolean);
      const autoParts = [
        mastery && mastery.successes ? { label: `Maîtrise ${mastery.label}`, value: mastery.successes } : null,
        technique && technique.element && elementBonus ? { label: `Élément ${C.elementLabel(technique.element)}`, value: elementBonus } : null,
        equipment.successes ? { label: equipment.legendary ? "Arme légendaire" : "Équipement", value: equipment.successes } : null,
        pendingSuccesses ? { label: "Aspect appelé", value: pendingSuccesses } : null,
        config.successAdjust ? { label: "Ajustement", value: config.successAdjust } : null,
      ].filter(Boolean);

      const dice = Math.max(0, diceParts.reduce((total, part) => total + part.value, 0));
      const auto = autoParts.reduce((total, part) => total + part.value, 0);
      return { dice, auto, diceParts, autoParts, equipment, items };
    }

    function rollLabel(sheet) {
      if (technique) return `Technique : ${technique.name || "sans nom"} (${C.statDef(config.stat).label})`;
      if (config.kunai) return "Lancer de kunaï / shuriken (Combat)";
      return config.art ? `${C.statDef(config.stat).label} + ${C.artDef(config.art).label}` : C.statDef(config.stat).label;
    }

    function saveRoll() {
      const values = roll.dice.map((die) => die.value);
      recordRoll(profileId, {
        id: roll.id,
        timestamp: roll.timestamp,
        label: roll.label,
        dice: roll.dice.map((die) => ({ ...die })),
        auto: roll.auto,
        total: C.countSuccesses(values, roll.ignoreFours) + roll.auto,
      });
    }

    function doRoll() {
      const profile = getProfileById(profileId);
      const sheet = freshSheet();
      const pool = computePool(profile, sheet);
      const consumed = consumePendingAspects(profileId, "roll").consumed ?? [];
      roll = {
        id: C.generateSheetId("roll"),
        timestamp: Date.now(),
        label: rollLabel(sheet),
        stat: config.stat,
        dice: Array.from({ length: pool.dice }, () => ({ value: C.rollD10(), rerolled: false })),
        auto: pool.auto,
        autoParts: pool.autoParts,
        diceParts: pool.diceParts,
        ignoreFours: consumed.includes("ignore4"),
        rerollFails: consumed.includes("rerollFails") ? "available" : null,
        ignoreWounds: consumed.includes("ignoreWounds"),
        checkedTraits: new Set(),
        rerollsUsed: 0,
      };
      saveRoll();
      render();
    }

    function rerollDie(index) {
      if (!roll || roll.rerollsUsed >= roll.checkedTraits.size) return;
      roll.dice[index] = { value: C.rollD10(), rerolled: true };
      roll.rerollsUsed += 1;
      saveRoll();
      render();
    }

    function rerollAllFails() {
      if (!roll || roll.rerollFails !== "available") return;
      roll.dice = roll.dice.map((die) => (die.value <= 4 ? { value: C.rollD10(), rerolled: true } : die));
      roll.rerollFails = "used";
      saveRoll();
      render();
    }

    // --- Setup screen ---

    function buildSetup(profile, sheet) {
      const pool = computePool(profile, sheet);
      const parts = [];

      // Characteristic
      parts.push(
        h("fieldset", { class: "launcher__group" }, [
          h("legend", {}, technique ? "Caractéristique (au choix pour cette technique)" : "Caractéristique"),
          h(
            "div",
            { class: "segmented", role: "radiogroup", "aria-label": "Caractéristique" },
            R.STATS.map((stat) => {
              const checked = config.stat === stat.key;
              const button = h(
                "button",
                {
                  class: `segmented__option${checked ? " is-selected" : ""}`,
                  type: "button",
                  role: "radio",
                  "aria-checked": checked ? "true" : "false",
                  "data-focus-key": `stat-${stat.key}`,
                  disabled: config.kunai && stat.key !== "combat",
                },
                [stat.label, h("span", { class: "segmented__value" }, String(sheet.stats[stat.key]))],
              );
              button.addEventListener("click", () => {
                config.stat = stat.key;
                config.excludedItems.clear();
                render();
              });
              return button;
            }),
          ),
        ]),
      );

      // Art + kunai option
      if (technique) {
        const info = C.techniqueInfo(sheet, technique);
        parts.push(
          h("div", { class: "launcher__technique" }, [
            h("strong", {}, technique.name || "Technique sans nom"),
            h("span", {}, ` · ${info.artLabel} ${info.artValue} · rang ${technique.rank} (${info.cost} chakra)${extraChakra ? ` + ${extraChakra} chakra supplémentaire` : ""}`),
          ]),
        );
      } else {
        const artSelect = h(
          "select",
          { id: "launcher-art", "data-focus-key": "launcher-art", disabled: config.kunai },
          [
            h("option", { value: "" }, "Aucun art ninja"),
            ...R.ARTS.map((art) => h("option", { value: art.key }, `${art.label} (${sheet.arts[art.key]})`)),
          ],
        );
        artSelect.value = config.kunai ? "" : config.art;
        artSelect.addEventListener("change", () => {
          config.art = artSelect.value;
          render();
        });
        const kunaiBox = h("input", { type: "checkbox", id: "launcher-kunai", "data-focus-key": "launcher-kunai", checked: config.kunai });
        kunaiBox.addEventListener("change", () => {
          config.kunai = kunaiBox.checked;
          if (config.kunai) config.stat = "combat";
          render();
        });
        parts.push(
          h("div", { class: "launcher__row" }, [
            h("div", { class: "field" }, [h("label", { for: "launcher-art" }, "Art ninja (optionnel)"), artSelect]),
            h("label", { class: "checkbox-field launcher__kunai", for: "launcher-kunai" }, [kunaiBox, "Lancer de kunaï / shuriken : Combat seul, sans art ninja ni équipement"]),
          ]),
        );
      }

      // Equipment
      if (!config.kunai) {
        const items = equipmentForStat(profile, sheet);
        const legendaryCount = items.filter((item) => item.legendary).length;
        const rules = C.gradeRules(profile.rank);
        const capText = rules.equipSuccesses
          ? `+${rules.equipDice} dés et +${rules.equipSuccesses} succès`
          : `+${plural(rules.equipDice, "dé", "dés")}`;
        parts.push(
          h("fieldset", { class: "launcher__group" }, [
            h("legend", {}, `Équipement en ${C.statDef(config.stat).label}`),
            items.length
              ? h(
                  "div",
                  { class: "launcher__items" },
                  items.map((item) => {
                    const box = h("input", { type: "checkbox", id: `launcher-item-${item.id}`, "data-focus-key": `item-${item.id}`, checked: !config.excludedItems.has(item.id) });
                    box.addEventListener("change", () => {
                      if (box.checked) config.excludedItems.delete(item.id);
                      else config.excludedItems.add(item.id);
                      render();
                    });
                    const bonus = [item.dice ? `+${plural(item.dice, "dé", "dés")}` : null, item.successes ? `+${plural(item.successes, "succès", "succès")}` : null].filter(Boolean).join(" ");
                    return h("label", { class: "checkbox-field", for: `launcher-item-${item.id}` }, [
                      box,
                      `${item.name} (${bonus || "aucun bonus"})`,
                      item.legendary ? h("span", { class: "badge badge--gm" }, "Légendaire") : null,
                    ]);
                  }),
                )
              : h("p", { class: "text-faint" }, "Aucun objet pour cette caractéristique. Les achats du shop et les objets ajoutés dans l'onglet Sac apparaissent ici."),
            items.length
              ? h(
                  "p",
                  { class: "field-hint" },
                  pool.equipment.legendary
                    ? `Arme légendaire : +${pool.equipment.dice} dés et +${pool.equipment.successes} succès, elle remplace le plafond.`
                    : `Bonus retenu : +${plural(pool.equipment.dice, "dé", "dés")}${pool.equipment.successes ? ` et +${pool.equipment.successes} succès` : ""} (plafond ${profile.rank} : ${capText}${pool.equipment.capped ? ", atteint" : ""}).`,
                )
              : null,
            legendaryCount > 1 ? h("p", { class: "text-danger field-hint" }, "Un personnage ne porte qu'une arme légendaire : décochez les autres.") : null,
          ]),
        );
      }

      // Manual adjustments
      parts.push(
        h("fieldset", { class: "launcher__group" }, [
          h("legend", {}, "Ajustements manuels"),
          h("div", { class: "launcher__adjust" }, [
            h("div", { class: "launcher__adjust-item" }, [
              h("span", { class: "launcher__adjust-label" }, "Dés"),
              stepper({ label: "Dés en plus ou en moins", value: config.diceAdjust, focusKey: "adj-dice", onChange: (value) => { config.diceAdjust = value; render(); } }),
            ]),
            h("div", { class: "launcher__adjust-item" }, [
              h("span", { class: "launcher__adjust-label" }, "Succès"),
              stepper({ label: "Succès automatiques en plus ou en moins", value: config.successAdjust, focusKey: "adj-succ", onChange: (value) => { config.successAdjust = value; render(); } }),
            ]),
          ]),
          h(
            "div",
            { class: "row" },
            R.ROLL_ADJUSTMENT_PRESETS.map((presetEntry, index) =>
              h(
                "button",
                {
                  class: "btn btn--sm",
                  type: "button",
                  title: presetEntry.title,
                  "data-focus-key": `preset-${index}`,
                  onClick: () => {
                    config.successAdjust += presetEntry.value;
                    render();
                  },
                },
                `${presetEntry.label} ${signed(presetEntry.value)}`,
              ),
            ),
          ),
        ]),
      );

      // Waiting aspect effects
      const rollEffects = sheet.pendingAspects
        .map((key) => R.ASPECT_EFFECTS.find((effect) => effect.key === key))
        .filter((effect) => effect && effect.target === "roll");
      if (rollEffects.length) {
        parts.push(
          h("div", { class: "notice notice--info" }, [
            h("strong", {}, "Aspects appelés pour ce jet : "),
            rollEffects.map((effect) => effect.short).join(", "),
            ".",
          ]),
        );
      }

      // Summary + roll button
      const spontaneous = C.spontaneousDifficulty(pool.dice, pool.auto);
      parts.push(
        h("div", { class: "launcher__summary" }, [
          h("p", { class: "launcher__pool" }, [
            h("strong", {}, `Réserve : ${plural(pool.dice, "dé", "dés")}`),
            pool.diceParts.length ? ` (${pool.diceParts.map((part) => `${part.label} ${signed(part.value)}`).join(", ")})` : "",
          ]),
          h("p", { class: "launcher__pool" }, [
            h("strong", {}, `Succès automatiques : ${signed(pool.auto)}`),
            pool.autoParts.length ? ` (${pool.autoParts.map((part) => `${part.label} ${signed(part.value)}`).join(", ")})` : "",
          ]),
          h(
            "p",
            { class: "launcher__spontaneous" },
            spontaneous > 0
              ? `Réussite spontanée jusqu'à difficulté ${spontaneous} (${C.qualityFor(spontaneous).difficulty}).`
              : "Pas de réussite spontanée : il faut lancer les dés.",
          ),
        ]),
      );

      const rollButton = h("button", { class: "btn btn--primary launcher__roll", type: "button", "data-focus-key": "do-roll" }, `Lancer ${plural(pool.dice, "dé", "dés")}`);
      rollButton.addEventListener("click", doRoll);
      parts.push(rollButton);

      return parts;
    }

    // --- Result screen ---

    function buildResult(sheet) {
      const values = roll.dice.map((die) => die.value);
      const diceSuccesses = C.countSuccesses(values, roll.ignoreFours);
      const total = diceSuccesses + roll.auto;
      const quality = C.qualityFor(total);
      const rerollsLeft = roll.checkedTraits.size - roll.rerollsUsed;
      const traits = sheet.traits[roll.stat].slice(0, sheet.stats[roll.stat]).map((text, index) => ({ text: text.trim(), index }));
      const filledTraits = traits.filter((trait) => trait.text);

      const parts = [h("p", { class: "launcher__label" }, roll.label)];

      parts.push(
        roll.dice.length
          ? h(
              "div",
              { class: "dice-tray", role: "group", "aria-label": "Dés lancés" },
              roll.dice.map((die, index) => dieButton(die, index, { canReroll: rerollsLeft > 0, onReroll: rerollDie, ignoreFours: roll.ignoreFours })),
            )
          : h("p", { class: "text-faint" }, "Aucun dé à lancer : seuls les succès automatiques comptent."),
      );
      parts.push(
        h("p", { class: "dice-legend" }, [
          h("span", { class: "dice-legend__item dice-legend__item--crit" }, "10 = 2 succès"),
          h("span", { class: "dice-legend__item dice-legend__item--success" }, "5 à 9 = 1"),
          h("span", { class: "dice-legend__item dice-legend__item--cancel" }, roll.ignoreFours ? "4 = ignoré" : "4 = −1"),
          h("span", { class: "dice-legend__item dice-legend__item--fail" }, "1 à 3 = 0"),
        ]),
      );

      // Trait rerolls
      parts.push(
        h("fieldset", { class: "launcher__group" }, [
          h("legend", {}, `Traits de ${C.statDef(roll.stat).label} : 1 relance par trait qui s'applique`),
          filledTraits.length
            ? h(
                "div",
                { class: "launcher__items" },
                filledTraits.map((trait) => {
                  const checked = roll.checkedTraits.has(trait.index);
                  const locked = checked && roll.checkedTraits.size <= roll.rerollsUsed;
                  const box = h("input", { type: "checkbox", id: `launcher-trait-${trait.index}`, "data-focus-key": `trait-${trait.index}`, checked, disabled: locked || !roll.dice.length });
                  box.addEventListener("change", () => {
                    if (box.checked) roll.checkedTraits.add(trait.index);
                    else roll.checkedTraits.delete(trait.index);
                    render();
                  });
                  return h("label", { class: "checkbox-field", for: `launcher-trait-${trait.index}` }, [box, trait.text]);
                }),
              )
            : h("p", { class: "text-faint" }, "Aucun trait écrit sous cette caractéristique (onglet Ninja)."),
          roll.checkedTraits.size
            ? h(
                "p",
                { class: "field-hint", "aria-live": "polite" },
                rerollsLeft > 0
                  ? `${plural(rerollsLeft, "relance disponible", "relances disponibles")} : touchez le dé à relancer.`
                  : `${plural(roll.rerollsUsed, "relance utilisée", "relances utilisées")}.`,
              )
            : null,
        ]),
      );

      if (roll.rerollFails === "available") {
        parts.push(h("button", { class: "btn", type: "button", "data-focus-key": "reroll-fails", onClick: rerollAllFails }, "Aspect : relancer tous les échecs (4 inclus)"));
      }
      if (roll.ignoreWounds) {
        parts.push(h("p", { class: "notice notice--info" }, "Aspect appelé : ignorez le malus des blessures pour ce test (à signaler au conteur)."));
      }

      parts.push(
        h("div", { class: "launcher__result", "aria-live": "polite" }, [
          h("div", { class: "launcher__total" }, [
            h("span", { class: "launcher__total-value" }, String(total)),
            h("span", { class: "launcher__total-label" }, "succès"),
          ]),
          h("div", {}, [
            h("p", { class: "launcher__quality" }, `Réussite ${quality.label.toLowerCase()}`),
            h(
              "p",
              { class: "text-muted" },
              `Dés : ${signed(diceSuccesses)} · Automatiques : ${signed(roll.auto)}${roll.autoParts.length ? ` (${roll.autoParts.map((part) => `${part.label} ${signed(part.value)}`).join(", ")})` : ""}`,
            ),
          ]),
        ]),
      );

      const again = h("button", { class: "btn btn--primary", type: "button", "data-focus-key": "new-roll" }, "Nouveau jet");
      again.addEventListener("click", () => {
        roll = null;
        render();
      });
      parts.push(h("div", { class: "row" }, [again]));
      return parts;
    }

    function buildHistory(sheet) {
      if (!sheet.rolls.length) return null;
      return h("details", { class: "launcher__history" }, [
        h("summary", {}, `Derniers jets (${sheet.rolls.length})`),
        h(
          "ol",
          { class: "roll-history" },
          sheet.rolls.map((entry) =>
            h("li", { class: "roll-history__item" }, [
              h("span", { class: "roll-history__total" }, `${entry.total} · ${C.qualityFor(entry.total).label}`),
              h("span", {}, entry.label),
              h("span", { class: "roll-history__dice" }, entry.dice.length ? `Dés : ${entry.dice.map((die) => die.value).join(" ")} · auto ${signed(entry.auto)}` : `auto ${signed(entry.auto)}`),
              h("span", { class: "text-faint" }, formatDateTime(entry.timestamp)),
            ]),
          ),
        ),
      ]);
    }

    function render() {
      const profile = getProfileById(profileId);
      if (!profile) {
        closeModal();
        return;
      }
      const sheet = freshSheet();
      rerenderKeepingFocus(body, () => {
        clearElement(body);
        body.append(...(roll ? buildResult(sheet) : buildSetup(profile, sheet)));
        const history = buildHistory(sheet);
        if (history) body.append(history);
      });
    }

    render();
    openModal({
      title: technique ? "Lancer la technique" : "Lancer les dés",
      body,
      wide: true,
      footer: [h("button", { class: "btn", type: "button", onClick: () => closeModal() }, "Fermer")],
    });
  }

  /**
   * "Lancer la technique": the art must be at least the technique's chakra cost; the extra
   * chakra (+1 die per point) is limited so cost + extra ≤ the art. Spends the chakra (refused
   * if the gauge is too low), then opens the launcher filled in.
   * @param {string} profileId
   * @param {string} techniqueId
   * @returns {void}
   */
  function openTechniqueLauncher(profileId, techniqueId) {
    const profile = getProfileById(profileId);
    if (!profile) return;
    const sheet = getSheet(profile);
    const technique = sheet.techniques.find((tech) => tech.id === techniqueId);
    if (!technique) return;
    const info = C.techniqueInfo(sheet, technique);
    let extra = 0;

    const body = h("div", { class: "stack" });
    const confirmButton = h("button", { class: "btn btn--primary", type: "button" });

    function render() {
      const total = info.cost + extra;
      const enoughChakra = sheet.chakra.current >= total;
      const blockedReason =
        sheet.mode !== "jeu"
          ? "Passez la fiche en mode Jeu pour lancer une technique."
          : !info.usable
            ? `Technique bloquée : ${info.artLabel} ${info.artValue} est inférieur au coût en chakra (${info.cost}). Il faut au moins ${info.artLabel} ${info.cost}.`
            : !enoughChakra
              ? `Chakra insuffisant : ${total} nécessaire, ${sheet.chakra.current} restant.`
              : null;

      rerenderKeepingFocus(body, () => {
        clearElement(body);
        body.append(
          h("p", {}, [
            h("strong", {}, technique.name || "Technique sans nom"),
            ` · ${info.artLabel} · rang ${technique.rank} · maîtrise ${info.mastery.label}${technique.element ? ` · ${C.elementLabel(technique.element)} ${signed(info.elementBonus)}` : ""}`,
          ]),
          h("p", { class: "text-muted" }, `Coût : ${plural(info.cost, "point", "points")} de chakra. ${info.artLabel} ${info.artValue} : au plus ${info.artValue} chakra par action.`),
          info.usable
            ? h("div", { class: "launcher__adjust-item" }, [
                h("span", { class: "launcher__adjust-label" }, "Chakra supplémentaire (+1 dé par point)"),
                stepper({
                  label: "Chakra supplémentaire",
                  value: extra,
                  min: 0,
                  max: info.maxExtra,
                  focusKey: "extra-chakra",
                  onChange: (value) => {
                    extra = Math.max(0, Math.min(info.maxExtra, value));
                    render();
                  },
                }),
                h("span", { class: "field-hint" }, `Maximum ${info.maxExtra} (coût + supplément ≤ ${info.artLabel} ${info.artValue}).`),
              ])
            : null,
          h("p", {}, `Chakra : ${sheet.chakra.current} / ${sheet.chakra.max}${blockedReason ? "" : ` → ${sheet.chakra.current - total} après la technique`}.`),
          blockedReason ? h("p", { class: "notice notice--danger", role: "alert" }, blockedReason) : null,
        );
      });
      confirmButton.textContent = `Dépenser ${total} chakra et lancer`;
      confirmButton.disabled = Boolean(blockedReason);
    }

    confirmButton.addEventListener("click", () => {
      const result = spendChakra(profileId, info.cost + extra);
      if (!result.ok) {
        window.alert(result.message);
        return;
      }
      openDiceLauncher(profileId, { techniqueId, extraChakra: extra });
    });

    render();
    openModal({
      title: "Lancer la technique",
      body,
      footer: [h("button", { class: "btn", type: "button", onClick: () => closeModal() }, "Annuler"), confirmButton],
    });
  }

  App.diceLauncher = { openDiceLauncher, openTechniqueLauncher };
})();

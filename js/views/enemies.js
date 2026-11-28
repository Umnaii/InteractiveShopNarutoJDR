/**
 * Enemies view ("Ennemis"), for the GM: a free dice roll, and the GM characters of the
 * session (seconds couteaux and groups of figurants, rules p. 108-109) as small cards:
 * name, D10, automatic successes, énergie vitale, a roll button. No detailed sheet.
 * Enemies can be filed in named groups: a group is a collapsible block (closed by
 * default, so a filed enemy only shows once its group is opened) that exports to / imports
 * from a .json file in one go. Unfiled enemies are listed below the groups.
 *
 * Plain script: attaches its API to the shared App namespace as App.enemiesView.
 * Depends on App.ninjaRules, App.sheetCalc, App.enemies, App.state, App.dom, App.modal,
 * App.profileTransfer.
 */

(function () {
  "use strict";
  window.App = window.App || {};

  const R = App.ninjaRules;
  const C = App.sheetCalc;
  const E = App.enemies;
  const { subscribe } = App.state;
  const { h, clearElement, rerenderKeepingFocus } = App.dom;
  const { openModal, closeModal } = App.modal;
  const { slugify, downloadFile, pickJsonFile } = App.profileTransfer;

  /** Above this many dice, they are drawn smaller so a big pool stays readable. */
  const COMPACT_DICE_FROM = 13;

  const DIE_LABELS = { crit: "2 succès", success: "1 succès", cancel: "annule un succès", fail: "aucun succès" };

  function signed(value) {
    return value > 0 ? `+${value}` : value < 0 ? `−${Math.abs(value)}` : "0";
  }

  /**
   * −/+ buttons around a number field the GM can also type in.
   * @param {{value: number, min: number, max: number, label: string, focusKey: string, onChange: (value: number) => void, showSign?: boolean}} options
   */
  function numberStepper({ value, min, max, label, focusKey, onChange }) {
    const input = h("input", {
      id: `stepper-${focusKey}`,
      class: "stepper__input",
      type: "number",
      inputmode: "numeric",
      min: String(min),
      max: String(max),
      value: String(value),
      "aria-label": label,
      "data-focus-key": focusKey,
    });
    input.addEventListener("change", () => {
      const typed = Math.round(Number(input.value));
      onChange(Number.isFinite(typed) ? Math.min(max, Math.max(min, typed)) : value);
    });
    const minus = h("button", { class: "stepper__btn", type: "button", "data-focus-key": `${focusKey}-minus`, "aria-label": `${label} : moins`, disabled: value <= min }, "−");
    const plus = h("button", { class: "stepper__btn", type: "button", "data-focus-key": `${focusKey}-plus`, "aria-label": `${label} : plus`, disabled: value >= max }, "+");
    minus.addEventListener("click", () => onChange(value - 1));
    plus.addEventListener("click", () => onChange(value + 1));
    return h("div", { class: "stepper stepper--input", role: "group", "aria-label": label }, [minus, input, plus]);
  }

  /** <select> "Non rangé" + every group. */
  function groupPicker(selectedId, groups, attrs) {
    return h("select", attrs, [
      h("option", { value: "", selected: !selectedId }, "Non rangé"),
      ...groups.map((group) => h("option", { value: group.id, selected: group.id === selectedId }, group.name)),
    ]);
  }

  /** A caption above a stepper, tied to its number field. */
  function labelled(label, control) {
    const input = control.querySelector("input");
    return h("div", { class: "enemy-field" }, [h("label", { class: "enemy-field__label", for: input?.id }, label), control]);
  }

  /** Dice, total and quality of a roll (same colors as the players' launcher). */
  function buildRollResult(roll, extra) {
    const dice = roll.values.length
      ? h(
          "div",
          { class: `dice-tray${roll.values.length >= COMPACT_DICE_FROM ? " dice-tray--compact" : ""}`, role: "group", "aria-label": "Dés lancés" },
          roll.values.map((value, index) => {
            const kind = C.dieKind(value);
            return h("span", { class: `die die--${kind}`, role: "img", "aria-label": `Dé ${index + 1} : ${value} (${DIE_LABELS[kind]})` }, String(value));
          }),
        )
      : h("p", { class: "text-faint" }, "Aucun dé : seuls les succès automatiques comptent.");
    return h("div", { class: "enemy-roll", "aria-live": "polite" }, [
      dice,
      h("div", { class: "enemy-roll__summary" }, [
        h("span", { class: "enemy-roll__total" }, String(roll.total)),
        h("span", { class: "enemy-roll__label" }, "succès"),
        h("span", { class: "enemy-roll__detail" }, [
          h("strong", {}, `Réussite ${roll.quality.label.toLowerCase()}`),
          ` · dés ${signed(roll.diceSuccesses)}, auto ${signed(roll.auto)}`,
        ]),
      ]),
      extra ? h("p", { class: "field-hint" }, extra) : null,
    ]);
  }

  /**
   * Render the enemies view.
   * @param {HTMLElement} container
   * @returns {() => void} Cleanup function.
   */
  function renderEnemiesView(container) {
    /** Last roll of each enemy, for this visit only (not saved). */
    const rolls = new Map();
    const freeRoll = { dice: 10, auto: 0, result: null };
    const form = { name: "", kind: "second", tier: R.NPC_TIERS[0].key, count: R.FIGURANTS_DEFAULT_COUNT, groupId: "" };
    /** Groups shown open (closed by default: a filed enemy only shows once its group is opened). */
    const openGroups = new Set();
    let newGroupName = "";

    function rerender() {
      rerenderKeepingFocus(container, render);
    }

    function render() {
      clearElement(container);
      const enemies = E.getEnemies();
      const groups = E.getGroups();
      for (const id of rolls.keys()) if (!enemies.some((enemy) => enemy.id === id)) rolls.delete(id);
      for (const id of openGroups) if (!groups.some((group) => group.id === id)) openGroups.delete(id);
      if (form.groupId && !groups.some((group) => group.id === form.groupId)) form.groupId = "";
      const unfiled = enemies.filter((enemy) => !enemy.groupId);

      container.append(
        h("div", { class: "view-header" }, [
          h("h1", {}, "Ennemis"),
          h("p", { class: "text-muted" }, "Pour le conteur : les PNJ de la séance, sans fiche détaillée (règles p. 108-109). Le tableau des valeurs ne fait que proposer des dés, tout se règle à la main."),
        ]),
        h("div", { class: "enemies-top" }, [buildFreeRollCard(), buildCreateCard(groups)]),
        buildGroupsSection(groups, enemies),
        h("section", { class: "enemies-unfiled", "aria-labelledby": "enemies-unfiled-title" }, [
          h("h2", { id: "enemies-unfiled-title", class: "enemies-section-title" }, groups.length ? "Non rangés" : "Ennemis"),
          unfiled.length
            ? h("div", { class: "enemies-list" }, unfiled.map((enemy) => buildEnemyCard(enemy, groups)))
            : h("div", { class: "empty-state" }, [
                h("p", {}, groups.length ? "Aucun ennemi hors des groupes." : "Aucun ennemi pour l'instant. Ajoutez un second couteau ou un groupe de figurants ci-dessus."),
              ]),
          unfiled.length
            ? h("div", { class: "enemies-footer" }, [
                h("button", { class: "btn btn--danger", type: "button", "data-focus-key": "clear-all", onClick: () => confirmClearUnfiled(unfiled.length, groups.length > 0) }, groups.length ? "Retirer les ennemis non rangés" : "Retirer tous les ennemis"),
              ])
            : null,
        ]),
      );
    }

    // --- Groups (folders) ---

    function buildGroupsSection(groups, enemies) {
      const nameInput = h("input", { type: "text", id: "enemy-group-new-name", maxlength: String(E.NAME_MAX_LENGTH), placeholder: "ex. Embuscade du col", value: newGroupName, autocomplete: "off", "data-focus-key": "group-new-name" });
      nameInput.addEventListener("input", () => {
        newGroupName = nameInput.value;
      });
      const createButton = h("button", { class: "btn", type: "button", "data-focus-key": "group-create" }, "Créer le groupe");
      const create = () => {
        const name = newGroupName;
        newGroupName = "";
        const { group } = E.createGroup(name);
        openGroups.add(group.id);
        rerender();
      };
      createButton.addEventListener("click", create);
      nameInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter") create();
      });
      const importButton = h("button", { class: "btn btn--ghost", type: "button", "data-focus-key": "group-import", onClick: importGroupFile }, "Importer un groupe");

      return h("section", { class: "enemy-groups", "aria-labelledby": "enemy-groups-title" }, [
        h("h2", { id: "enemy-groups-title", class: "enemies-section-title" }, "Groupes"),
        h("p", { class: "field-hint" }, "Pour ranger les ennemis et les exporter en une fois. Un ennemi rangé n'apparaît qu'en ouvrant son groupe."),
        h("div", { class: "enemy-groups__tools" }, [
          h("div", { class: "field enemy-groups__new" }, [h("label", { for: "enemy-group-new-name" }, "Nouveau groupe"), nameInput]),
          createButton,
          importButton,
        ]),
        ...groups.map((group) => buildGroupBlock(group, enemies.filter((enemy) => enemy.groupId === group.id), groups)),
      ]);
    }

    function buildGroupBlock(group, members, groups) {
      const key = group.id;
      const details = h("details", { class: "enemy-group", open: openGroups.has(group.id) });
      details.addEventListener("toggle", () => {
        if (details.open) openGroups.add(group.id);
        else openGroups.delete(group.id);
      });

      const renameInput = h("input", { type: "text", id: `${key}-rename`, maxlength: String(E.NAME_MAX_LENGTH), value: group.name, autocomplete: "off", "data-focus-key": `${key}-rename` });
      renameInput.addEventListener("change", () => {
        const result = E.renameGroup(group.id, renameInput.value);
        if (!result.ok) renameInput.value = group.name;
      });

      const exportButton = h("button", { class: "btn", type: "button", "data-focus-key": `${key}-export`, disabled: !members.length, title: members.length ? "Télécharger ce groupe en fichier .json" : "Groupe vide" }, "Exporter");
      exportButton.addEventListener("click", () => {
        const payload = E.exportGroup(group.id);
        if (payload) downloadFile(`ennemis-${slugify(group.name)}.json`, JSON.stringify(payload, null, 2), "application/json");
      });
      const deleteButton = h("button", { class: "btn btn--ghost", type: "button", "data-focus-key": `${key}-delete`, onClick: () => confirmDeleteGroup(group, members.length) }, "Supprimer le groupe");

      details.append(
        h("summary", { class: "enemy-group__summary" }, [
          h("span", { class: "enemy-group__name" }, group.name),
          h("span", { class: "enemy-group__count" }, members.length > 1 ? `${members.length} ennemis` : `${members.length} ennemi`),
        ]),
        h("div", { class: "enemy-group__body" }, [
          h("div", { class: "enemy-group__tools" }, [
            h("div", { class: "field enemy-group__rename" }, [h("label", { for: `${key}-rename` }, "Nom du groupe"), renameInput]),
            exportButton,
            deleteButton,
          ]),
          members.length
            ? h("div", { class: "enemies-list" }, members.map((enemy) => buildEnemyCard(enemy, groups)))
            : h("p", { class: "text-faint" }, "Groupe vide : choisissez-le dans « Ranger dans » sur la carte d'un ennemi, ou à la création."),
        ]),
      );
      return details;
    }

    function importGroupFile() {
      pickJsonFile((text) => {
        const parsed = E.parseGroupExport(text);
        if (!parsed.ok) {
          window.alert(parsed.message);
          return;
        }
        const result = E.importGroup(parsed);
        openGroups.add(result.group.id);
        rerender();
      });
    }

    function confirmDeleteGroup(group, count) {
      const deleteWith = (withEnemies) => {
        E.deleteGroup(group.id, { withEnemies });
        closeModal();
      };
      openModal({
        title: `Supprimer le groupe « ${group.name} » ?`,
        body: h("p", {}, count ? `Il contient ${count > 1 ? `${count} ennemis` : "1 ennemi"}. Vous pouvez les garder (ils reviennent dans « Non rangés ») ou les supprimer avec le groupe.` : "Ce groupe est vide."),
        footer: count
          ? [
              h("button", { class: "btn", type: "button", onClick: () => closeModal() }, "Annuler"),
              h("button", { class: "btn", type: "button", "data-action": "keep", onClick: () => deleteWith(false) }, "Garder les ennemis"),
              h("button", { class: "btn btn--danger", type: "button", "data-action": "with", onClick: () => deleteWith(true) }, "Tout supprimer"),
            ]
          : [
              h("button", { class: "btn", type: "button", onClick: () => closeModal() }, "Annuler"),
              h("button", { class: "btn btn--danger", type: "button", "data-action": "with", onClick: () => deleteWith(true) }, "Supprimer"),
            ],
      });
    }

    // --- Free roll ---

    function buildFreeRollCard() {
      const rollButton = h("button", { class: "btn btn--primary", type: "button", "data-focus-key": "free-roll" }, `Lancer ${freeRoll.dice} D10`);
      rollButton.addEventListener("click", () => {
        freeRoll.result = E.rollPool(freeRoll.dice, freeRoll.auto);
        rerender();
      });
      return h("div", { class: "card card--ink stack" }, [
        h("h2", {}, "Jet libre"),
        h("p", { class: "field-hint" }, "N'importe quel nombre de dés, sans créer d'ennemi."),
        h("div", { class: "enemy-values" }, [
          labelled("D10", numberStepper({ value: freeRoll.dice, min: 0, max: E.DICE_MAX, label: "Jet libre : nombre de D10", focusKey: "free-dice", onChange: (v) => { freeRoll.dice = v; rerender(); } })),
          labelled("Succès auto", numberStepper({ value: freeRoll.auto, min: E.AUTO_MIN, max: E.AUTO_MAX, label: "Jet libre : succès automatiques", focusKey: "free-auto", onChange: (v) => { freeRoll.auto = v; rerender(); } })),
        ]),
        rollButton,
        freeRoll.result ? buildRollResult(freeRoll.result) : null,
      ]);
    }

    // --- New enemy ---

    function buildCreateCard(groups) {
      const nameInput = h("input", { type: "text", id: "enemy-new-name", maxlength: String(E.NAME_MAX_LENGTH), placeholder: form.kind === "figurants" ? "ex. Bandits du col" : "ex. Garde du daimyô", value: form.name, autocomplete: "off", "data-focus-key": "new-name" });
      nameInput.addEventListener("input", () => {
        form.name = nameInput.value;
      });

      const kindPicker = h(
        "div",
        { class: "segmented", role: "radiogroup", "aria-label": "Type d'ennemi" },
        R.NPC_KINDS.map((kind) =>
          h(
            "button",
            {
              class: `segmented__option${form.kind === kind.key ? " is-selected" : ""}`,
              type: "button",
              role: "radio",
              "aria-checked": form.kind === kind.key ? "true" : "false",
              "data-focus-key": `new-kind-${kind.key}`,
              onClick: () => {
                form.kind = kind.key;
                rerender();
              },
            },
            kind.label,
          ),
        ),
      );

      let detail;
      if (form.kind === "second") {
        const tierSelect = h(
          "select",
          { id: "enemy-new-tier", "data-focus-key": "new-tier" },
          R.NPC_TIERS.map((tier) => h("option", { value: tier.key, selected: tier.key === form.tier }, tier.label)),
        );
        tierSelect.addEventListener("change", () => {
          form.tier = tierSelect.value;
          rerender();
        });
        const tier = E.tierDef(form.tier);
        detail = h("div", { class: "field" }, [
          h("label", { for: "enemy-new-tier" }, "Valeur"),
          tierSelect,
          h("span", { class: "field-hint" }, `Tests moyens : ${E.rangeLabel(tier.dice)} D10, ${E.rangeLabel(tier.auto)} succès auto.`),
        ]);
      } else {
        detail = h("div", { class: "stack" }, [
          labelled("Nombre de figurants", numberStepper({ value: form.count, min: 1, max: E.VITALITY_MAX, label: "Nombre de figurants", focusKey: "new-count", onChange: (v) => { form.count = v; rerender(); } })),
          h("span", { class: "field-hint" }, "1 point d'énergie vitale par figurant ; on lance 1 D10 par figurant qui agit."),
        ]);
      }

      const addButton = h("button", { class: "btn btn--primary", type: "button", "data-focus-key": "new-add" }, "Ajouter");
      addButton.addEventListener("click", () => {
        const name = form.name;
        // Cleared first: creating the enemy re-renders the view right away.
        form.name = "";
        // Filed in a group: open it, or the new enemy would be hidden.
        if (form.groupId) openGroups.add(form.groupId);
        E.createEnemy({ name, kind: form.kind, tier: form.tier, count: form.count, groupId: form.groupId });
      });

      let groupField = null;
      if (groups.length) {
        const groupSelect = groupPicker(form.groupId, groups, { id: "enemy-new-group", "data-focus-key": "new-group" });
        groupSelect.addEventListener("change", () => {
          form.groupId = groupSelect.value;
        });
        groupField = h("div", { class: "field" }, [h("label", { for: "enemy-new-group" }, "Ranger dans"), groupSelect]);
      }

      return h("div", { class: "card card--ink stack" }, [
        h("h2", {}, "Nouvel ennemi"),
        h("div", { class: "field" }, [h("label", { for: "enemy-new-name" }, "Nom"), nameInput]),
        kindPicker,
        detail,
        groupField,
        addButton,
      ]);
    }

    // --- Enemy cards ---

    function buildEnemyCard(enemy, groups) {
      const key = enemy.id;
      const isGroup = enemy.kind === "figurants";

      const nameInput = h("input", { class: "enemy-card__name", type: "text", maxlength: String(E.NAME_MAX_LENGTH), value: enemy.name, "aria-label": "Nom de l'ennemi", "data-focus-key": `${key}-name` });
      nameInput.addEventListener("change", () => E.renameEnemy(enemy.id, nameInput.value));

      const parts = [
        h("div", { class: "enemy-card__head" }, [
          h("span", { class: `badge ${isGroup ? "badge--muted" : "badge--type-permanent"}` }, isGroup ? "Figurants" : "Second couteau"),
          nameInput,
        ]),
      ];

      if (!isGroup) {
        const tierSelect = h(
          "select",
          { "aria-label": "Valeur du PNJ", "data-focus-key": `${key}-tier` },
          [
            h("option", { value: "", selected: !enemy.tier }, "Libre"),
            ...R.NPC_TIERS.map((tier) => h("option", { value: tier.key, selected: tier.key === enemy.tier }, tier.label)),
          ],
        );
        tierSelect.addEventListener("change", () => E.setEnemyTier(enemy.id, tierSelect.value));
        const tier = E.tierDef(enemy.tier);
        parts.push(
          h("div", { class: "field enemy-card__tier" }, [
            tierSelect,
            tier ? h("span", { class: "field-hint" }, `Repère : ${E.rangeLabel(tier.dice)} D10 · ${E.rangeLabel(tier.auto)} auto`) : null,
          ]),
        );
      }

      parts.push(
        h("div", { class: "enemy-values" }, [
          labelled("D10", numberStepper({ value: enemy.dice, min: 0, max: E.DICE_MAX, label: `${enemy.name} : nombre de D10`, focusKey: `${key}-dice`, onChange: (v) => E.setEnemyValue(enemy.id, "dice", v) })),
          labelled("Succès auto", numberStepper({ value: enemy.auto, min: E.AUTO_MIN, max: E.AUTO_MAX, label: `${enemy.name} : succès automatiques`, focusKey: `${key}-auto`, onChange: (v) => E.setEnemyValue(enemy.id, "auto", v) })),
        ]),
      );

      const { current, max } = enemy.vitality;
      const ratio = max ? current / max : 0;
      parts.push(
        h("div", { class: "enemy-vitality" }, [
          h("div", { class: "enemy-values" }, [
            labelled(isGroup ? "Debout" : "Énergie vitale", numberStepper({ value: current, min: 0, max, label: `${enemy.name} : ${isGroup ? "figurants debout" : "énergie vitale"}`, focusKey: `${key}-vit`, onChange: (v) => E.setEnemyVitality(enemy.id, v) })),
            labelled(isGroup ? "Dans le groupe" : "Maximum", numberStepper({ value: max, min: 1, max: E.VITALITY_MAX, label: `${enemy.name} : ${isGroup ? "taille du groupe" : "énergie vitale maximum"}`, focusKey: `${key}-vitmax`, onChange: (v) => E.setEnemyVitalityMax(enemy.id, v) })),
          ]),
          h("div", { class: "gauge gauge--vitality enemy-gauge", role: "img", "aria-label": `${current} sur ${max}` }, [
            h("div", { class: "gauge__track" }, h("div", { class: "gauge__fill", style: `width:${Math.round(ratio * 100)}%` })),
          ]),
          E.enemyStatus(enemy) ? h("p", { class: "enemy-card__status" }, E.enemyStatus(enemy)) : null,
        ]),
      );

      const roll = rolls.get(enemy.id);
      const actions = h("div", { class: "enemy-card__actions" }, [
        h("button", {
          class: "btn btn--primary",
          type: "button",
          "data-focus-key": `${key}-roll`,
          onClick: () => {
            rolls.set(enemy.id, E.rollPool(enemy.dice, enemy.auto));
            rerender();
          },
        }, `Lancer ${enemy.dice} D10`),
        h("button", { class: "btn", type: "button", "data-focus-key": `${key}-dup`, title: "Ajouter un ennemi identique", onClick: () => E.duplicateEnemy(enemy.id) }, "Dupliquer"),
        h("button", { class: "btn btn--ghost", type: "button", "data-focus-key": `${key}-remove`, onClick: () => E.removeEnemy(enemy.id) }, "Retirer"),
      ]);
      parts.push(actions);

      if (groups.length) {
        const fileSelect = groupPicker(enemy.groupId, groups, { id: `${key}-group`, "data-focus-key": `${key}-group` });
        fileSelect.addEventListener("change", () => E.moveEnemy(enemy.id, fileSelect.value));
        parts.push(h("div", { class: "field enemy-card__file" }, [h("label", { for: `${key}-group` }, "Ranger dans"), fileSelect]));
      }

      if (isGroup) {
        parts.push(h("p", { class: "field-hint" }, `En soutien d'un ninja : +${E.helpBonus(enemy)} succès automatique(s), 1 par figurant présent (dans la limite du bon sens).`));
      }
      if (roll) {
        parts.push(buildRollResult(roll, isGroup ? null : `En aide d'un protagoniste : +${E.helpBonus(enemy, roll)} succès (la moitié, arrondie à l'inférieur).`));
      }

      return h("article", { class: `card enemy-card${current === 0 ? " is-down" : ""}`, "aria-label": enemy.name }, parts);
    }

    /** Remove the unfiled enemies (the groups and what they hold are kept). */
    function confirmClearUnfiled(count, hasGroups) {
      openModal({
        title: hasGroups ? "Retirer les ennemis non rangés ?" : "Retirer tous les ennemis ?",
        body: h("p", {}, `${count > 1 ? `Les ${count} ennemis` : "L'ennemi"} hors des groupes ${count > 1 ? "seront supprimés" : "sera supprimé"} (par exemple à la fin d'un combat).${hasGroups ? " Les groupes et leurs ennemis sont gardés." : ""}`),
        footer: [
          h("button", { class: "btn", type: "button", onClick: () => closeModal() }, "Annuler"),
          h("button", { class: "btn btn--danger", type: "button", onClick: () => { E.clearUnfiledEnemies(); closeModal(); } }, "Retirer"),
        ],
      });
    }

    render();
    return subscribe(() => rerender());
  }

  App.enemiesView = { renderEnemiesView };
})();

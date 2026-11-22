/**
 * Character sheet view ("Fiche"): the paper "ShinobiFichePerso.pdf" sheet of the active
 * profile, made interactive. Six panels (Ninja, Techniques, Éléments, Aspects, Sac,
 * Progression), one at a time behind tabs. A summary (gauges, initiative, purse, PX/PA,
 * dice) stays in view: a sticky sidebar on wide screens, a compact block above the tabs on
 * phones, where a floating "Lancer les dés" button also opens the dice launcher.
 *
 * Every change goes through App.sheet / App.profiles; this file only builds the DOM.
 * Text fields save as you type (debounced) WITHOUT rebuilding the view, so the phone
 * keyboard never closes mid-word; every other change rebuilds the view, keeping focus and
 * scroll (and waiting for the pointer to be released, so a click is never lost).
 *
 * Plain script: attaches its API to the shared App namespace as App.sheetView.
 * Depends on App.ninjaRules, App.sheetCalc, App.sheet, App.state, App.profiles, App.economy,
 * App.format, App.dom, App.modal, App.elementWheel, App.diceLauncher, App.profileTransfer.
 */

(function () {
  "use strict";
  window.App = window.App || {};

  const R = App.ninjaRules;
  const C = App.sheetCalc;
  const S = App.sheet;
  const { getActiveProfile, getProfiles, subscribe, isPersistent } = App.state;
  const { renameProfile, setProfileRank, duplicateProfile, setActiveProfile } = App.profiles;
  const { getItemById } = App.economy;
  const { getRankOptions, formatRyo, formatDateTime, initialOf } = App.format;
  const { h, clearElement, rerenderKeepingFocus } = App.dom;
  const { openModal, closeModal } = App.modal;
  const { createElementWheel } = App.elementWheel;
  const { openDiceLauncher, openTechniqueLauncher } = App.diceLauncher;
  const { downloadProfile, openImportPicker, confirmDeleteProfile, openCreateProfileModal } = App.profileTransfer;

  const TABS = [
    { key: "ninja", label: "Ninja" },
    { key: "techniques", label: "Techniques" },
    { key: "elements", label: "Éléments" },
    { key: "aspects", label: "Aspects" },
    { key: "sac", label: "Sac" },
    { key: "progression", label: "Progression" },
  ];
  const TEXT_COMMIT_DELAY_MS = 300;
  const TOAST_MS = 3500;

  /** Open tab, remembered for the whole session (also across navigations). */
  let currentTab = TABS[0].key;

  // --- Small formatting helpers ---

  function signed(value) {
    return value > 0 ? `+${value}` : value < 0 ? `−${Math.abs(value)}` : "0";
  }

  function plural(count, singular, pluralForm) {
    return `${count} ${Math.abs(count) > 1 ? pluralForm : singular}`;
  }

  // --- Toast (short feedback for refused actions) ---

  let toastElement = null;
  let toastTimer = 0;

  function showToast(message) {
    if (!message) return;
    if (!toastElement) {
      toastElement = h("div", { class: "sheet-toast", role: "status", "aria-live": "polite" });
      document.body.append(toastElement);
    }
    toastElement.textContent = message;
    toastElement.classList.add("is-visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastElement.classList.remove("is-visible"), TOAST_MS);
  }

  /** Show the message of a refused mutation. */
  function report(result) {
    if (result && !result.ok && result.message) showToast(result.message);
    return result;
  }

  /**
   * Render the character sheet view into a container.
   * @param {HTMLElement} container
   * @returns {() => void} Cleanup function to call when leaving the view.
   */
  function renderSheetView(container) {
    // --- Render scheduling (see the file header) ---
    let silentDepth = 0;
    let pointerDown = false;
    let renderPending = false;

    /** Run a mutation whose result is already on screen (text typed in a field): no rebuild. */
    function silently(mutation) {
      silentDepth += 1;
      try {
        return mutation();
      } finally {
        silentDepth -= 1;
      }
    }

    function onPointerDown() {
      pointerDown = true;
    }
    function onPointerUp() {
      pointerDown = false;
      if (renderPending) {
        renderPending = false;
        // After the click event that follows this pointerup.
        setTimeout(rerender, 0);
      }
    }
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("pointerup", onPointerUp, true);
    document.addEventListener("pointercancel", onPointerUp, true);

    function onStateChange() {
      if (silentDepth > 0) return;
      if (pointerDown) {
        renderPending = true;
        return;
      }
      rerender();
    }

    function rerender() {
      rerenderKeepingFocus(container, render);
    }

    // Drafts of the small "add" forms, kept across rebuilds (reset when the profile changes).
    let draftProfileId = null;
    let customDraft = null;
    let earnedDraft = null;
    function resetDrafts(profileId) {
      if (draftProfileId === profileId) return;
      draftProfileId = profileId;
      customDraft = { name: "", stat: "combat", dice: 1, successes: 0, legendary: false };
      earnedDraft = { px: "", pa: "" };
    }

    // In-place updated elements for text-driven displays (no rebuild while typing).
    let liveRefs = {};

    // --- Generic controls ---

    /**
     * Text field that saves as you type (debounced) and on blur, without rebuilding the view.
     * @param {{value: string, commit: (value: string) => object, focusKey: string, multiline?: boolean, onLiveInput?: (value: string) => void}} options
     * @param {object} attrs - Extra attributes (id, placeholder, aria-label, class...).
     */
    function textField(options, attrs) {
      const input = h(options.multiline ? "textarea" : "input", {
        ...(options.multiline ? { rows: 3 } : { type: "text" }),
        autocomplete: "off",
        ...attrs,
        "data-focus-key": options.focusKey,
      });
      input.value = options.value;
      let lastCommitted = options.value;
      let timer = 0;
      function flush() {
        clearTimeout(timer);
        if (input.value === lastCommitted) return;
        lastCommitted = input.value;
        const result = silently(() => options.commit(input.value));
        report(result);
      }
      input.addEventListener("input", () => {
        options.onLiveInput?.(input.value);
        clearTimeout(timer);
        timer = setTimeout(flush, TEXT_COMMIT_DELAY_MS);
      });
      input.addEventListener("change", flush);
      input.addEventListener("blur", flush);
      return input;
    }

    /** <select> with its value set after its options exist. */
    function selectField(attrs, choices, value, onChange) {
      const select = h(
        "select",
        attrs,
        choices.map((choice) => h("option", { value: choice.value, disabled: choice.disabled }, choice.label)),
      );
      select.value = value;
      select.addEventListener("change", () => onChange(select.value));
      return select;
    }

    /**
     * −/value/+ stepper (44 px touch targets on phones).
     * @param {{label: string, value: string|number, focusKey: string, onMinus: () => void, onPlus: () => void, minusDisabled?: boolean, plusDisabled?: boolean, plusTitle?: string}} options
     */
    function stepper(options) {
      return h("div", { class: "stepper", role: "group", "aria-label": options.label }, [
        h(
          "button",
          {
            class: "stepper__btn",
            type: "button",
            "data-focus-key": `${options.focusKey}-minus`,
            "aria-label": `${options.label} : moins`,
            disabled: Boolean(options.minusDisabled),
            onClick: options.onMinus,
          },
          "−",
        ),
        h("output", { class: "stepper__value", "aria-live": "polite" }, String(options.value)),
        h(
          "button",
          {
            class: "stepper__btn",
            type: "button",
            "data-focus-key": `${options.focusKey}-plus`,
            "aria-label": `${options.label} : plus`,
            title: options.plusTitle,
            disabled: Boolean(options.plusDisabled),
            onClick: options.onPlus,
          },
          "+",
        ),
      ]);
    }

    /**
     * Play mode: the value of something that only improves with PX/PA, next to a button
     * showing the price. The button stays disabled until the purchase is possible.
     * @param {object} sheet
     * @param {{label: string, value: string|number, purchase: object, onBuy: () => object, focusKey: string, gain?: string}} options
     */
    function paidValue(sheet, options) {
      const { purchase } = options;
      const currency = purchase.currency.toUpperCase();
      const available = C.experienceSummary(sheet)[purchase.currency].available;
      const reason = purchase.blocked
        ? purchase.blocked
        : available < purchase.cost
          ? `Il faut ${purchase.cost} ${currency}, ${available} disponible${available > 1 ? "s" : ""}`
          : null;
      return h("div", { class: "paid-value" }, [
        h("output", { class: "paid-value__value", "aria-label": options.label }, String(options.value)),
        h(
          "button",
          {
            class: "btn btn--sm paid-value__buy",
            type: "button",
            "data-focus-key": options.focusKey,
            disabled: Boolean(reason),
            title: reason ?? `Acheter : ${purchase.cost} ${currency}`,
            "aria-label": `${options.label} : ${reason ?? `améliorer pour ${purchase.cost} ${currency}`}`,
            onClick: () => report(options.onBuy()),
          },
          purchase.blocked ? purchase.blocked : `${options.gain ?? "+1"} · ${purchase.cost} ${currency}`,
        ),
      ]);
    }

    function button(label, onClick, attrs) {
      return h("button", { class: "btn", type: "button", ...attrs, onClick }, label);
    }

    function notice(kind, content) {
      return h("div", { class: `notice notice--${kind}` }, content);
    }

    function panel(key, title, content, extraClass) {
      return h(
        "section",
        {
          class: `sheet-panel sheet-panel--${key}${extraClass ? ` ${extraClass}` : ""}${currentTab === key ? " is-active" : ""}`,
          id: `sheet-panel-${key}`,
          role: "tabpanel",
          "aria-labelledby": `sheet-tab-${key}`,
        },
        [h("h2", { class: "sheet-panel__title" }, title), ...[].concat(content)],
      );
    }

    // --- Header: identity, mode, file actions ---

    function buildStorageWarning() {
      if (isPersistent()) return null;
      return notice("danger", [
        h("strong", {}, "Stockage indisponible. "),
        "Ce navigateur bloque l'enregistrement (navigation privée ?) : la fiche fonctionne, mais rien ne sera gardé après la fermeture de la page. Utilisez « Exporter » pour garder une copie.",
      ]);
    }

    function buildHeader(ctx) {
      const { profile, sheet } = ctx;
      const seal = h("span", { class: "profile-seal profile-seal--lg", "aria-hidden": "true" }, initialOf(profile.name));
      liveRefs.seal = seal;

      const nameInput = textField(
        {
          value: profile.name,
          focusKey: "name",
          commit: (value) => renameProfile(profile.id, value),
          onLiveInput: (value) => {
            if (value.trim()) seal.textContent = initialOf(value);
          },
        },
        { class: "sheet-head__name", id: "sheet-name", "aria-label": "Nom du ninja", placeholder: "Nom du ninja" },
      );

      const gradeSelect = selectField(
        { class: "rank-select", "data-rank": profile.rank, id: "sheet-grade", "data-focus-key": "grade", "aria-label": "Grade" },
        getRankOptions().map((rank) => ({ value: rank, label: rank })),
        profile.rank,
        (value) => report(setProfileRank(profile.id, value)),
      );

      const modeSwitch = h("div", { class: "segmented segmented--mode", role: "radiogroup", "aria-label": "Mode de la fiche" }, [
        h(
          "button",
          {
            class: `segmented__option${ctx.isCreation ? " is-selected" : ""}`,
            type: "button",
            role: "radio",
            "aria-checked": ctx.isCreation ? "true" : "false",
            "data-focus-key": "mode-creation",
            onClick: () => !ctx.isCreation && confirmBackToCreation(profile),
          },
          "Création",
        ),
        h(
          "button",
          {
            class: `segmented__option${!ctx.isCreation ? " is-selected" : ""}`,
            type: "button",
            role: "radio",
            "aria-checked": !ctx.isCreation ? "true" : "false",
            "data-focus-key": "mode-jeu",
            onClick: () => ctx.isCreation && validateCreation(ctx),
          },
          "Jeu",
        ),
      ]);

      const profiles = getProfiles();
      const sheetSelect = selectField(
        { id: "sheet-select", "data-focus-key": "sheet-select", "aria-label": "Fiche affichée" },
        profiles.map((entry) => ({ value: entry.id, label: `${entry.name} (${entry.rank})` })),
        profile.id,
        (value) => report(setActiveProfile(value)),
      );

      return h("header", { class: "sheet-head" }, [
        h("div", { class: "sheet-head__identity" }, [
          seal,
          h("div", { class: "sheet-head__who" }, [
            h("label", { class: "sheet-head__name-label", for: "sheet-name" }, "Nom"),
            nameInput,
            h("div", { class: "sheet-head__tags" }, [gradeSelect, h("span", { class: "sheet-head__mode-label" }, "Mode :"), modeSwitch]),
          ]),
        ]),
        h("div", { class: "sheet-head__files" }, [
          h("div", { class: "field sheet-head__select" }, [h("label", { for: "sheet-select" }, "Fiche"), sheetSelect]),
          h("div", { class: "sheet-head__actions" }, [
            button("Nouvelle", () => openCreateProfileModal(), { "data-focus-key": "act-new", title: "Créer une nouvelle fiche" }),
            button("Dupliquer", () => {
              const result = report(duplicateProfile(profile.id));
              if (result.ok) {
                setActiveProfile(result.profile.id);
                showToast(`Copie créée : « ${result.profile.name} ».`);
              }
            }, { "data-focus-key": "act-dup" }),
            button("Exporter", () => downloadProfile(profile), { "data-focus-key": "act-export", title: "Télécharger la fiche en fichier .json" }),
            button("Importer", () => openImportPicker((imported) => setActiveProfile(imported.id)), { "data-focus-key": "act-import", title: "Recharger une fiche .json" }),
            button("Supprimer", () => confirmDeleteProfile(profile), { class: "btn btn--danger", "data-focus-key": "act-delete" }),
          ]),
        ]),
        h("p", { class: "sheet-head__save" }, [
          h("strong", {}, "Sauvegarde automatique dans ce navigateur uniquement. "),
          "Pour passer du téléphone au PC, ou en cas de cache vidé : « Exporter » télécharge la fiche en .json, « Importer » la recharge sur l'autre appareil.",
        ]),
        ctx.isCreation ? buildCreationBar(ctx) : null,
      ]);
    }

    /** Show a panel: switch to its tab (phone) and scroll its top into view (all screens). */
    function goToPanel(key) {
      currentTab = key;
      rerender();
      const target = container.querySelector(`#sheet-panel-${key}`);
      if (!target) return;
      const headerHeight = document.querySelector(".app-header")?.offsetHeight ?? 0;
      window.scrollTo({ top: target.getBoundingClientRect().top + window.scrollY - headerHeight - 8, behavior: "auto" });
    }

    function budgetChip(label, remaining, total, extra, tabKey) {
      const over = remaining < 0;
      const tabLabel = TABS.find((tab) => tab.key === tabKey).label;
      return h("button", {
        class: `budget-chip${over ? " is-over" : remaining === 0 ? " is-done" : ""}`,
        type: "button",
        "data-focus-key": `chip-${label}`,
        title: `Aller à l'onglet ${tabLabel}`,
        onClick: () => goToPanel(tabKey),
      }, [
        h("span", { class: "budget-chip__value" }, String(remaining)),
        h("span", { class: "budget-chip__label" }, [
          over ? `${label} : budget dépassé de ${-remaining}` : `${label} restant${remaining > 1 ? "s" : ""}`,
          h("span", { class: "budget-chip__total" }, ` sur ${total}${extra ? ` · ${extra}` : ""}`),
          h("span", { class: "budget-chip__go" }, `Onglet ${tabLabel} ›`),
        ]),
      ]);
    }

    function buildCreationBar(ctx) {
      const { budget, profile, sheet } = ctx;
      const warnings = C.creationWarnings(sheet, profile.rank);
      const aspectsChip = h(
        "button",
        {
          class: `budget-chip${budget.aspects.filled >= budget.aspects.toStart ? " is-done" : ""}`,
          type: "button",
          "data-focus-key": "chip-aspects",
          title: "Aller à l'onglet Aspects",
          onClick: () => goToPanel("aspects"),
        },
        [
          h("span", { class: "budget-chip__value" }, String(budget.aspects.filled)),
          h("span", { class: "budget-chip__label" }, [
            `aspects remplis`,
            h("span", { class: "budget-chip__total" }, ` sur ${budget.aspects.max} · ${budget.aspects.toStart} suffisent`),
            h("span", { class: "budget-chip__go" }, "Onglet Aspects ›"),
          ]),
        ],
      );
      liveRefs.aspectsCount = aspectsChip.querySelector(".budget-chip__value");

      return h("div", { class: "creation-bar" }, [
        h("p", { class: "creation-bar__title" }, `Mode création · ${profile.rank}`),
        h("div", { class: "creation-bar__chips" }, [
          budgetChip("pts de caractéristique", budget.stats.remaining, budget.stats.total, "", "ninja"),
          budgetChip("pts d'art ninja", budget.arts.remaining, budget.arts.total, `max ${budget.arts.max} par art`, "ninja"),
          budgetChip("PA", budget.pa.remaining, budget.pa.total, "techniques et chakra", "techniques"),
          aspectsChip,
        ]),
        warnings.length ? h("ul", { class: "creation-bar__warnings" }, warnings.map((text) => h("li", {}, text))) : null,
        h("p", { class: "field-hint" }, "Recommandations du livre : pas de Sharingan au-delà du 1er Tomoe, pas de Senjutsu, pas de Yin-Yang à la création. Un seul clan et un seul Kekkei Genkai."),
        h("button", { class: "btn btn--primary", type: "button", "data-focus-key": "validate-creation", onClick: () => validateCreation(ctx) }, "Valider la création"),
      ]);
    }

    function validateCreation(ctx) {
      const { budget, profile } = ctx;
      const issues = [];
      if (budget.stats.remaining > 0) issues.push(`${plural(budget.stats.remaining, "point", "points")} de caractéristique non dépensé${budget.stats.remaining > 1 ? "s" : ""}`);
      if (budget.arts.remaining > 0) issues.push(`${plural(budget.arts.remaining, "point", "points")} d'art ninja non dépensé${budget.arts.remaining > 1 ? "s" : ""}`);
      if (budget.pa.remaining > 0) issues.push(`${plural(budget.pa.remaining, "PA", "PA")} non dépensé${budget.pa.remaining > 1 ? "s" : ""}`);
      for (const [label, entry] of [["caractéristiques", budget.stats], ["arts ninja", budget.arts], ["PA", budget.pa]]) {
        if (entry.remaining < 0) issues.push(`budget ${label} dépassé de ${-entry.remaining}`);
      }
      if (budget.aspects.filled < budget.aspects.toStart) issues.push(`seulement ${budget.aspects.filled} aspect${budget.aspects.filled > 1 ? "s" : ""} sur les ${budget.aspects.toStart} conseillés (onglet Aspects)`);

      const commit = () => {
        report(S.setMode(profile.id, "jeu"));
        showToast("Création validée : la fiche passe en mode Jeu.");
      };
      if (!issues.length) {
        commit();
        return;
      }
      openModal({
        title: "Valider la création ?",
        body: h("div", { class: "stack" }, [
          h("p", {}, "Il reste :"),
          h("ul", { class: "bullet-list" }, issues.map((text) => h("li", {}, text))),
          h("p", { class: "text-muted" }, "Vous pouvez valider quand même : rien n'est bloqué, et tout reste modifiable à la main."),
        ]),
        footer: [
          h("button", { class: "btn", type: "button", onClick: () => closeModal() }, "Continuer la création"),
          h("button", { class: "btn btn--primary", type: "button", onClick: () => { closeModal(); commit(); } }, "Valider quand même"),
        ],
      });
    }

    function confirmBackToCreation(profile) {
      openModal({
        title: "Repasser en mode création ?",
        body: h("div", { class: "stack" }, [
          h("p", {}, "Les budgets de création s'appliquent de nouveau : énergie vitale max, chakra max et valeurs des éléments sont recalculés depuis le grade et les rôles choisis (les achats PX/PA restent comptés)."),
          h("p", { class: "text-muted" }, "Les points de création pourront être redistribués, et les jauges seront remises au maximum."),
        ]),
        footer: [
          h("button", { class: "btn", type: "button", onClick: () => closeModal() }, "Rester en jeu"),
          h("button", { class: "btn btn--primary", type: "button", onClick: () => { closeModal(); report(S.setMode(profile.id, "creation")); } }, "Repasser en création"),
        ],
      });
    }

    // --- Tabs ---

    function buildTabs() {
      const tablist = h(
        "div",
        { class: "sheet-tabs", role: "tablist", "aria-label": "Parties de la fiche" },
        TABS.map((tab) =>
          h(
            "button",
            {
              class: `sheet-tabs__tab${currentTab === tab.key ? " is-active" : ""}`,
              type: "button",
              role: "tab",
              id: `sheet-tab-${tab.key}`,
              "aria-controls": `sheet-panel-${tab.key}`,
              "aria-selected": currentTab === tab.key ? "true" : "false",
              tabindex: currentTab === tab.key ? "0" : "-1",
              "data-focus-key": `tab-${tab.key}`,
              onClick: () => selectTab(tab.key),
            },
            tab.label,
          ),
        ),
      );
      // Arrow keys move between tabs (tab pattern).
      tablist.addEventListener("keydown", (event) => {
        const index = TABS.findIndex((tab) => tab.key === currentTab);
        const moves = { ArrowRight: 1, ArrowLeft: -1, Home: -index, End: TABS.length - 1 - index };
        if (!(event.key in moves)) return;
        event.preventDefault();
        selectTab(TABS[(index + moves[event.key] + TABS.length) % TABS.length].key);
      });
      return tablist;
    }

    function selectTab(key) {
      currentTab = key;
      rerender();
      container.querySelector(`#sheet-tab-${key}`)?.focus();
      // On a phone, bring the panel's top into view under the sticky tab bar.
      const tabs = container.querySelector(".sheet-tabs");
      if (tabs && window.getComputedStyle(tabs).display !== "none") {
        const top = tabs.getBoundingClientRect().top + window.scrollY - (document.querySelector(".app-header")?.offsetHeight ?? 0);
        if (window.scrollY > top) window.scrollTo({ top, behavior: "auto" });
      }
    }

    // --- Ninja panel: identity, characteristics + traits, ninja arts ---

    function buildNinjaPanel(ctx) {
      const { profile, sheet, isCreation, budget } = ctx;
      const identityFields = [
        { key: "surnom", label: "Surnom" },
        { key: "joueur", label: "Joueur" },
        { key: "clan", label: "Clan", placeholder: "Un seul clan" },
        { key: "sexe", label: "Sexe" },
        { key: "age", label: "Âge" },
      ];
      const affinity = sheet.elementRoles.affinity ? C.elementDef(sheet.elementRoles.affinity) : null;
      const second = sheet.elementRoles.second ? C.elementDef(sheet.elementRoles.second) : null;

      const identity = h("div", { class: "identity-grid" }, [
        ...identityFields.map((field) =>
          h("div", { class: "field" }, [
            h("label", { for: `id-${field.key}` }, field.label),
            textField(
              { value: sheet.identity[field.key], focusKey: `id-${field.key}`, commit: (value) => S.setIdentityField(profile.id, field.key, value) },
              { id: `id-${field.key}`, placeholder: field.placeholder },
            ),
          ]),
        ),
        h("div", { class: "field" }, [
          h("span", { class: "field__label" }, "Affinité"),
          h(
            "span",
            { class: "field__readonly", title: "Remplie depuis l'onglet Éléments" },
            affinity
              ? `${affinity.label} (${affinity.name}) ${signed(sheet.elements[affinity.key])}${second ? ` · ${second.label} ${signed(sheet.elements[second.key])}` : ""}`
              : "À choisir dans Éléments",
          ),
        ]),
        h("div", { class: "field identity-grid__wide" }, [
          h("label", { for: "id-description" }, "Description"),
          textField({ value: sheet.identity.description, focusKey: "id-description", multiline: true, commit: (value) => S.setIdentityField(profile.id, "description", value) }, { id: "id-description" }),
        ]),
      ]);

      // Characteristics
      const statCards = R.STATS.map((stat) => {
        const value = sheet.stats[stat.key];
        const plusBlocked = value >= R.STAT_MAX ? `Maximum ${R.STAT_MAX}` : isCreation && budget.stats.remaining <= 0 ? "Plus de points à répartir" : null;
        return h("div", { class: "stat-card" }, [
          h("div", { class: "stat-card__head" }, [
            h("h3", { class: "stat-card__name" }, stat.label),
            h("span", { class: "pips", "aria-hidden": "true" }, Array.from({ length: R.STAT_MAX }, (_, index) => h("span", { class: `pip${index < value ? " is-on" : ""}` }))),
            isCreation
              ? stepper({
                  label: stat.label,
                  value,
                  focusKey: `stat-${stat.key}`,
                  minusDisabled: value <= R.STAT_MIN,
                  plusDisabled: Boolean(plusBlocked),
                  plusTitle: plusBlocked ?? undefined,
                  onMinus: () => report(S.changeStat(profile.id, stat.key, -1)),
                  onPlus: () => report(S.changeStat(profile.id, stat.key, 1)),
                })
              : paidValue(sheet, {
                  label: stat.label,
                  value,
                  purchase: C.statUpgrade(sheet, stat.key),
                  focusKey: `buy-stat-${stat.key}`,
                  onBuy: () => S.buyStat(profile.id, stat.key),
                }),
          ]),
          h(
            "ol",
            { class: "trait-list", "aria-label": `Traits de ${stat.label}` },
            Array.from({ length: value }, (_, index) =>
              h(
                "li",
                {},
                textField(
                  { value: sheet.traits[stat.key][index], focusKey: `trait-${stat.key}-${index}`, commit: (text) => S.setTrait(profile.id, stat.key, index, text) },
                  { class: "trait-input", placeholder: `Trait ${index + 1}`, "aria-label": `${stat.label}, trait ${index + 1}` },
                ),
              ),
            ),
          ),
        ]);
      });

      // Ninja arts
      const artCells = R.ARTS.map((art) => {
        const value = sheet.arts[art.key];
        const plusBlocked = isCreation
          ? budget.arts.remaining <= 0
            ? "Plus de points à répartir"
            : value >= budget.arts.max
              ? `Maximum ${budget.arts.max} par art à la création`
              : null
          : null;
        return h("div", { class: "art-cell" }, [
          h("span", { class: "art-cell__name" }, art.label),
          h("span", { class: "art-cell__abbr" }, art.abbr),
          isCreation
            ? stepper({
                label: art.label,
                value,
                focusKey: `art-${art.key}`,
                minusDisabled: value <= 0,
                plusDisabled: Boolean(plusBlocked),
                plusTitle: plusBlocked ?? undefined,
                onMinus: () => report(S.changeArt(profile.id, art.key, -1)),
                onPlus: () => report(S.changeArt(profile.id, art.key, 1)),
              })
            : paidValue(sheet, {
                label: art.label,
                value,
                purchase: C.artUpgrade(sheet, art.key),
                focusKey: `buy-art-${art.key}`,
                onBuy: () => S.buyArt(profile.id, art.key),
              }),
        ]);
      });
      const restricted = profile.rank === "Genin" ? R.RESTRICTED_ARTS.filter((key) => sheet.arts[key] > 0) : [];

      return panel("ninja", "Ninja", [
        identity,
        h("div", { class: "sheet-subhead" }, [
          h("h3", {}, "Caractéristiques"),
          h(
            "p",
            { class: "field-hint" },
            isCreation
              ? `De 1 à 5. ${budget.stats.remaining >= 0 ? plural(budget.stats.remaining, "point restant", "points restants") : `Budget dépassé de ${-budget.stats.remaining}`} sur ${budget.stats.total} (le 1 de départ est compris). Autant de traits que la valeur ; chaque trait qui s'applique donne une relance.`
              : `Création validée : une caractéristique ne monte qu'en dépensant des PX (niveau visé × 2, max ${R.STAT_MAX}). Chaque point ajoute une ligne de trait ; chaque trait qui s'applique donne une relance.`,
          ),
        ]),
        h("div", { class: "stat-grid" }, statCards),
        h("div", { class: "sheet-subhead" }, [
          h("h3", {}, "Arts ninja"),
          h(
            "p",
            { class: "field-hint" },
            isCreation
              ? `${budget.arts.remaining >= 0 ? plural(budget.arts.remaining, "point restant", "points restants") : `Budget dépassé de ${-budget.arts.remaining}`} sur ${budget.arts.total}, maximum ${budget.arts.max} par art à la création. Fûinjutsu et Kuchiyose : Chûnin et plus, sauf exception.`
              : "Pas de limite haute après la création. Chaque point d'art ajoute 1 d10 au jet.",
          ),
        ]),
        h("div", { class: "art-grid" }, artCells),
        restricted.length
          ? notice("warning", `${restricted.map((key) => C.artDef(key).label).join(" et ")} : réservé aux Chûnin et plus, sauf exception accordée par le conteur. (Avertissement seulement.)`)
          : null,
      ]);
    }

    // --- Gauges, creation chakra, initiative (used by the sidebar and the Techniques panel) ---

    function gauge({ label, current, max, kind, status }) {
      const ratio = max > 0 ? Math.max(0, Math.min(1, current / max)) : 0;
      return h("div", { class: `gauge gauge--${kind}` }, [
        h("div", { class: "gauge__head" }, [
          h("span", { class: "gauge__label" }, label),
          h("span", { class: "gauge__numbers" }, [h("strong", {}, String(current)), ` / ${max}`]),
          status ? h("span", { class: `gauge__status gauge__status--${status.kind}` }, status.label) : null,
        ]),
        h("div", { class: "gauge__track", role: "meter", "aria-label": label, "aria-valuemin": "0", "aria-valuemax": String(max), "aria-valuenow": String(Math.max(0, current)) }, [
          h("div", { class: "gauge__fill", style: `width: ${ratio * 100}%` }),
        ]),
      ]);
    }

    /**
     * Creation mode, Techniques panel: creation PA turned into chakra (1 PA = +2 chakra max),
     * taken from the same PA budget as the techniques.
     */
    function buildCreationChakra(ctx) {
      const { profile, sheet, budget } = ctx;
      return h("div", { class: "creation-chakra" }, [
        h("div", {}, [
          h("strong", {}, "PA en chakra"),
          h("p", { class: "field-hint" }, `1 PA = +2 chakra max. Base ${profile.rank} : ${C.gradeRules(profile.rank).chakra}, soit ${sheet.chakra.max} chakra max avec ces PA.`),
        ]),
        stepper({
          label: "PA de création dépensés en chakra",
          value: sheet.creationChakraPa,
          focusKey: "creation-chakra",
          minusDisabled: sheet.creationChakraPa <= 0,
          plusDisabled: budget.pa.remaining <= 0,
          plusTitle: budget.pa.remaining <= 0 ? "Plus de PA de création" : undefined,
          onMinus: () => report(S.changeCreationChakraPa(profile.id, -1)),
          onPlus: () => report(S.changeCreationChakraPa(profile.id, 1)),
        }),
      ]);
    }

    /**
     * The initiative tool (roll + token piles) in a dialog, opened from the sidebar. It
     * rebuilds itself on every state change while open.
     */
    function openInitiativeModal() {
      const body = h("div", { class: "stack initiative" });
      function renderBody() {
        const profile = getActiveProfile();
        if (!profile) return closeModal();
        const sheet = S.getSheet(profile);
        rerenderKeepingFocus(body, () => {
          clearElement(body);
          body.append(...buildInitiative({ profile, sheet }));
        });
      }
      const unsubscribeModal = subscribe(renderBody);
      renderBody();
      openModal({
        title: "Initiative",
        body,
        onClose: unsubscribeModal,
        footer: [h("button", { class: "btn btn--primary", type: "button", onClick: () => closeModal() }, "Fermer")],
      });
    }

    function buildInitiative(ctx) {
      const { profile, sheet } = ctx;
      const bonus = C.initiativeBonus(sheet);
      const { total, piles, die } = sheet.initiative;
      const maxPiles = Math.max(0, sheet.vitality.current);

      const formula = [
        "1d10",
        `Combat ${bonus.combat}`,
        sheet.unlockedNatures.includes("hayaiton") ? `Hayaiton ${signed(bonus.hayaiton)}` : null,
        bonus.aspects ? `aspects ${signed(bonus.aspects)}` : null,
      ]
        .filter(Boolean)
        .join(" + ");

      function rollInitiative() {
        const current = S.getSheet(getActiveProfile());
        const parts = C.initiativeBonus(current);
        S.consumePendingAspects(profile.id, "initiative");
        const d10 = C.rollD10();
        const sum = d10 + parts.total;
        report(S.setInitiative(profile.id, { total: sum, die: d10, bonus: parts.total, piles: C.suggestPiles(sum, Math.max(0, current.vitality.current)) }));
      }

      const content = [
        h("p", { class: "field-hint" }, `Initiative = ${formula}. Le total donne des jetons à répartir en tas de tailles toutes différentes, pas plus de tas que d'énergie vitale.`),
        h("div", { class: "row" }, [
          h("button", { class: "btn btn--primary", type: "button", "data-focus-key": "init-roll", onClick: rollInitiative }, "Lancer l'initiative"),
          total !== null
            ? h("span", { class: "initiative__total" }, [
                h("strong", {}, `${total} jetons`),
                die ? ` (d10 = ${die}${sheet.initiative.bonus !== null ? `, bonus ${signed(sheet.initiative.bonus)}` : ""})` : "",
              ])
            : null,
        ]),
      ];

      if (total !== null) {
        const validation = C.validatePiles(piles, total, maxPiles);
        const setPiles = (next) => report(S.setInitiative(profile.id, { ...sheet.initiative, piles: next }));
        const phases = [...piles].sort((a, b) => b - a);

        content.push(
          h("div", { class: "initiative__total-edit" }, [
            h("span", { class: "field-hint" }, "Total (correction)"),
            stepper({
              label: "Total des jetons",
              value: total,
              focusKey: "init-total",
              minusDisabled: total <= 0,
              onMinus: () => report(S.setInitiative(profile.id, { ...sheet.initiative, total: total - 1 })),
              onPlus: () => report(S.setInitiative(profile.id, { ...sheet.initiative, total: total + 1 })),
            }),
          ]),
          h(
            "ol",
            { class: "pile-list", "aria-label": "Tas de jetons" },
            piles.map((pile, index) =>
              h("li", { class: "pile" }, [
                h("span", { class: "pile__label" }, `Tas ${index + 1}`),
                stepper({
                  label: `Tas ${index + 1}`,
                  value: pile,
                  focusKey: `pile-${index}`,
                  minusDisabled: pile <= 1,
                  onMinus: () => setPiles(piles.map((value, i) => (i === index ? value - 1 : value))),
                  onPlus: () => setPiles(piles.map((value, i) => (i === index ? value + 1 : value))),
                }),
                h("button", { class: "btn-icon", type: "button", "aria-label": `Retirer le tas ${index + 1}`, "data-focus-key": `pile-del-${index}`, onClick: () => setPiles(piles.filter((_, i) => i !== index)) }, "✕"),
              ]),
            ),
          ),
          h("div", { class: "row" }, [
            h(
              "button",
              {
                class: "btn btn--sm",
                type: "button",
                "data-focus-key": "pile-add",
                onClick: () => {
                  let size = 1;
                  while (piles.includes(size)) size += 1;
                  setPiles([...piles, size]);
                },
              },
              "Ajouter un tas",
            ),
            h("button", { class: "btn btn--sm", type: "button", "data-focus-key": "pile-auto", onClick: () => setPiles(C.suggestPiles(total, maxPiles)) }, "Répartition automatique"),
          ]),
          validation.ok
            ? notice("success", [h("strong", {}, "Répartition valide. "), `Vous agissez aux phases ${phases.join(", ")} (de la plus haute à la plus basse).`])
            : notice("warning", h("ul", { class: "bullet-list" }, validation.errors.map((text) => h("li", {}, text)))),
        );
      }

      return content;
    }

    // --- Techniques panel ---

    function masteryPicker(ctx, technique) {
      const { profile, sheet, isCreation, budget } = ctx;
      const currentIndex = C.masteryIndex(technique.mastery);
      const groupName = `mastery-${technique.id}`;
      return h(
        "fieldset",
        { class: "mastery-picker" },
        [
          h("legend", { class: "visually-hidden" }, `Niveau de maîtrise de ${technique.name || "la technique"}`),
          ...R.MASTERY_LEVELS.map((level, index) => {
            // In creation mode, levels the creation PA can't pay for are disabled.
            const extraCost = C.masteryCostFromStart(level.key) - C.masteryCostFromStart(technique.mastery);
            const unaffordable = isCreation && technique.origin !== "play" && index > currentIndex && extraCost > budget.pa.remaining;
            // In play mode the circles only show the level: it goes up with the paid « Maîtrise → » button.
            const locked = !isCreation;
            const effect = level.dice ? `${signed(level.dice)} dé${Math.abs(level.dice) > 1 ? "s" : ""}` : level.successes ? `${signed(level.successes)} succès` : "aucun effet";
            // Same abbreviations as the paper sheet's mastery header: −2D, −1D, 0, +1s...
            const shortEffect = level.dice ? `${signed(level.dice)}D` : level.successes ? `${signed(level.successes)}s` : "0";
            const id = `${groupName}-${level.key}`;
            const input = h("input", {
              type: "radio",
              name: groupName,
              id,
              value: level.key,
              checked: level.key === technique.mastery,
              disabled: unaffordable || locked,
              "data-focus-key": id,
            });
            input.addEventListener("change", () => report(S.updateTechnique(profile.id, technique.id, { mastery: level.key })));
            const why = unaffordable ? " (pas assez de PA de création)" : locked && level.key !== technique.mastery ? " (s'achète en PA)" : "";
            return h("label", { class: "mastery-picker__option", for: id, title: `${level.label} : ${effect}${why}` }, [
              input,
              h("span", { class: "mastery-picker__dot" }, level.key),
              h("span", { class: "mastery-picker__effect" }, shortEffect),
            ]);
          }),
        ],
      );
    }

    function confirmRemoveTechnique(profile, technique) {
      openModal({
        title: "Supprimer la technique ?",
        body: h("p", {}, `« ${technique.name || "Technique sans nom"} » sera retirée de la fiche. Les PA déjà dépensés ne sont pas rendus (utilisez « Annuler la dernière dépense » dans Progression si c'était un achat).`),
        footer: [
          h("button", { class: "btn", type: "button", onClick: () => closeModal() }, "Annuler"),
          h("button", { class: "btn btn--danger", type: "button", onClick: () => { closeModal(); report(S.removeTechnique(profile.id, technique.id)); } }, "Supprimer"),
        ],
      });
    }

    function buildTechniqueRow(ctx, technique) {
      const { profile, sheet, isCreation } = ctx;
      const info = C.techniqueInfo(sheet, technique);
      const upgrade = C.masteryUpgrade(technique);
      const canUpgrade = !isCreation && !upgrade.blocked && C.canAfford(sheet, upgrade);
      const blockedReason = !info.usable ? `${info.artLabel} ${info.artValue} < coût ${info.cost} : technique bloquée` : null;
      const tag = technique.origin === "start" ? "Offerte" : null;

      return h("li", { class: `technique${blockedReason ? " is-blocked" : ""}` }, [
        h("div", { class: "technique__main" }, [
          h("div", { class: "field technique__name" }, [
            h("label", { for: `tech-name-${technique.id}` }, ["Nom de la technique", tag ? h("span", { class: "badge badge--muted" }, tag) : null]),
            textField(
              { value: technique.name, focusKey: `tech-name-${technique.id}`, commit: (value) => S.updateTechnique(profile.id, technique.id, { name: value }) },
              { id: `tech-name-${technique.id}`, placeholder: "Nom (ou Dojutsu : Sharingan, Byakugan…)" },
            ),
          ]),
          h("div", { class: "field" }, [
            h("label", { for: `tech-art-${technique.id}` }, "Type"),
            selectField(
              { id: `tech-art-${technique.id}`, "data-focus-key": `tech-art-${technique.id}` },
              R.ARTS.map((art) => ({ value: art.key, label: art.abbr })),
              technique.art,
              (value) => report(S.updateTechnique(profile.id, technique.id, { art: value })),
            ),
          ]),
          h("div", { class: "field" }, [
            h("label", { for: `tech-rank-${technique.id}` }, "Rang"),
            selectField(
              { id: `tech-rank-${technique.id}`, "data-focus-key": `tech-rank-${technique.id}`, title: "Fixé par le conteur" },
              R.TECHNIQUE_RANKS.map((rank) => ({ value: rank.key, label: rank.key })),
              technique.rank,
              (value) => report(S.updateTechnique(profile.id, technique.id, { rank: value })),
            ),
          ]),
          h("div", { class: "field technique__cost" }, [h("span", { class: "field__label" }, "Chakra"), h("span", { class: "field__readonly" }, String(info.cost))]),
          h("div", { class: "field technique__element" }, [
            h("label", { for: `tech-el-${technique.id}` }, "Élément"),
            selectField(
              { id: `tech-el-${technique.id}`, "data-focus-key": `tech-el-${technique.id}` },
              C.techniqueElementOptions(sheet, technique.element),
              technique.element,
              (value) => report(S.updateTechnique(profile.id, technique.id, { element: value })),
            ),
          ]),
        ]),
        h("div", { class: "technique__mastery" }, [h("span", { class: "field__label" }, "Maîtrise"), masteryPicker(ctx, technique)]),
        h("div", { class: "technique__actions" }, [
          h(
            "button",
            {
              class: "btn btn--primary btn--sm",
              type: "button",
              "data-focus-key": `tech-launch-${technique.id}`,
              disabled: Boolean(blockedReason) || isCreation,
              title: isCreation ? "Disponible en mode Jeu" : blockedReason ?? `Coûte ${info.cost} chakra`,
              onClick: () => openTechniqueLauncher(profile.id, technique.id),
            },
            "Lancer la technique",
          ),
          !isCreation && !upgrade.blocked
            ? h(
                "button",
                {
                  class: "btn btn--sm",
                  type: "button",
                  "data-focus-key": `tech-up-${technique.id}`,
                  disabled: !canUpgrade,
                  title: canUpgrade ? undefined : `Il faut ${upgrade.cost} PA, ${C.experienceSummary(sheet).pa.available} disponible(s)`,
                  onClick: () => report(S.buyMastery(profile.id, technique.id)),
                },
                `Maîtrise → ${C.masteryLevel(upgrade.target).label} (${upgrade.cost} PA)`,
              )
            : null,
          h("button", { class: "btn btn--sm btn--ghost", type: "button", "data-focus-key": `tech-del-${technique.id}`, onClick: () => confirmRemoveTechnique(profile, technique) }, "Supprimer"),
          blockedReason ? h("span", { class: "technique__blocked" }, blockedReason) : null,
        ]),
      ]);
    }

    function buildTechniquesPanel(ctx) {
      const { profile, sheet, isCreation, budget } = ctx;
      const learnCost = C.newTechniqueCost();
      const addButtons = isCreation
        ? [
            h(
              "button",
              {
                class: "btn btn--primary",
                type: "button",
                "data-focus-key": "tech-add",
                disabled: budget.pa.remaining < learnCost.cost,
                title: budget.pa.remaining < learnCost.cost ? "Plus de PA de création" : undefined,
                onClick: () => report(S.addTechnique(profile.id)),
              },
              `Ajouter une technique (${learnCost.cost} PA)`,
            ),
          ]
        : [
            h(
              "button",
              {
                class: "btn btn--primary",
                type: "button",
                "data-focus-key": "tech-learn",
                disabled: !C.canAfford(sheet, learnCost),
                title: C.canAfford(sheet, learnCost) ? undefined : `Il faut ${learnCost.cost} PA disponible`,
                onClick: () => report(S.addTechnique(profile.id)),
              },
              `Apprendre une technique (${learnCost.cost} PA)`,
            ),
            // Technique scrolls bought at the shop teach a technique without PA.
            ...S.ownedTechniqueScrolls(profile).map((scroll) =>
              h(
                "button",
                {
                  class: "btn",
                  type: "button",
                  "data-focus-key": `tech-scroll-${scroll.itemId}`,
                  title: "Le parchemin est consommé (il quitte l'inventaire)",
                  onClick: () => {
                    const result = report(S.learnTechniqueFromScroll(profile.id, scroll.itemId));
                    if (result.ok) showToast(result.message);
                  },
                },
                `Utiliser : ${scroll.name} (×${scroll.quantity})`,
              ),
            ),
          ];

      return panel("techniques", "Techniques", [
        h("p", { class: "field-hint" }, "Coût en chakra par rang : E = 1, D = 2, C = 3, B = 4, A = 5, S = 6. L'art ninja du type doit être au moins égal au coût. Maîtrise : D −2 dés, C −1 dé, A aucun effet, M +1 succès, P +2 succès, S +3 succès."),
        isCreation
          ? h("p", { class: "field-hint" }, `PA de création : ${budget.pa.remaining >= 0 ? `${budget.pa.remaining} restant${budget.pa.remaining > 1 ? "s" : ""}` : `dépassé de ${-budget.pa.remaining}`} sur ${budget.pa.total}. Nouvelle technique 1 PA ; D → C → A : 1 PA par niveau ; A → M → P → S : 2 PA par niveau. Les trois techniques de départ sont offertes.`)
          : h("p", { class: "field-hint" }, "Création validée : la maîtrise ne monte qu'avec le bouton « Maîtrise → » (en PA), et une nouvelle technique coûte 1 PA (ou un parchemin de technique acheté au shop)."),
        isCreation ? buildCreationChakra(ctx) : null,
        sheet.techniques.length
          ? h("ol", { class: "technique-list" }, sheet.techniques.map((technique) => buildTechniqueRow(ctx, technique)))
          : h("p", { class: "empty-state" }, "Aucune technique."),
        h("div", { class: "row" }, addButtons),
      ]);
    }

    // --- Elements panel ---

    function natureRow(ctx, nature) {
      const { profile, sheet } = ctx;
      const status = C.natureStatus(sheet, nature);
      const effect = C.natureEffect(nature);
      const kindLabel = R.NATURE_KINDS[nature.kind].label;
      const elementsLabel = nature.elements.map((key) => C.elementDef(key).label).join(" + ");
      return h("li", { class: `nature-row is-${status.unlocked ? "unlocked" : status.lit ? "lit" : "locked"}` }, [
        h("div", { class: "nature-row__head" }, [
          h("strong", {}, `${nature.name} · ${nature.label}`),
          h("span", { class: "nature-row__kind" }, `${kindLabel} (${elementsLabel})`),
          status.unlocked || status.lit ? h("span", { class: "nature-row__level" }, `Niveau ${signed(status.level)}`) : null,
        ]),
        effect || nature.note ? h("p", { class: "nature-row__effect" }, [effect, nature.note ? ` ${nature.note}` : ""].join("").trim()) : null,
        status.unlocked
          ? h("div", { class: "row" }, [
              h("span", { class: "badge badge--type-permanent" }, "Débloquée"),
              h("button", { class: "btn btn--sm btn--ghost", type: "button", "data-focus-key": `nature-lock-${nature.key}`, onClick: () => report(S.lockNature(profile.id, nature.key)) }, "Verrouiller"),
            ])
          : status.lit
            ? h("button", { class: "btn btn--primary btn--sm", type: "button", "data-focus-key": `nature-unlock-${nature.key}`, onClick: () => report(S.unlockNature(profile.id, nature.key)) }, "Débloquer (enseignement reçu)")
            : h("p", { class: "nature-row__missing" }, `Il manque : ${status.missing.join(", ")}.`),
      ]);
    }

    function buildElementsPanel(ctx) {
      const { profile, sheet, isCreation } = ctx;
      const rules = C.gradeRules(profile.rank);
      const roleChoices = (role) => [
        { value: "", label: "— à choisir —" },
        ...R.ELEMENTS.map((element) => ({ value: element.key, label: `${element.label} (${element.name})` })),
      ];
      const roleLabel = { affinity: `Affinité (${signed(rules.affinity)})`, second: rules.second === null ? "Seconde affinité (Chûnin et plus)" : `Seconde affinité (${signed(rules.second)})`, weak: `Élément faible (${signed(rules.weak)})` };

      const roles = h(
        "div",
        { class: "form-grid" },
        R.ELEMENT_ROLES.map((role) =>
          h("div", { class: "field" }, [
            h("label", { for: `role-${role.key}` }, roleLabel[role.key]),
            selectField(
              { id: `role-${role.key}`, "data-focus-key": `role-${role.key}`, disabled: !isCreation || (role.key === "second" && rules.second === null) },
              roleChoices(role.key),
              sheet.elementRoles[role.key],
              (value) => report(S.setElementRole(profile.id, role.key, value)),
            ),
          ]),
        ),
      );

      const positive = C.countPositiveElements(sheet);
      const values = h(
        "ul",
        { class: "element-values" },
        R.ELEMENTS.map((element) =>
          h("li", { class: "element-value", style: `--element-color: ${element.color}` }, [
            h("span", { class: "element-value__name" }, [h("strong", {}, element.name), ` ${element.label}`]),
            isCreation
              ? h("span", { class: "element-value__number" }, signed(sheet.elements[element.key]))
              : paidValue(sheet, {
                  label: element.label,
                  value: signed(sheet.elements[element.key]),
                  purchase: C.elementUpgrade(sheet, element.key),
                  focusKey: `buy-el-inline-${element.key}`,
                  onBuy: () => S.buyElement(profile.id, element.key),
                }),
          ]),
        ),
      );

      const kgChoices = [{ value: "", label: "— aucun —" }, ...R.NATURES.filter((nature) => C.KG_NATURE_KEYS.includes(nature.key)).map((nature) => ({ value: nature.key, label: `${nature.name} (${nature.label}) : ${nature.elements.map((key) => C.elementDef(key).label).join(" + ")}` }))];
      const kgSlots = h(
        "div",
        { class: "form-grid" },
        Array.from({ length: R.KEKKEI_GENKAI_SLOTS }, (_, slot) => {
          const locked = slot > 0 && isCreation;
          return h("div", { class: "field" }, [
            h("label", { for: `kg-${slot}` }, `Kekkei Genkai ${slot + 1}${locked ? " (verrouillé en création)" : ""}`),
            selectField(
              { id: `kg-${slot}`, "data-focus-key": `kg-${slot}`, disabled: locked },
              kgChoices,
              sheet.kekkeiGenkai[slot],
              (value) => report(S.setKekkeiGenkai(profile.id, slot, value)),
            ),
          ]);
        }),
      );

      const wheelNatures = R.NATURES.filter((nature) => !C.KG_NATURE_KEYS.includes(nature.key));
      const slotNatures = sheet.kekkeiGenkai.map((key) => C.natureDef(key)).filter(Boolean);
      const candidates = [...wheelNatures, ...slotNatures];
      const highlighted = candidates.filter((nature) => {
        const status = C.natureStatus(sheet, nature);
        return status.lit || status.unlocked;
      });
      const others = candidates.filter((nature) => !highlighted.includes(nature));

      // Two blocks: the wheel (left on wide screens) and its settings (right).
      return panel("elements", "Éléments", h("div", { class: "elements-layout" }, [
        h("div", { class: "elements-layout__wheel" }, [
        h("div", { class: "wheel-frame" }, createElementWheel(sheet)),
        h("p", { class: "field-hint" }, "Feu > Vent > Foudre > Terre > Eau > Feu : l'élément dominant gagne 5 succès contre l'élément dominé. La valeur d'un élément s'ajoute (ou se retire) en succès aux techniques de cet élément."),
        ]),
        h("div", { class: "elements-layout__settings" }, [
        h("div", { class: "sheet-subhead sheet-subhead--first" }, [
          h("h3", {}, "Affinités"),
          h("p", { class: "field-hint" }, isCreation ? "Choisissez librement ; les éléments restants passent à −1. Un élément ne peut pas avoir deux rôles." : "Création validée : les affinités sont figées et un élément ne monte qu'en dépensant des PA (1 PA tant qu'il est à 0 ou moins, puis le niveau visé ; 3 éléments au plus au-dessus de 0)."),
        ]),
        roles,
        values,
        h("p", { class: "field-hint" }, `${positive} élément${positive > 1 ? "s" : ""} au-dessus de 0 (maximum ${R.MAX_POSITIVE_ELEMENTS}).`),
        h("div", { class: "sheet-subhead" }, [h("h3", {}, "Kekkei Genkai"), h("p", { class: "field-hint" }, "Héréditaire : demande un aspect Hérédité. Un seul à la création. Un Dojutsu (Sharingan, Byakugan…) se note comme une technique.")]),
        kgSlots,
        h("div", { class: "sheet-subhead" }, [h("h3", {}, "Natures combinées"), h("p", { class: "field-hint" }, "Une nature s'allume quand ses prérequis de techniques sont remplis. L'apprentissage reste décidé par le conteur.")]),
        highlighted.length ? h("ul", { class: "nature-list" }, highlighted.map((nature) => natureRow(ctx, nature))) : h("p", { class: "text-faint" }, "Aucune nature accessible pour l'instant."),
        h("details", { class: "nature-details" }, [
          h("summary", {}, `Toutes les natures et leurs prérequis (${others.length})`),
          h("ul", { class: "nature-list" }, others.map((nature) => natureRow(ctx, nature))),
        ]),
        ]),
      ]));
    }

    // --- Aspects panel ---

    function openPositiveCall(profile, sheet, aspectText) {
      const enough = sheet.chakra.current >= R.ASPECT_POSITIVE_COST;
      openModal({
        title: "Appel positif",
        body: h("div", { class: "stack" }, [
          h("p", {}, [h("strong", {}, `« ${aspectText} »`), ` · coûte ${R.ASPECT_POSITIVE_COST} chakra (${sheet.chakra.current} / ${sheet.chakra.max}).`]),
          enough ? null : h("p", { class: "notice notice--danger", role: "alert" }, `Il faut ${R.ASPECT_POSITIVE_COST} points de chakra.`),
          h(
            "div",
            { class: "effect-choices" },
            R.ASPECT_EFFECTS.map((effect) =>
              h(
                "button",
                {
                  class: "btn effect-choice",
                  type: "button",
                  disabled: !enough,
                  onClick: () => {
                    const result = report(S.callAspectPositive(profile.id, effect.key));
                    if (!result.ok) return;
                    closeModal();
                    showToast(effect.target === "display" ? "Annoncez au conteur ce que vous décrétez sur un PNJ mineur." : `${effect.short} : s'appliquera ${effect.target === "initiative" ? "à la prochaine initiative" : "au prochain jet"}.`);
                  },
                },
                effect.label,
              ),
            ),
          ),
        ]),
        footer: [h("button", { class: "btn", type: "button", onClick: () => closeModal() }, "Annuler")],
      });
    }

    function buildAspectsPanel(ctx) {
      const { profile, sheet, isCreation, budget } = ctx;
      const pending = sheet.pendingAspects.map((key, index) => ({ effect: R.ASPECT_EFFECTS.find((entry) => entry.key === key), index })).filter((entry) => entry.effect);
      const atMax = sheet.chakra.current >= sheet.chakra.max;

      function updateAspectsCount() {
        if (!liveRefs.aspectsCount) return;
        const filled = container.querySelectorAll(".aspect-input").length
          ? Array.from(container.querySelectorAll(".aspect-input")).filter((input) => input.value.trim()).length
          : 0;
        liveRefs.aspectsCount.textContent = String(filled);
      }

      const categories = R.ASPECT_CATEGORIES.map((category) =>
        h("div", { class: "aspect-category" }, [
          h("h3", { class: "aspect-category__name" }, category.label),
          ...Array.from({ length: R.ASPECTS_PER_CATEGORY }, (_, index) => {
            const value = sheet.aspects[category.key][index];
            const positive = h(
              "button",
              {
                class: "btn btn--sm aspect-call aspect-call--positive",
                type: "button",
                "data-focus-key": `aspect-pos-${category.key}-${index}`,
                hidden: !value.trim(),
                disabled: isCreation,
                title: isCreation ? "En mode Jeu" : `Appel positif : −${R.ASPECT_POSITIVE_COST} chakra et un effet`,
                "aria-label": `Appel positif de l'aspect ${category.label} ${index + 1}`,
              },
              "+ Appel",
            );
            const negative = h(
              "button",
              {
                class: "btn btn--sm aspect-call aspect-call--negative",
                type: "button",
                "data-focus-key": `aspect-neg-${category.key}-${index}`,
                hidden: !value.trim(),
                disabled: isCreation || atMax,
                title: isCreation ? "En mode Jeu" : atMax ? "Chakra déjà au maximum" : `Appel négatif : +${R.ASPECT_NEGATIVE_GAIN} chakra, des obstacles en plus`,
                "aria-label": `Appel négatif de l'aspect ${category.label} ${index + 1}`,
              },
              "− Appel",
            );
            const input = textField(
              {
                value,
                focusKey: `aspect-${category.key}-${index}`,
                commit: (text) => S.setAspect(profile.id, category.key, index, text),
                onLiveInput: (text) => {
                  positive.hidden = !text.trim();
                  negative.hidden = !text.trim();
                  updateAspectsCount();
                },
              },
              { class: "aspect-input", placeholder: index === 0 ? "Une phrase, à colorer…" : "", "aria-label": `${category.label}, aspect ${index + 1}` },
            );
            positive.addEventListener("click", () => openPositiveCall(profile, S.getSheet(getActiveProfile()), input.value.trim()));
            negative.addEventListener("click", () => {
              const result = report(S.callAspectNegative(profile.id));
              if (result.ok) showToast(`+${R.ASPECT_NEGATIVE_GAIN} chakra. Le conteur complique la scène.`);
            });
            return h("div", { class: "aspect-line" }, [input, h("div", { class: "aspect-line__calls" }, [positive, negative])]);
          }),
        ]),
      );

      return panel("aspects", "Aspects", [
        h("p", { class: "field-hint" }, `Douze au maximum, deux par catégorie ; ${R.ASPECTS_TO_START} suffisent pour commencer (${budget ? budget.aspects.filled : C.creationBudget(sheet, profile.rank).aspects.filled} rempli(s)). Appel positif : −${R.ASPECT_POSITIVE_COST} chakra et un effet. Appel négatif : +${R.ASPECT_NEGATIVE_GAIN} chakra (sans dépasser le max), mais des obstacles en plus.`),
        pending.length
          ? h("div", { class: "pending-aspects" }, [
              h("span", { class: "field-hint" }, "En attente :"),
              ...pending.map(({ effect, index }) =>
                h("span", { class: "pending-chip" }, [
                  `${effect.short} (${effect.target === "initiative" ? "initiative" : "prochain jet"})`,
                  h("button", { class: "pending-chip__remove", type: "button", "aria-label": `Retirer l'effet ${effect.short}`, "data-focus-key": `pending-${index}`, onClick: () => report(S.dropPendingAspect(profile.id, index)) }, "✕"),
                ]),
              ),
            ])
          : null,
        h("div", { class: "aspect-grid" }, categories),
      ]);
    }

    // --- Sac panel: purse + equipment ---

    function bonusText(item) {
      return [item.dice ? `+${plural(item.dice, "dé", "dés")}` : null, item.successes ? `+${plural(item.successes, "succès", "succès")}` : null].filter(Boolean).join(" ") || "aucun bonus";
    }

    function buildSacPanel(ctx) {
      const { profile, sheet } = ctx;
      const equipment = C.equipmentList(profile, sheet);
      const rules = C.gradeRules(profile.rank);
      const capText = rules.equipSuccesses ? `+${rules.equipDice} dés et +${rules.equipSuccesses} succès` : `+${plural(rules.equipDice, "dé", "dés")}`;
      const legendaryCount = equipment.filter((item) => item.legendary).length;

      const byStat = R.STATS.map((stat) => {
        const items = equipment.filter((item) => item.stat === stat.key);
        const bonus = C.equipmentBonus(items, profile.rank);
        return h("div", { class: "equip-group" }, [
          h("h3", { class: "equip-group__name" }, [
            stat.label,
            items.length
              ? h("span", { class: "equip-group__bonus" }, bonus.legendary ? `légendaire : +${bonus.dice} dés +${bonus.successes} succès` : `retenu : ${bonusText(bonus)}${bonus.capped ? " (plafond)" : ""}`)
              : null,
          ]),
          items.length
            ? h(
                "ul",
                { class: "equip-list" },
                items.map((item) =>
                  h("li", { class: "equip-item" }, [
                    h("span", { class: "equip-item__name" }, [item.name, item.quantity > 1 ? ` ×${item.quantity}` : "", item.legendary ? h("span", { class: "badge badge--gm" }, "Légendaire") : null]),
                    h("span", { class: "equip-item__bonus" }, bonusText(item)),
                    item.source === "shop"
                      ? h("span", { class: "badge badge--muted" }, "Shop")
                      : h(
                          "button",
                          { class: "btn btn--sm btn--ghost", type: "button", "data-focus-key": `custom-del-${item.id}`, onClick: () => report(S.removeCustomItem(profile.id, item.id.replace(/^custom:/, ""))) },
                          "Retirer",
                        ),
                  ]),
                ),
              )
            : h("p", { class: "text-faint" }, "—"),
        ]);
      });

      const otherItems = profile.inventory
        .map((entry) => ({ entry, item: getItemById(entry.itemId) }))
        .filter(({ item }) => item && !item.bonus);

      // Hand-added item form (draft kept across rebuilds).
      const nameInput = h("input", { type: "text", id: "custom-name", "data-focus-key": "custom-name", placeholder: "Récompense, arme légendaire…", autocomplete: "off" });
      nameInput.value = customDraft.name;
      nameInput.addEventListener("input", () => (customDraft.name = nameInput.value));
      const numberChoices = [0, 1, 2, 3].map((value) => ({ value: String(value), label: String(value) }));
      const form = h("div", { class: "custom-item-form" }, [
        h("div", { class: "field" }, [h("label", { for: "custom-name" }, "Objet"), nameInput]),
        h("div", { class: "field" }, [
          h("label", { for: "custom-stat" }, "Caractéristique"),
          selectField({ id: "custom-stat", "data-focus-key": "custom-stat" }, R.STATS.map((stat) => ({ value: stat.key, label: stat.label })), customDraft.stat, (value) => (customDraft.stat = value)),
        ]),
        h("div", { class: "field" }, [
          h("label", { for: "custom-dice" }, "Dés"),
          selectField({ id: "custom-dice", "data-focus-key": "custom-dice" }, numberChoices, String(customDraft.dice), (value) => (customDraft.dice = Number(value))),
        ]),
        h("div", { class: "field" }, [
          h("label", { for: "custom-succ" }, "Succès"),
          selectField({ id: "custom-succ", "data-focus-key": "custom-succ" }, numberChoices, String(customDraft.successes), (value) => (customDraft.successes = Number(value))),
        ]),
        h("label", { class: "checkbox-field", for: "custom-legendary" }, [
          (() => {
            const box = h("input", { type: "checkbox", id: "custom-legendary", "data-focus-key": "custom-legendary", checked: customDraft.legendary });
            box.addEventListener("change", () => {
              customDraft.legendary = box.checked;
              if (box.checked) {
                customDraft.dice = R.LEGENDARY_BONUS.dice;
                customDraft.successes = R.LEGENDARY_BONUS.successes;
                rerender();
              }
            });
            return box;
          })(),
          "Arme légendaire (+3 dés +2 succès, remplace le plafond)",
        ]),
        h(
          "button",
          {
            class: "btn btn--primary",
            type: "button",
            "data-focus-key": "custom-add",
            onClick: () => {
              const result = report(S.addCustomItem(profile.id, customDraft));
              if (result.ok) customDraft = { name: "", stat: customDraft.stat, dice: 1, successes: 0, legendary: false };
              rerender();
            },
          },
          "Ajouter l'objet",
        ),
      ]);

      return panel("sac", "Sac", [
        h("div", { class: "purse" }, [
          h("div", { class: "purse__tag" }, [h("span", { class: "purse__amount" }, formatRyo(profile.balance)), h("span", { class: "purse__label" }, "Bourse de ryos")]),
          h("div", { class: "purse__links" }, [
            h("a", { class: "btn btn--sm", href: "#/shop" }, "Boutique"),
            h("a", { class: "btn btn--sm", href: "#/inventory" }, "Inventaire"),
          ]),
        ]),
        h("p", { class: "field-hint" }, `Même bourse et même équipement que le shop : un achat se voit ici tout de suite. Chaque objet donne un bonus à une caractéristique ; les bonus se cumulent, plafonnés selon le grade (${profile.rank} : ${capText}). Une arme légendaire (une seule par personnage) remplace le plafond.`),
        legendaryCount > 1 ? notice("warning", "Un personnage ne porte qu'une seule arme légendaire.") : null,
        h("div", { class: "equip-grid" }, byStat),
        otherItems.length
          ? h("div", { class: "equip-group" }, [
              h("h3", { class: "equip-group__name" }, "Autres objets"),
              h("ul", { class: "equip-list" }, otherItems.map(({ entry, item }) => h("li", { class: "equip-item" }, [h("span", { class: "equip-item__name" }, `${item.name} ×${entry.quantity}`)]))),
            ])
          : null,
        h("div", { class: "sheet-subhead" }, [h("h3", {}, "Ajouter un objet à la main"), h("p", { class: "field-hint" }, "Récompense de scénario, arme légendaire, objet hors shop.")]),
        form,
      ]);
    }

    // --- Progression panel: PX / PA ---

    function purchaseRow(label, purchase, onBuy, ctx, focusKey) {
      const { sheet, isCreation } = ctx;
      const affordable = C.canAfford(sheet, purchase);
      const reason = isCreation ? "En mode Jeu" : purchase.blocked ? purchase.blocked : !affordable ? `Pas assez de ${purchase.currency.toUpperCase()}` : null;
      return h("li", { class: "purchase" }, [
        h("span", { class: "purchase__label" }, label),
        h("span", { class: "purchase__cost" }, purchase.blocked ? "—" : `${purchase.cost} ${purchase.currency.toUpperCase()}`),
        h(
          "button",
          { class: "btn btn--sm", type: "button", "data-focus-key": focusKey, disabled: Boolean(reason), title: reason ?? undefined, onClick: () => report(onBuy()) },
          purchase.blocked ? purchase.blocked : "Acheter",
        ),
      ]);
    }

    function buildCounter(ctx, currency, label) {
      const { profile, sheet } = ctx;
      const summary = C.experienceSummary(sheet)[currency];
      const earnedInput = h("input", { type: "number", inputmode: "numeric", min: "0", id: `earned-${currency}`, "data-focus-key": `earned-${currency}`, class: "counter__input" });
      earnedInput.value = String(summary.earned);
      earnedInput.addEventListener("change", () => report(S.setEarned(profile.id, currency, earnedInput.value)));

      const addInput = h("input", { type: "number", inputmode: "numeric", id: `add-${currency}`, "data-focus-key": `add-${currency}`, class: "counter__input", placeholder: "+0" });
      addInput.value = earnedDraft[currency];
      addInput.addEventListener("input", () => (earnedDraft[currency] = addInput.value));
      const addButton = h(
        "button",
        {
          class: "btn btn--sm",
          type: "button",
          "data-focus-key": `add-${currency}-btn`,
          onClick: () => {
            const result = report(S.addEarned(profile.id, currency, addInput.value));
            if (result.ok) earnedDraft[currency] = "";
            rerender();
          },
        },
        "Ajouter",
      );

      return h("div", { class: "counter" }, [
        h("h3", { class: "counter__title" }, label),
        h("dl", { class: "counter__numbers" }, [
          h("div", {}, [h("dt", {}, h("label", { for: `earned-${currency}` }, "Gagnés")), h("dd", {}, earnedInput)]),
          h("div", {}, [h("dt", {}, "Dépensés"), h("dd", {}, String(summary.spent))]),
          h("div", { class: summary.available < 0 ? "is-negative" : "" }, [h("dt", {}, "Disponibles"), h("dd", { class: "counter__available" }, String(summary.available))]),
        ]),
        h("div", { class: "counter__add" }, [h("label", { for: `add-${currency}`, class: "field-hint" }, "Gains de la séance"), addInput, addButton]),
      ]);
    }

    function buildProgressionPanel(ctx) {
      const { profile, sheet, isCreation } = ctx;
      const sign = (value) => (value > 0 ? `+${value}` : String(value));

      const groups = [
        {
          title: "Caractéristiques (niveau visé × 2 PX, max 5, une ligne de trait en plus)",
          rows: R.STATS.map((stat) => {
            const purchase = C.statUpgrade(sheet, stat.key);
            return purchaseRow(`${stat.label} ${sheet.stats[stat.key]} → ${purchase.target}`, purchase, () => S.buyStat(profile.id, stat.key), ctx, `buy-stat-${stat.key}`);
          }),
        },
        {
          title: "Arts ninja (niveau visé en PX)",
          rows: R.ARTS.map((art) => {
            const purchase = C.artUpgrade(sheet, art.key);
            return purchaseRow(`${art.label} ${sheet.arts[art.key]} → ${purchase.target}`, purchase, () => S.buyArt(profile.id, art.key), ctx, `buy-art-${art.key}`);
          }),
        },
        {
          title: "Énergie vitale et chakra",
          rows: [
            purchaseRow(`Énergie vitale max ${sheet.vitality.max} → ${sheet.vitality.max + R.PROGRESSION.vitalityGain}`, C.vitalityUpgrade(sheet), () => S.buyVitality(profile.id), ctx, "buy-vit"),
            purchaseRow(`Chakra max ${sheet.chakra.max} → ${sheet.chakra.max + R.PROGRESSION.chakraGain}`, C.chakraUpgrade(sheet), () => S.buyChakra(profile.id), ctx, "buy-chakra"),
          ],
        },
        {
          title: "Techniques (nouvelle : 1 PA ; D → A : 1 PA par niveau ; A → S : 2 PA par niveau ; 9 PA en tout)",
          rows: [
            purchaseRow("Nouvelle technique (Débutant)", C.newTechniqueCost(), () => S.addTechnique(profile.id), ctx, "buy-tech"),
            ...sheet.techniques.map((technique) => {
              const purchase = C.masteryUpgrade(technique);
              const label = purchase.target
                ? `${technique.name || "Technique sans nom"} : ${C.masteryLevel(technique.mastery).label} → ${C.masteryLevel(purchase.target).label}`
                : `${technique.name || "Technique sans nom"} : Sublimée`;
              return purchaseRow(label, purchase, () => S.buyMastery(profile.id, technique.id), ctx, `buy-mastery-${technique.id}`);
            }),
          ],
        },
        {
          title: `Éléments (1 PA si ≤ 0, sinon le niveau visé ; ${R.MAX_POSITIVE_ELEMENTS} éléments au plus au-dessus de 0)`,
          rows: R.ELEMENTS.map((element) => {
            const purchase = C.elementUpgrade(sheet, element.key);
            return purchaseRow(`${element.label} ${sign(sheet.elements[element.key])} → ${sign(purchase.target)}`, purchase, () => S.buyElement(profile.id, element.key), ctx, `buy-el-${element.key}`);
          }),
        },
      ];

      const history = sheet.spending.length
        ? h("div", { class: "table-wrap" }, [
            h("table", { class: "table" }, [
              h("thead", {}, h("tr", {}, [h("th", {}, "Date"), h("th", {}, "Achat"), h("th", {}, "Coût")])),
              h(
                "tbody",
                {},
                sheet.spending.map((entry) => h("tr", {}, [h("td", {}, formatDateTime(entry.timestamp)), h("td", {}, entry.label), h("td", {}, `${entry.cost} ${entry.currency.toUpperCase()}`)])),
              ),
            ]),
          ])
        : h("p", { class: "text-faint" }, "Aucune dépense pour l'instant.");

      return panel("progression", "Progression", [
        isCreation ? notice("info", "En création, les points se répartissent avec les budgets du grade. Les achats en PX / PA s'ouvrent en mode Jeu (« Valider la création »).") : null,
        h("div", { class: "counter-grid" }, [buildCounter(ctx, "px", "PX · points d'expérience"), buildCounter(ctx, "pa", "PA · points d'apprentissage")]),
        h("p", { class: "field-hint" }, "Après chaque séance, ajoutez les PX et PA gagnés (2 h de jeu = 1 PX et 1 PA ; séance mission 2 PX + 2 PA ; roleplay 4 PA ; combat 4 PX ; + bonus d'accomplissement)."),
        h("div", { class: "purchase-groups" }, groups.map((group) => h("div", { class: "purchase-group" }, [h("h3", { class: "purchase-group__title" }, group.title), h("ul", { class: "purchase-list" }, group.rows)]))),
        h("div", { class: "sheet-subhead" }, [h("h3", {}, "Historique des dépenses")]),
        history,
        h(
          "button",
          {
            class: "btn btn--danger",
            type: "button",
            "data-focus-key": "undo-spending",
            disabled: !sheet.spending.length,
            onClick: () => {
              const last = sheet.spending[0];
              const result = report(S.undoLastSpending(profile.id));
              if (result.ok && last) showToast(`Annulé : ${last.label} (${last.cost} ${last.currency.toUpperCase()} rendus).`);
            },
          },
          sheet.spending.length ? `Annuler la dernière dépense (${sheet.spending[0].label})` : "Annuler la dernière dépense",
        ),
      ]);
    }

    // --- Whole view ---

    function buildEmptyState() {
      return h("div", { class: "empty-state stack sheet-empty" }, [
        h("h1", {}, "Fiche de ninja"),
        h("p", {}, "Aucune fiche pour le moment. Créez votre ninja, ou importez une fiche exportée depuis un autre appareil."),
        h("div", { class: "row sheet-empty__actions" }, [
          h("button", { class: "btn btn--primary", type: "button", onClick: () => openCreateProfileModal() }, "Créer une fiche"),
          h("button", { class: "btn", type: "button", onClick: () => openImportPicker((imported) => setActiveProfile(imported.id)) }, "Importer une fiche"),
        ]),
        h("p", { class: "field-hint" }, "Les fiches restent dans ce navigateur. « Exporter » / « Importer » servent à passer du téléphone au PC et à garder une sauvegarde."),
      ]);
    }

    function buildDiceFab(profile) {
      return h(
        "button",
        { class: "dice-fab", type: "button", "data-focus-key": "dice-fab", "aria-label": "Lancer les dés", onClick: () => openDiceLauncher(profile.id) },
        [
          h("span", { class: "dice-fab__icon", "aria-hidden": "true" }, "d10"),
          h("span", { class: "dice-fab__label" }, "Lancer les dés"),
        ],
      );
    }

    /**
     * The ninja's live state, always in view: gauges with quick +/−, actions this turn,
     * initiative (opens its dialog), waiting aspects, purse, PX/PA available and the dice
     * button. A sticky left column on wide screens, a compact block above the tabs on phones.
     * Raising énergie vitale max / chakra max is done in Progression.
     */
    function buildSidebar(ctx) {
      const { profile, sheet, isCreation } = ctx;
      const { vitality, chakra } = sheet;
      const status =
        vitality.current <= -vitality.max
          ? { kind: "dead", label: "Mort" }
          : vitality.current <= 0
            ? { kind: "out", label: "Hors combat" }
            : null;
      const actions = Math.max(0, vitality.current);
      const xp = C.experienceSummary(sheet);
      const pending = sheet.pendingAspects.map((key) => R.ASPECT_EFFECTS.find((effect) => effect.key === key)).filter(Boolean);
      const init = sheet.initiative;
      const phases = init.total !== null && C.validatePiles(init.piles, init.total, actions).ok ? [...init.piles].sort((a, b) => b - a) : null;

      const sideStepper = (label, value, focusKey, minusDisabled, plusDisabled, onMinus, onPlus) =>
        stepper({ label, value, focusKey, minusDisabled, plusDisabled, onMinus: () => report(onMinus()), onPlus: () => report(onPlus()) });

      return h("aside", { class: "sheet-side", "aria-label": "Résumé du ninja" }, [
        h("div", { class: "side-card side-card--gauge" }, [
          gauge({ label: "Énergie vitale", current: vitality.current, max: vitality.max, kind: "vitality", status }),
          isCreation
            ? null
            : h("div", { class: "side-card__row" }, [
                sideStepper("Énergie vitale actuelle", vitality.current, "side-vit", vitality.current <= -vitality.max, vitality.current >= vitality.max,
                  () => S.changeVitality(profile.id, -1), () => S.changeVitality(profile.id, 1)),
                h(
                  "span",
                  { class: "side-card__actions", title: "L'énergie vitale actuelle donne le nombre maximum d'actions du tour. À 0 : hors combat ; à −max : mort. Le malus des blessures se gère à la table." },
                  [h("strong", {}, String(actions)), ` action${actions > 1 ? "s" : ""} ce tour`],
                ),
              ]),
        ]),
        h("div", { class: "side-card side-card--gauge" }, [
          gauge({ label: "Chakra", current: chakra.current, max: chakra.max, kind: "chakra" }),
          isCreation
            ? null
            : h("div", { class: "side-card__row" }, [
                sideStepper("Chakra actuel", chakra.current, "side-chakra", chakra.current <= 0, chakra.current >= chakra.max,
                  () => S.changeChakra(profile.id, -1), () => S.changeChakra(profile.id, 1)),
                h("button", { class: "btn btn--sm", type: "button", "data-focus-key": "side-chakra-full", disabled: chakra.current >= chakra.max, onClick: () => report(S.restoreChakra(profile.id)) }, "Max"),
              ]),
        ]),
        isCreation
          ? h("p", { class: "field-hint" }, "Jauges, appels d'aspects et dépenses de PX / PA s'ouvrent en mode Jeu.")
          : null,
        isCreation
          ? null
          : h("div", { class: "side-card side-card--initiative" }, [
              h("div", { class: "side-card__row" }, [
                h("span", { class: "side-card__line" }, [
                  init.total !== null ? "Initiative : " : "Initiative",
                  init.total !== null ? h("strong", {}, `${init.total} jetons`) : null,
                  phases ? h("span", { class: "side-card__phases" }, `phases ${phases.join(", ")}`) : null,
                ]),
                h("button", { class: "btn btn--sm", type: "button", "data-focus-key": "side-init", onClick: openInitiativeModal }, init.total !== null ? "Ouvrir" : "Lancer"),
              ]),
            ]),
        pending.length
          ? h("div", { class: "side-card__pending" }, [h("span", { class: "field-hint" }, "Aspects en attente :"), ...pending.map((effect) => h("span", { class: "pending-chip" }, effect.short))])
          : null,
        h("div", { class: "side-card side-card--split" }, [
          h("button", { class: "side-stat", type: "button", "data-focus-key": "side-purse", title: "Ouvrir l'onglet Sac", onClick: () => goToPanel("sac") }, [
            h("span", { class: "side-stat__value side-stat__value--ryo" }, formatRyo(profile.balance)),
            h("span", { class: "side-stat__label" }, "Bourse"),
          ]),
          h("button", { class: "side-stat", type: "button", "data-focus-key": "side-xp", title: "Ouvrir l'onglet Progression", onClick: () => goToPanel("progression") }, [
            h("span", { class: "side-stat__value" }, `${xp.px.available} PX · ${xp.pa.available} PA`),
            h("span", { class: "side-stat__label" }, "Disponibles"),
          ]),
        ]),
        h(
          "button",
          { class: "btn btn--primary btn--block side-dice", type: "button", "data-focus-key": "side-dice", onClick: () => openDiceLauncher(profile.id) },
          [h("span", { class: "dice-fab__icon", "aria-hidden": "true" }, "d10"), "Lancer les dés"],
        ),
      ]);
    }

    function render() {
      clearElement(container);
      liveRefs = {};
      const profile = getActiveProfile();
      const warning = buildStorageWarning();

      if (!profile) {
        container.append(...[warning, buildEmptyState()].filter(Boolean));
        return;
      }
      resetDrafts(profile.id);

      const sheet = S.getSheet(profile);
      const isCreation = sheet.mode === "creation";
      const ctx = { profile, sheet, isCreation, budget: isCreation ? C.creationBudget(sheet, profile.rank) : null };

      container.append(
        h("div", { class: `sheet${isCreation ? " sheet--creation" : ""}` }, [
          warning,
          buildHeader(ctx),
          // Phone: tabs then one panel. Wide screen: sticky sidebar on the left, tabs + panel on the right.
          h("div", { class: "sheet-body" }, [
            buildSidebar(ctx),
            h("div", { class: "sheet-main" }, [
              buildTabs(),
              buildNinjaPanel(ctx),
              buildTechniquesPanel(ctx),
              buildElementsPanel(ctx),
              buildAspectsPanel(ctx),
              buildSacPanel(ctx),
              buildProgressionPanel(ctx),
            ]),
          ]),
          buildDiceFab(profile),
        ]),
      );
    }

    container.classList.add("app-main--sheet");
    render();
    const unsubscribe = subscribe(onStateChange);

    return () => {
      unsubscribe();
      container.classList.remove("app-main--sheet");
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("pointerup", onPointerUp, true);
      document.removeEventListener("pointercancel", onPointerUp, true);
    };
  }

  App.sheetView = { renderSheetView };
})();

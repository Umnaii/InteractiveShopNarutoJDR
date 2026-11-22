/**
 * Profiles view: create, rename, duplicate, delete and switch between character
 * profiles, with a preview of each profile's recent transaction history.
 * Plain script: attaches its API to the shared App namespace as App.profilesView.
 * Depends on App.state, App.profiles, App.format, App.modal, App.dom, App.profileTransfer, App.router.
 */

(function () {
  "use strict";
  window.App = window.App || {};

  const { getProfiles, getActiveProfileId, subscribe } = App.state;
  const { createProfile, renameProfile, duplicateProfile, setActiveProfile, setProfileRank } = App.profiles;
  const { getRankOptions, formatRyo, formatSignedRyo, formatDateTime, transactionKindLabel, csvEscape, initialOf } = App.format;
  const { openModal, closeModal } = App.modal;
  const { h, clearElement, rerenderKeepingScroll } = App.dom;
  const { slugify, downloadFile, downloadProfile, openImportPicker, confirmDeleteProfile } = App.profileTransfer;

  /**
   * Build the full transaction history of a profile as CSV text (French column headers,
   * newest first — same order as it's stored/displayed). UTF-8 with CRLF line endings.
   * @param {object} profile
   * @returns {string}
   */
  function buildHistoryCsv(profile) {
    const header = ["Date", "Type", "Montant (Ryo)", "Raison"];
    const rows = profile.history.map((transaction) => [
      formatDateTime(transaction.timestamp),
      transactionKindLabel(transaction.kind),
      transaction.amount,
      transaction.reason,
    ]);
    return [header, ...rows].map((row) => row.map(csvEscape).join(",")).join("\r\n");
  }

  /**
   * Trigger a browser download of a profile's full transaction history as a CSV file.
   * @param {object} profile
   * @returns {void}
   */
  function downloadHistoryCsv(profile) {
    // Leading BOM so Excel opens the accented French text as UTF-8 instead of guessing ANSI.
    const BOM = String.fromCharCode(0xfeff);
    downloadFile(`boutique-shinobi-historique-${slugify(profile.name)}.csv`, BOM + buildHistoryCsv(profile), "text/csv;charset=utf-8");
  }

  /**
   * Render the profiles view into a container.
   * @param {HTMLElement} container
   * @returns {() => void} Cleanup function to call when leaving the view.
   */
  function renderProfilesView(container) {
    function render() {
      clearElement(container);
      const profiles = getProfiles();
      const activeId = getActiveProfileId();

      container.append(
        h("div", { class: "view-header" }, [
          h("h1", {}, "Profils"),
          profiles.length ? h("p", {}, `${profiles.length} ninja${profiles.length > 1 ? "s" : ""} enregistré${profiles.length > 1 ? "s" : ""}`) : null,
        ]),
        h("div", { class: "grid two-col profiles-tools" }, [buildCreateForm(), buildImportCard()]),
      );

      if (!profiles.length) {
        container.append(h("div", { class: "empty-state" }, "Aucun profil pour le moment. Créez-en un ci-dessus."));
        return;
      }

      container.append(
        h("div", { class: "grid two-col profiles-grid" }, profiles.map((profile) => buildProfileCard(profile, profile.id === activeId))),
      );
    }

    function buildCreateForm() {
      const nameInput = h("input", { type: "text", id: "new-profile-name", placeholder: "Nom du personnage" });
      const rankSelect = h("select", { id: "new-profile-rank" }, getRankOptions().map((rank) => h("option", { value: rank }, rank)));

      const submitButton = h("button", { class: "btn btn--primary", type: "button" }, "Créer le profil");
      submitButton.addEventListener("click", () => {
        const result = createProfile(nameInput.value, rankSelect.value);
        if (!result.ok) window.alert(result.message);
      });

      return h("div", { class: "card card--ink stack" }, [
        h("h2", {}, "Nouveau profil"),
        h("div", { class: "form-grid" }, [
          h("div", { class: "field" }, [h("label", { for: "new-profile-name" }, "Nom"), nameInput]),
          h("div", { class: "field" }, [h("label", { for: "new-profile-rank" }, "Grade"), rankSelect]),
        ]),
        submitButton,
      ]);
    }

    function buildImportCard() {
      const importButton = h("button", { class: "btn", type: "button" }, "Importer un profil");
      importButton.addEventListener("click", () => openImportPicker());

      return h("div", { class: "card card--ink stack" }, [
        h("h2", {}, "Importer un profil"),
        h("p", { class: "text-muted" }, "Chargez un fichier .json exporté depuis un autre appareil pour récupérer ce profil (et sa fiche de personnage) ici."),
        h("div", { class: "row" }, [importButton]),
      ]);
    }

    /**
     * Build one profile as a ninja ID sheet: red seal with the initial, editable name,
     * rank pill, balance on a paper tag, stats, actions and recent history. The active
     * profile gets an "ACTIF" stamp in the corner and an orange shadow.
     */
    function buildProfileCard(profile, isActive) {
      const nameInput = h("input", {
        type: "text",
        class: "profile-card__name-input",
        value: profile.name,
        "aria-label": `Nom du profil ${profile.name}`,
      });
      const rankSelect = h(
        "select",
        { class: "rank-select", "data-rank": profile.rank, "aria-label": `Grade du profil ${profile.name}` },
        getRankOptions().map((rank) => h("option", { value: rank }, rank)),
      );
      rankSelect.value = profile.rank;
      rankSelect.addEventListener("change", () => setProfileRank(profile.id, rankSelect.value));

      function applyRename() {
        if (nameInput.value === profile.name) return;
        const result = renameProfile(profile.id, nameInput.value);
        if (!result.ok) window.alert(result.message);
      }

      // Enter saves the new name, Escape restores the current one.
      nameInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter") applyRename();
        if (event.key === "Escape") nameInput.value = profile.name;
      });

      const renameButton = h("button", { class: "btn-icon", type: "button", "aria-label": `Renommer ${profile.name}`, title: "Renommer" }, "✎");
      renameButton.addEventListener("click", applyRename);

      const activateButton = isActive ? null : h("button", { class: "btn btn--primary btn--sm", type: "button" }, "Activer");
      activateButton?.addEventListener("click", () => setActiveProfile(profile.id));

      const sheetButton = h(
        "button",
        { class: isActive ? "btn btn--primary btn--sm" : "btn btn--sm", type: "button", "aria-label": `Ouvrir la fiche de ${profile.name}` },
        "Fiche",
      );
      sheetButton.addEventListener("click", () => {
        setActiveProfile(profile.id);
        App.router.navigate("/sheet");
      });

      const duplicateButton = h("button", { class: "btn btn--sm", type: "button" }, "Dupliquer");
      duplicateButton.addEventListener("click", () => duplicateProfile(profile.id));

      const exportButton = h(
        "button",
        { class: "btn btn--sm", type: "button", "aria-label": `Exporter ${profile.name} en fichier JSON` },
        "Exporter",
      );
      exportButton.addEventListener("click", () => downloadProfile(profile));

      const deleteButton = h(
        "button",
        { class: "btn btn--sm btn--danger", type: "button", "aria-label": `Supprimer ${profile.name}` },
        "Supprimer",
      );
      deleteButton.addEventListener("click", () => confirmDeleteProfile(profile));

      const itemTypes = profile.inventory.length;
      const transactions = profile.history.length;

      return h("article", { class: isActive ? "profile-card profile-card--active" : "profile-card" }, [
        isActive ? h("span", { class: "profile-card__stamp" }, "Actif") : null,
        h("div", { class: "profile-card__header" }, [
          h("span", { class: "profile-seal profile-seal--lg", "aria-hidden": "true" }, initialOf(profile.name)),
          h("div", { class: "profile-card__identity" }, [h("div", { class: "profile-card__name-row" }, [nameInput, renameButton]), rankSelect]),
          h("div", { class: "profile-card__balance" }, [
            h("span", { class: "profile-card__balance-amount" }, formatRyo(profile.balance)),
            h("span", { class: "profile-card__balance-label" }, "Solde"),
          ]),
        ]),
        h("div", { class: "profile-card__stats" }, [
          h("div", { class: "profile-stat" }, [
            h("span", { class: "profile-stat__value" }, String(itemTypes)),
            h("span", { class: "profile-stat__label" }, itemTypes > 1 ? "types d'objets" : "type d'objet"),
          ]),
          h("div", { class: "profile-stat" }, [
            h("span", { class: "profile-stat__value" }, String(transactions)),
            h("span", { class: "profile-stat__label" }, transactions > 1 ? "transactions" : "transaction"),
          ]),
        ]),
        h("div", { class: "profile-card__actions" }, [sheetButton, activateButton, duplicateButton, exportButton, deleteButton]),
        h("div", { class: "profile-card__history" }, [h("h3", {}, "Derniers mouvements"), buildHistoryPreview(profile)]),
      ]);
    }

    function buildTransactionRow(transaction) {
      return h("div", { class: "transaction-item" }, [
        h("span", { class: "transaction-item__text" }, [
          h("span", {}, transaction.reason),
          h("span", { class: "transaction-item__date" }, formatDateTime(transaction.timestamp)),
        ]),
        h(
          "span",
          { class: `transaction-item__amount transaction-item__amount--${transaction.amount >= 0 ? "positive" : "negative"}` },
          formatSignedRyo(transaction.amount),
        ),
      ]);
    }

    function buildHistoryPreview(profile) {
      if (!profile.history.length) {
        return h("p", { class: "text-faint" }, "Aucune transaction pour le moment.");
      }
      const recent = profile.history.slice(0, 5);

      const seeMoreButton = h(
        "button",
        { class: "btn btn--ghost btn--sm", type: "button" },
        `Voir tout l'historique (${profile.history.length})`,
      );
      seeMoreButton.addEventListener("click", () => openFullHistoryModal(profile));

      return h("div", { class: "stack" }, [
        h("div", { class: "transaction-list" }, recent.map(buildTransactionRow)),
        seeMoreButton,
      ]);
    }

    function openFullHistoryModal(profile) {
      const exportCsvButton = h("button", { class: "btn", type: "button" }, "Exporter en CSV");
      exportCsvButton.addEventListener("click", () => downloadHistoryCsv(profile));

      const closeButton = h("button", { class: "btn btn--primary", type: "button" }, "Fermer");
      closeButton.addEventListener("click", () => closeModal());

      const table = h("table", { class: "table" }, [
        h(
          "thead",
          {},
          h("tr", {}, [h("th", {}, "Date"), h("th", {}, "Type"), h("th", {}, "Montant"), h("th", {}, "Raison")]),
        ),
        h(
          "tbody",
          {},
          profile.history.map((transaction) =>
            h("tr", {}, [
              h("td", {}, formatDateTime(transaction.timestamp)),
              h("td", {}, transactionKindLabel(transaction.kind)),
              h(
                "td",
                { class: transaction.amount >= 0 ? "text-success" : "text-danger" },
                formatSignedRyo(transaction.amount),
              ),
              h("td", {}, transaction.reason),
            ]),
          ),
        ),
      ]);

      openModal({
        title: `Historique complet — ${profile.name}`,
        body: table,
        footer: [exportCsvButton, closeButton],
        wide: true,
      });
    }

    render();
    return subscribe(() => rerenderKeepingScroll(render));
  }

  App.profilesView = { renderProfilesView };
})();

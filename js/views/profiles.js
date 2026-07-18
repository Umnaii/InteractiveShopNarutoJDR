/**
 * Profiles view: create, rename, duplicate, delete and switch between character
 * profiles, with a preview of each profile's recent transaction history.
 * Plain script: attaches its API to the shared App namespace as App.profilesView.
 * Depends on App.state, App.profiles, App.format, App.modal, App.dom.
 */

(function () {
  "use strict";
  window.App = window.App || {};

  const { getProfiles, getActiveProfileId, subscribe } = App.state;
  const {
    createProfile,
    renameProfile,
    duplicateProfile,
    deleteProfile,
    setActiveProfile,
    setProfileRank,
    exportProfile,
    parseProfileExport,
    importProfile,
  } = App.profiles;
  const { getRankOptions, formatRyo, formatSignedRyo, formatDateTime } = App.format;
  const { openModal, closeModal } = App.modal;
  const { h, clearElement } = App.dom;

  /**
   * Turn a profile name into a filesystem-safe, accent-free filename fragment.
   * @param {string} text
   * @returns {string}
   */
  function slugify(text) {
    return (
      text
        .normalize("NFD")
        .replace(/\p{Diacritic}/gu, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "") || "profil"
    );
  }

  /**
   * Trigger a browser download of a profile as a JSON file.
   * @param {object} profile
   * @returns {void}
   */
  function downloadProfile(profile) {
    const payload = exportProfile(profile.id);
    if (!payload) return;

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = h("a", { href: url, download: `boutique-shinobi-${slugify(profile.name)}.json` });
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
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

      container.append(h("div", { class: "view-header" }, [h("h1", {}, "Profils")]), buildCreateForm(), buildImportCard());

      if (!profiles.length) {
        container.append(h("div", { class: "empty-state" }, "Aucun profil pour le moment. Créez-en un ci-dessus."));
        return;
      }

      container.append(h("div", { class: "grid two-col" }, profiles.map((profile) => buildProfileCard(profile, profile.id === activeId))));
    }

    function buildCreateForm() {
      const nameInput = h("input", { type: "text", id: "new-profile-name", placeholder: "Nom du personnage" });
      const rankSelect = h("select", { id: "new-profile-rank" }, getRankOptions().map((rank) => h("option", { value: rank }, rank)));

      const submitButton = h("button", { class: "btn btn--primary", type: "button" }, "Créer le profil");
      submitButton.addEventListener("click", () => {
        const result = createProfile(nameInput.value, rankSelect.value);
        if (!result.ok) window.alert(result.message);
      });

      return h("div", { class: "card" }, [
        h("h2", {}, "Nouveau profil"),
        h("div", { class: "form-grid" }, [
          h("div", { class: "field" }, [h("label", { for: "new-profile-name" }, "Nom"), nameInput]),
          h("div", { class: "field" }, [h("label", { for: "new-profile-rank" }, "Grade"), rankSelect]),
        ]),
        submitButton,
      ]);
    }

    function buildImportCard() {
      const fileInput = h("input", {
        type: "file",
        accept: "application/json,.json",
        class: "visually-hidden",
        id: "import-profile-file",
        "aria-label": "Choisir un fichier de profil à importer",
      });
      fileInput.addEventListener("change", async () => {
        const file = fileInput.files[0];
        fileInput.value = "";
        if (!file) return;

        const text = await file.text();
        const parsed = parseProfileExport(text);
        if (!parsed.ok) {
          window.alert(parsed.message);
          return;
        }
        attemptImport(parsed.profile);
      });

      const importButton = h("button", { class: "btn", type: "button" }, "Importer un profil");
      importButton.addEventListener("click", () => fileInput.click());

      return h("div", { class: "card" }, [
        h("h2", {}, "Importer un profil"),
        h("p", { class: "text-muted" }, "Chargez un fichier .json exporté depuis un autre appareil pour récupérer ce profil ici."),
        h("div", { class: "row" }, [importButton, fileInput]),
      ]);
    }

    function attemptImport(profile, strategy) {
      const result = importProfile(profile, strategy);

      if (result.ok) {
        window.alert(`Profil « ${result.profile.name} » importé avec succès.`);
        return;
      }

      if (result.conflict) {
        openModal({
          title: "Profil déjà existant",
          body: h("p", {}, `${result.message} Voulez-vous remplacer le profil existant par la version importée, ou importer ce fichier comme un nouveau profil séparé ?`),
          footer: [
            h("button", { class: "btn", type: "button", onClick: () => closeModal() }, "Annuler"),
            h(
              "button",
              {
                class: "btn",
                type: "button",
                onClick: () => {
                  closeModal();
                  attemptImport(profile, "duplicate");
                },
              },
              "Importer comme copie",
            ),
            h(
              "button",
              {
                class: "btn btn--danger",
                type: "button",
                onClick: () => {
                  closeModal();
                  attemptImport(profile, "replace");
                },
              },
              "Remplacer",
            ),
          ],
        });
        return;
      }

      window.alert(result.message);
    }

    function buildProfileCard(profile, isActive) {
      const nameInput = h("input", { type: "text", value: profile.name, "aria-label": `Nom du profil ${profile.name}` });
      const rankSelect = h("select", { "aria-label": `Grade du profil ${profile.name}` }, getRankOptions().map((rank) => h("option", { value: rank }, rank)));
      rankSelect.value = profile.rank;
      rankSelect.addEventListener("change", () => setProfileRank(profile.id, rankSelect.value));

      const renameButton = h("button", { class: "btn-icon", type: "button", "aria-label": `Renommer ${profile.name}` }, "✎");
      renameButton.addEventListener("click", () => {
        const result = renameProfile(profile.id, nameInput.value);
        if (!result.ok) window.alert(result.message);
      });

      const activateButton = h(
        "button",
        { class: isActive ? "btn btn--sm" : "btn btn--primary btn--sm", type: "button", disabled: isActive },
        isActive ? "Profil actif" : "Activer",
      );
      activateButton.addEventListener("click", () => setActiveProfile(profile.id));

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
      deleteButton.addEventListener("click", () => confirmDelete(profile));

      return h("div", { class: isActive ? "card stack card--active" : "card stack" }, [
        h("div", { class: "row row--between" }, [
          h("div", { class: "row" }, [nameInput, renameButton]),
          h("span", { class: "balance-badge__amount" }, formatRyo(profile.balance)),
        ]),
        h("div", { class: "field" }, [h("label", {}, "Grade"), rankSelect]),
        h("p", { class: "text-muted" }, `${profile.inventory.length} type(s) d'objet en inventaire · ${profile.history.length} transaction(s)`),
        h("div", { class: "row" }, [activateButton, duplicateButton, exportButton, deleteButton]),
        buildHistoryPreview(profile),
      ]);
    }

    function buildHistoryPreview(profile) {
      if (!profile.history.length) {
        return h("p", { class: "text-faint" }, "Aucune transaction pour le moment.");
      }
      const recent = profile.history.slice(0, 5);
      return h(
        "div",
        { class: "transaction-list" },
        recent.map((transaction) =>
          h("div", { class: "transaction-item" }, [
            h("span", {}, `${transaction.reason} — ${formatDateTime(transaction.timestamp)}`),
            h(
              "span",
              { class: `transaction-item__amount transaction-item__amount--${transaction.amount >= 0 ? "positive" : "negative"}` },
              formatSignedRyo(transaction.amount),
            ),
          ]),
        ),
      );
    }

    function confirmDelete(profile) {
      openModal({
        title: `Supprimer « ${profile.name} » ?`,
        body: h("p", {}, "Cette action est irréversible : le solde, l'inventaire et l'historique de ce profil seront définitivement perdus."),
        footer: [
          h("button", { class: "btn", type: "button", onClick: () => closeModal() }, "Annuler"),
          h(
            "button",
            {
              class: "btn btn--danger",
              type: "button",
              onClick: () => {
                const result = deleteProfile(profile.id);
                if (!result.ok) window.alert(result.message);
                closeModal();
              },
            },
            "Supprimer définitivement",
          ),
        ],
      });
    }

    render();
    return subscribe(() => render());
  }

  App.profilesView = { renderProfilesView };
})();

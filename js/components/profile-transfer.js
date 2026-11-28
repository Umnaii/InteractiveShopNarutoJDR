/**
 * Profile actions shared by the Profils page and the character sheet: download a profile
 * as a .json file, import one back (with the replace/duplicate conflict dialog), create a
 * profile from a small dialog, and confirm a deletion.
 * Plain script: attaches its API to the shared App namespace as App.profileTransfer.
 * Depends on App.dom, App.modal, App.profiles, App.format (must be loaded first).
 */

(function () {
  "use strict";
  window.App = window.App || {};

  const { h } = App.dom;
  const { openModal, closeModal } = App.modal;
  const { createProfile, deleteProfile, setActiveProfile, exportProfile, parseProfileExport, importProfile } = App.profiles;
  const { getRankOptions } = App.format;

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
   * Trigger a browser download of some text content.
   * @param {string} filename
   * @param {string} content
   * @param {string} type - MIME type, e.g. "application/json".
   * @returns {void}
   */
  function downloadFile(filename, content, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = h("a", { href: url, download: filename });
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  /**
   * Download a profile (balance, inventory, history and character sheet) as a JSON file.
   * @param {object} profile
   * @returns {void}
   */
  function downloadProfile(profile) {
    const payload = exportProfile(profile.id);
    if (!payload) return;
    downloadFile(`boutique-shinobi-${slugify(profile.name)}.json`, JSON.stringify(payload, null, 2), "application/json");
  }

  /**
   * Import an already-parsed profile. If one with the same id exists, ask whether to
   * replace it or import a separate copy.
   * @param {object} profile
   * @param {"replace"|"duplicate"} [strategy]
   * @param {(profile: object) => void} [onImported]
   * @returns {void}
   */
  function attemptImport(profile, strategy, onImported) {
    const result = importProfile(profile, strategy);

    if (result.ok) {
      onImported?.(result.profile);
      window.alert(`Profil « ${result.profile.name} » importé avec succès.`);
      return;
    }

    if (result.conflict) {
      openModal({
        title: "Profil déjà existant",
        body: h("p", {}, `${result.message} Voulez-vous remplacer le profil existant par la version importée, ou importer ce fichier comme un nouveau profil séparé ?`),
        footer: [
          h("button", { class: "btn", type: "button", onClick: () => closeModal() }, "Annuler"),
          h("button", { class: "btn", type: "button", onClick: () => { closeModal(); attemptImport(profile, "duplicate", onImported); } }, "Importer comme copie"),
          h("button", { class: "btn btn--danger", type: "button", onClick: () => { closeModal(); attemptImport(profile, "replace", onImported); } }, "Remplacer"),
        ],
      });
      return;
    }

    window.alert(result.message);
  }

  /**
   * Open the file picker and import the chosen .json profile file.
   * @param {(profile: object) => void} [onImported] - Called with the profile once it's in.
   * @returns {void}
   */
  function openImportPicker(onImported) {
    pickJsonFile((text) => {
      const parsed = parseProfileExport(text);
      if (!parsed.ok) {
        window.alert(parsed.message);
        return;
      }
      attemptImport(parsed.profile, undefined, onImported);
    });
  }

  /**
   * Let the user choose a .json file and hand over its text (nothing happens on cancel).
   * @param {(text: string) => void} onText
   * @returns {void}
   */
  function pickJsonFile(onText) {
    const fileInput = h("input", { type: "file", accept: "application/json,.json", class: "visually-hidden", "aria-hidden": "true", tabindex: "-1" });
    // Kept in the document while the picker is open: some mobile browsers ignore a
    // click() on a detached file input.
    document.body.append(fileInput);
    fileInput.addEventListener("cancel", () => fileInput.remove());
    fileInput.addEventListener("change", async () => {
      const file = fileInput.files[0];
      fileInput.remove();
      if (!file) return;
      onText(await file.text());
    });
    fileInput.click();
  }

  /**
   * Ask for confirmation, then delete a profile.
   * @param {object} profile
   * @returns {void}
   */
  function confirmDeleteProfile(profile) {
    openModal({
      title: `Supprimer « ${profile.name} » ?`,
      body: h("p", {}, "Cette action est irréversible : la fiche de personnage, le solde, l'inventaire et l'historique de ce profil seront définitivement perdus. Pensez à l'exporter d'abord si vous voulez le garder."),
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

  /**
   * Dialog to create a new profile (name + grade). The new profile becomes the active one.
   * @returns {void}
   */
  function openCreateProfileModal() {
    const nameInput = h("input", { type: "text", id: "create-profile-name", placeholder: "Nom du personnage", autocomplete: "off" });
    const rankSelect = h("select", { id: "create-profile-rank" }, getRankOptions().map((rank) => h("option", { value: rank }, rank)));
    const message = h("p", { class: "text-danger", role: "alert" });

    function submit() {
      const result = createProfile(nameInput.value, rankSelect.value);
      if (!result.ok) {
        message.textContent = result.message;
        nameInput.focus();
        return;
      }
      setActiveProfile(result.profile.id);
      closeModal();
    }
    nameInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") submit();
    });

    openModal({
      title: "Nouvelle fiche",
      body: h("div", { class: "stack" }, [
        h("p", { class: "text-muted" }, "La fiche s'ouvre en mode création, avec les budgets du grade choisi."),
        h("div", { class: "form-grid" }, [
          h("div", { class: "field" }, [h("label", { for: "create-profile-name" }, "Nom"), nameInput]),
          h("div", { class: "field" }, [h("label", { for: "create-profile-rank" }, "Grade"), rankSelect]),
        ]),
        message,
      ]),
      footer: [
        h("button", { class: "btn", type: "button", onClick: () => closeModal() }, "Annuler"),
        h("button", { class: "btn btn--primary", type: "button", onClick: submit }, "Créer la fiche"),
      ],
    });
  }

  App.profileTransfer = { slugify, downloadFile, pickJsonFile, downloadProfile, openImportPicker, confirmDeleteProfile, openCreateProfileModal };
})();

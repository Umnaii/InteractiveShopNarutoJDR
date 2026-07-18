/**
 * Missions & payroll view: log a mission's payout breakdown and credit it to one
 * or more profiles, plus a manual GM balance adjustment form.
 * Plain script: attaches its API to the shared App namespace as App.missionsView.
 * Depends on App.missions, App.state, App.economy, App.format, App.dom.
 */

(function () {
  "use strict";
  window.App = window.App || {};

  const { MISSION_RANKS, getMissionRank, DEFAULT_PARTY_SIZE, VILLAGE_CUT_RATE, LEADER_SHARE_MULTIPLIER } = App.missions;
  const { getProfiles, subscribe } = App.state;
  const { computeMissionPayout, creditMissionPayout, adjustBalance } = App.economy;
  const { formatRyo } = App.format;
  const { h, clearElement } = App.dom;

  /**
   * Render the missions & payroll view into a container.
   * @param {HTMLElement} container
   * @returns {() => void} Cleanup function to call when leaving the view.
   */
  function renderMissionsView(container) {
    const formState = {
      rank: "D",
      totalReward: getMissionRank("D").defaultReward,
      partySize: DEFAULT_PARTY_SIZE,
      leaderBonus: false,
      leaderProfileId: null,
      selectedProfileIds: [],
    };

    function render() {
      clearElement(container);
      const profiles = getProfiles();
      container.append(h("div", { class: "view-header" }, [h("h1", {}, "Missions & paie")]));

      if (!profiles.length) {
        container.append(
          h("div", { class: "empty-state" }, [
            h("p", {}, "Créez au moins un profil pour enregistrer une mission."),
            h("a", { class: "btn btn--primary", href: "#/profiles" }, "Gérer les profils"),
          ]),
        );
        return;
      }

      formState.selectedProfileIds = formState.selectedProfileIds.filter((id) => profiles.some((p) => p.id === id));
      if (formState.leaderProfileId && !formState.selectedProfileIds.includes(formState.leaderProfileId)) {
        formState.leaderProfileId = null;
      }

      container.append(buildMissionCard(profiles), buildAdjustmentCard(profiles));
    }

    /**
     * Build the "log a mission" card. Uses small internal render "slots" instead of
     * a full rebuild so typing in the reward/party-size fields keeps focus.
     */
    function buildMissionCard(profiles) {
      const rankSelect = h("select", { id: "mission-rank" }, MISSION_RANKS.map((r) => h("option", { value: r.rank }, `Rang ${r.rank}`)));
      rankSelect.value = formState.rank;

      const rewardInput = h("input", { type: "number", id: "mission-reward", min: "0", value: formState.totalReward });
      const rewardHint = h("span", { class: "field-hint" }, rewardHintText(formState.rank));

      const partySizeInput = h("input", { type: "number", id: "mission-party-size", min: "1", value: formState.partySize });
      const leaderCheckbox = h("input", { type: "checkbox", id: "mission-leader-bonus", checked: formState.leaderBonus });

      const leaderSelectSlot = h("div", {});
      const breakdownSlot = h("div", {});
      const profilesSlot = h("div", { class: "stack" });

      function renderProfilesSlot() {
        clearElement(profilesSlot);
        profilesSlot.append(
          ...profiles.map((profile) => {
            const checkbox = h("input", { type: "checkbox", checked: formState.selectedProfileIds.includes(profile.id) });
            checkbox.addEventListener("change", () => {
              if (checkbox.checked) {
                formState.selectedProfileIds = [...formState.selectedProfileIds, profile.id];
              } else {
                formState.selectedProfileIds = formState.selectedProfileIds.filter((id) => id !== profile.id);
                if (formState.leaderProfileId === profile.id) formState.leaderProfileId = null;
              }
              renderLeaderSelectSlot();
              renderBreakdownSlot();
            });
            return h("label", { class: "checkbox-field" }, [checkbox, `${profile.name} (${profile.rank})`]);
          }),
        );
      }

      function renderLeaderSelectSlot() {
        clearElement(leaderSelectSlot);
        if (!formState.leaderBonus) return;
        const candidates = formState.selectedProfileIds.map((id) => profiles.find((p) => p.id === id)).filter(Boolean);
        const select = h(
          "select",
          { id: "mission-leader" },
          [h("option", { value: "" }, "— Choisir le chef d'équipe —"), ...candidates.map((p) => h("option", { value: p.id }, p.name))],
        );
        select.value = formState.leaderProfileId ?? "";
        select.addEventListener("change", () => {
          formState.leaderProfileId = select.value || null;
          renderBreakdownSlot();
        });
        leaderSelectSlot.append(h("div", { class: "field" }, [h("label", { for: "mission-leader" }, "Chef d'équipe"), select]));
      }

      function renderBreakdownSlot() {
        clearElement(breakdownSlot);
        const breakdown = computeMissionPayout({
          rank: formState.rank,
          totalReward: formState.totalReward,
          partySize: formState.partySize,
          leaderBonus: formState.leaderBonus,
        });

        const rows = [
          ["Total brut", formatRyo(breakdown.gross)],
          [`Part du village (${Math.round(VILLAGE_CUT_RATE * 100)} %)`, `− ${formatRyo(breakdown.villageCut)}`],
          ["Net à répartir", formatRyo(breakdown.net)],
          ["Part par ninja", formatRyo(breakdown.shareEach)],
        ];
        if (breakdown.leaderBonus) rows.push([`Part du chef d'équipe (×${LEADER_SHARE_MULTIPLIER})`, formatRyo(breakdown.leaderShare)]);

        const creditButton = h("button", { class: "btn btn--primary", type: "button" }, "Créditer les profils sélectionnés");
        creditButton.addEventListener("click", () => {
          if (!formState.selectedProfileIds.length) {
            window.alert("Sélectionnez au moins un profil participant.");
            return;
          }
          if (formState.leaderBonus && !formState.leaderProfileId) {
            window.alert("Choisissez le chef d'équipe.");
            return;
          }
          const result = creditMissionPayout(formState.selectedProfileIds, breakdown, formState.rank, formState.leaderProfileId);
          window.alert(result.ok ? "Paie créditée avec succès." : result.message);
        });

        breakdownSlot.append(
          h("table", { class: "table" }, h("tbody", {}, rows.map(([label, value]) => h("tr", {}, [h("td", {}, label), h("td", {}, value)])))),
          creditButton,
        );
      }

      rankSelect.addEventListener("change", () => {
        formState.rank = rankSelect.value;
        formState.totalReward = getMissionRank(formState.rank).defaultReward;
        rewardInput.value = formState.totalReward;
        rewardHint.textContent = rewardHintText(formState.rank);
        renderBreakdownSlot();
      });
      rewardInput.addEventListener("input", () => {
        formState.totalReward = Number(rewardInput.value) || 0;
        renderBreakdownSlot();
      });
      partySizeInput.addEventListener("input", () => {
        formState.partySize = Math.max(1, Math.floor(Number(partySizeInput.value) || 1));
        renderBreakdownSlot();
      });
      leaderCheckbox.addEventListener("change", () => {
        formState.leaderBonus = leaderCheckbox.checked;
        renderLeaderSelectSlot();
        renderBreakdownSlot();
      });

      renderProfilesSlot();
      renderLeaderSelectSlot();
      renderBreakdownSlot();

      return h("div", { class: "card stack" }, [
        h("h2", {}, "Enregistrer une mission"),
        h("div", { class: "form-grid" }, [
          h("div", { class: "field" }, [h("label", { for: "mission-rank" }, "Rang de la mission"), rankSelect]),
          h("div", { class: "field" }, [h("label", { for: "mission-reward" }, "Récompense totale (Ryo)"), rewardInput, rewardHint]),
          h("div", { class: "field" }, [h("label", { for: "mission-party-size" }, "Nombre de ninjas"), partySizeInput]),
        ]),
        h("label", { class: "checkbox-field" }, [leaderCheckbox, "Le chef d'équipe touche 1,5 part"]),
        leaderSelectSlot,
        h("hr", { class: "divider" }),
        h("h3", {}, "Répartition"),
        breakdownSlot,
        h("h3", {}, "Profils participants"),
        profilesSlot,
      ]);
    }

    function buildAdjustmentCard(profiles) {
      const profileSelect = h("select", { id: "adjustment-profile" }, profiles.map((p) => h("option", { value: p.id }, p.name)));
      const amountInput = h("input", { type: "number", id: "adjustment-amount", placeholder: "ex. 500 ou -200" });
      const reasonInput = h("input", { type: "text", id: "adjustment-reason", placeholder: "Raison (ex. amende, trouvaille)" });

      const applyButton = h("button", { class: "btn btn--primary", type: "button" }, "Appliquer l'ajustement");
      applyButton.addEventListener("click", () => {
        const amount = Number(amountInput.value);
        if (!amount) {
          window.alert("Indiquez un montant non nul.");
          return;
        }
        const result = adjustBalance(profileSelect.value, amount, reasonInput.value);
        if (!result.ok) {
          window.alert(result.message);
          return;
        }
        amountInput.value = "";
        reasonInput.value = "";
        window.alert("Ajustement appliqué.");
      });

      return h("div", { class: "card stack" }, [
        h("h2", {}, "Ajustement manuel (décision du conteur)"),
        h("div", { class: "form-grid" }, [
          h("div", { class: "field" }, [h("label", { for: "adjustment-profile" }, "Profil"), profileSelect]),
          h("div", { class: "field" }, [h("label", { for: "adjustment-amount" }, "Montant (Ryo, négatif pour retirer)"), amountInput]),
          h("div", { class: "field" }, [h("label", { for: "adjustment-reason" }, "Raison"), reasonInput]),
        ]),
        applyButton,
      ]);
    }

    render();
    return subscribe(() => render());
  }

  /**
   * Build the "usual range" hint text for a mission rank.
   * @param {string} rank
   * @returns {string}
   */
  function rewardHintText(rank) {
    const info = getMissionRank(rank);
    return `Fourchette usuelle : ${formatRyo(info.min)} – ${info.max ? formatRyo(info.max) : "sans limite"}`;
  }

  App.missionsView = { renderMissionsView };
})();

/**
 * Printable character sheet: the paper sheet "References/ShinobiFichePerso.pdf" (rendered
 * at 300 dpi as img/fiche-ninja.jpg) with the profile's values written in its blanks.
 * openPrintPreview() shows it full screen at the paper's exact A4-landscape proportions;
 * its "Imprimer" button prints that page alone, edge to edge.
 *
 * Every position below is in pixels of the 3508 × 2480 background (300 dpi A4 landscape),
 * measured on the PDF. They become percentages of the page, and font sizes become
 * container-width units (cqw), so the preview and the printed A4 page are the same picture
 * at two sizes. Text that is too long shrinks to fit its blank (see fitText()).
 *
 * Plain script: attaches its API to the shared App namespace as App.sheetPrint.
 * Depends on App.ninjaRules, App.sheetCalc, App.economy, App.format, App.dom.
 */

(function () {
  "use strict";
  window.App = window.App || {};

  const R = App.ninjaRules;
  const C = App.sheetCalc;
  const { getItemById } = App.economy;
  const { formatRyo } = App.format;
  const { h } = App.dom;

  const SVG_NS = "http://www.w3.org/2000/svg";
  const BACKGROUND = "img/fiche-ninja.jpg";
  const PAGE_W = 3508;
  const PAGE_H = 2480;
  /** Text never shrinks below this share of its normal size; past that it is cut with "…". */
  const MIN_FIT_RATIO = 0.5;
  const READY_TIMEOUT_MS = 4000;

  // --- Where everything goes on the paper sheet (background pixels) ---

  /** Identity blanks: left edge, vertical center, width. */
  const IDENTITY = {
    nom: { x: 660, y: 80, w: 410 },
    surnom: { x: 730, y: 141, w: 345 },
    joueur: { x: 1250, y: 80, w: 350 },
    clan: { x: 1198, y: 141, w: 400 },
    affinite: { x: 1805, y: 80, w: 240 },
    grade: { x: 1755, y: 141, w: 285 },
    sexe: { x: 2168, y: 80, w: 185 },
    age: { x: 2147, y: 141, w: 205 },
  };
  /** Two lines to the right of "DESCRIPTION", up to the equipment bars. */
  const DESCRIPTION = { x: 825, y: 178, w: 1515, h: 74 };

  /** Characteristic circles (centers) and the dash of each column's first trait line. */
  const STAT_CIRCLES = { combat: [555, 452], infiltration: [1109, 452], perception: [1691, 452], soutien: [2271, 454] };
  const TRAIT_COLUMNS = { combat: 135, infiltration: 690, perception: 1274, soutien: 1859 };
  const TRAIT_ROWS = [566, 621, 675, 730, 784];
  const TRAIT_WIDTH = 505;

  /** PA and XP: available points in the spiral circle, total earned on the "TOTAL" line. */
  const PA = { circle: [108, 895], total: { x: 296, y: 948, w: 165 } };
  const XP = { circle: [1472, 895], total: { x: 1660, y: 948, w: 165 } };

  const ART_CIRCLES = { ninjutsu: [192, 1145], taijutsu: [557, 1145], genjutsu: [920, 1145], fuinjutsu: [1285, 1145], kuchiyose: [1692, 1145] };

  /** Technique table: 23 rows, the first three already printed (starting techniques). */
  const TECH = {
    firstRowY: 1460,
    rowPitch: 44.3,
    rows: 23,
    printedRows: 3,
    name: { x: 40, w: 1060 },
    type: 1155,
    rank: 1245,
    masteryX: [1342, 1425, 1505, 1583, 1658, 1733],
  };

  /** Equipment: the four orange bars. */
  const EQUIPMENT = { x: 2385, w: 1090, rows: [126, 217, 306, 396] };

  /** Aspects: two writing lines per category (y of the text, just above each line). */
  const ASPECTS = {
    reputations: { x: 2392, rows: [578, 631] },
    clan: { x: 2930, rows: [578, 631] },
    personnalite: { x: 2392, rows: [742, 795] },
    heredite: { x: 2930, rows: [742, 795] },
    liens: { x: 2392, rows: [907, 959] },
    autres: { x: 2930, rows: [907, 959] },
  };
  const ASPECT_WIDTH = 505;

  /** Énergie vitale and chakra: current value above the line, maximum after "MAX". */
  const GAUGES = {
    vitality: { current: [2100, 1170], max: { x: 2110, y: 1256, w: 75 } },
    chakra: { current: [3226, 1170], max: { x: 3236, y: 1256, w: 75 } },
  };

  /** Base elements: value written in the lower half of each ring. */
  const ELEMENT_VALUES = { feu: [2665, 1706], vent: [2858, 1862], foudre: [2801, 2069], terre: [2556, 2073], eau: [2496, 1862] };

  /** Combined natures (ring centers), circled when unlocked. */
  const NATURE_RINGS = {
    saifoton: [2672, 1290], enton: [2672, 1491], futton: [2419, 1508], shakuton: [2944, 1500],
    yoton: [2144, 1639], hiton: [3211, 1639], awaton: [2341, 1744], kutton: [3003, 1744],
    jiton: [2672, 1861], nendoton: [2228, 1994], hayaiton: [3094, 2000], shoton: [2433, 2161],
    denton: [2906, 2161], ranton: [2289, 2326], bakuton: [2667, 2313], sunaton: [3017, 2326],
  };
  const NATURE_RING_RADIUS = 84;

  /** The two Kekkei Genkai rings, bottom corners of the wheel. */
  const KEKKEI_GENKAI_SLOTS = [[2043, 2256], [3307, 2256]];
  const KG_TEXT_WIDTH = 190;

  /** Ink colors, matching what is already printed on the sheet. */
  const INK = "#1d2f5c";
  const INK_RED = "#9b1c1c";

  // --- Small helpers ---

  const pctX = (x) => `${(x / PAGE_W) * 100}%`;
  const pctY = (y) => `${(y / PAGE_H) * 100}%`;
  const cqw = (size) => `${(size / PAGE_W) * 100}cqw`;

  function signed(value) {
    return value > 0 ? `+${value}` : value < 0 ? `−${Math.abs(value)}` : "0";
  }

  /**
   * One line of text in a blank of the sheet.
   * @param {string} text
   * @param {{x: number, y: number, w: number, size?: number, align?: "left"|"center"|"right", color?: string, cls?: string}} box
   *   `y` is the vertical center of the line.
   */
  function textAt(text, box) {
    if (text === "" || text === null || text === undefined) return null;
    const size = box.size ?? 34;
    const height = size * 1.5;
    return h(
      "div",
      {
        class: `ps-text${box.cls ? ` ${box.cls}` : ""}`,
        "data-size": String(size),
        style: [
          `left:${pctX(box.x)}`,
          `top:${pctY(box.y - height / 2)}`,
          `width:${pctX(box.w)}`,
          `height:${pctY(height)}`,
          `line-height:${cqw(height)}`,
          `font-size:${cqw(size)}`,
          `text-align:${box.align ?? "left"}`,
          box.color ? `color:${box.color}` : "",
        ].join(";"),
      },
      String(text),
    );
  }

  /** A number centered on a point (circles of the sheet). */
  function valueAt(value, [x, y], size, color) {
    const width = size * 3;
    return textAt(value, { x: x - width / 2, y, w: width, size, align: "center", color, cls: "ps-text--value" });
  }

  function svg(tag, attrs, children) {
    const element = document.createElementNS(SVG_NS, tag);
    for (const [key, value] of Object.entries(attrs || {})) element.setAttribute(key, String(value));
    for (const child of children || []) if (child) element.append(child);
    return element;
  }

  // --- Content of each part ---

  function affinityText(sheet) {
    const name = (key) => R.ELEMENTS.find((element) => element.key === key)?.name ?? "";
    return [sheet.elementRoles.affinity, sheet.elementRoles.second].filter(Boolean).map(name).join(" · ");
  }

  function buildIdentity(profile, sheet) {
    const identity = sheet.identity;
    const values = {
      nom: profile.name,
      surnom: identity.surnom,
      joueur: identity.joueur,
      clan: identity.clan,
      affinite: affinityText(sheet),
      grade: profile.rank,
      sexe: identity.sexe,
      age: identity.age,
    };
    const fields = Object.entries(IDENTITY).map(([key, box]) => textAt(values[key], { ...box, size: 38 }));

    const description = identity.description.trim();
    if (description) {
      fields.push(
        h(
          "div",
          {
            class: "ps-text ps-text--multi",
            "data-size": "28",
            style: [
              `left:${pctX(DESCRIPTION.x)}`,
              `top:${pctY(DESCRIPTION.y)}`,
              `width:${pctX(DESCRIPTION.w)}`,
              `height:${pctY(DESCRIPTION.h)}`,
              `font-size:${cqw(28)}`,
              `line-height:1.3`,
            ].join(";"),
          },
          description,
        ),
      );
    }
    return fields;
  }

  function buildStats(sheet) {
    const parts = [];
    for (const stat of R.STATS) {
      parts.push(valueAt(sheet.stats[stat.key], STAT_CIRCLES[stat.key], 72, INK_RED));
      const traits = sheet.traits[stat.key].slice(0, sheet.stats[stat.key]);
      traits.forEach((trait, index) => {
        parts.push(textAt(trait.trim(), { x: TRAIT_COLUMNS[stat.key], y: TRAIT_ROWS[index], w: TRAIT_WIDTH, size: 30 }));
      });
    }
    return parts;
  }

  function buildExperience(sheet) {
    const summary = C.experienceSummary(sheet);
    return [
      valueAt(summary.pa.available, PA.circle, 48),
      textAt(summary.pa.earned, { ...PA.total, size: 36 }),
      valueAt(summary.px.available, XP.circle, 48),
      textAt(summary.px.earned, { ...XP.total, size: 36 }),
    ];
  }

  function buildArts(sheet) {
    return R.ARTS.map((art) => valueAt(sheet.arts[art.key], ART_CIRCLES[art.key], 84, INK_RED));
  }

  /**
   * Rows of the technique table: the three starting techniques on their printed rows,
   * every other technique after them. Returns {row, technique, printed} entries.
   */
  function techniqueRows(sheet) {
    const remaining = [...sheet.techniques];
    const rows = [];
    R.STARTING_TECHNIQUES.forEach((start, index) => {
      const found = remaining.findIndex((tech) => tech.origin === "start" && tech.name === start.name);
      if (found === -1) return;
      rows.push({ row: index, technique: remaining.splice(found, 1)[0], printed: true });
    });
    remaining.forEach((technique, index) => rows.push({ row: TECH.printedRows + index, technique, printed: false }));
    return rows;
  }

  function buildTechniques(sheet, marks) {
    const parts = [];
    const rows = techniqueRows(sheet);
    const lastRow = TECH.rows - 1;
    const overflow = rows.filter((entry) => entry.row > lastRow).length;

    for (const { row, technique, printed } of rows) {
      if (row > lastRow || (overflow && row === lastRow)) continue;
      const y = TECH.firstRowY + row * TECH.rowPitch;

      if (!printed) {
        const art = R.ARTS.find((entry) => entry.key === technique.art);
        parts.push(
          textAt((technique.name || "Technique sans nom").toUpperCase(), { x: TECH.name.x, y, w: TECH.name.w, size: 32, align: "right", cls: "ps-text--tech" }),
          textAt((art?.abbr ?? "").toUpperCase(), { x: TECH.type - 42, y, w: 84, size: 30, align: "center", cls: "ps-text--tech" }),
          textAt(technique.rank, { x: TECH.rank - 42, y, w: 84, size: 30, align: "center", cls: "ps-text--tech" }),
        );
      }

      // Every mastery level reached so far is filled in, like ticking boxes on paper.
      const reached = R.MASTERY_LEVELS.findIndex((level) => level.key === technique.mastery);
      for (let index = 0; index <= reached; index += 1) {
        marks.push(svg("ellipse", { class: "ps-mark", cx: TECH.masteryX[index] + 1, cy: y + 2, rx: 12, ry: 13 }));
      }
    }

    if (overflow) {
      const y = TECH.firstRowY + lastRow * TECH.rowPitch;
      parts.push(textAt(`+ ${overflow + 1} autres techniques (voir la fiche en ligne)`, { x: TECH.name.x, y, w: TECH.name.w, size: 30, align: "right", cls: "ps-text--tech" }));
    }
    return parts;
  }

  /** Inventory + items added by hand + purse, spread over the four bars. */
  function equipmentLines(profile, sheet) {
    const entries = [];
    for (const entry of profile.inventory ?? []) {
      const item = getItemById(entry.itemId);
      if (!item) continue;
      entries.push(entry.quantity > 1 ? `${item.name} ×${entry.quantity}` : item.name);
    }
    for (const item of sheet.customItems) entries.push(item.name || "Objet sans nom");
    entries.push(`Bourse : ${formatRyo(profile.balance)}`);

    // Fill the bars evenly by length, keeping the order.
    const lines = EQUIPMENT.rows.map(() => []);
    const total = entries.reduce((sum, text) => sum + text.length + 3, 0);
    const perLine = Math.max(1, total / EQUIPMENT.rows.length);
    let line = 0;
    let used = 0;
    for (const text of entries) {
      if (used > 0 && used + text.length / 2 > perLine * (line + 1) && line < lines.length - 1) line += 1;
      lines[line].push(text);
      used += text.length + 3;
    }
    return lines.map((parts) => parts.join("  ·  "));
  }

  function buildEquipment(profile, sheet) {
    return equipmentLines(profile, sheet).map((text, index) => textAt(text, { x: EQUIPMENT.x, y: EQUIPMENT.rows[index], w: EQUIPMENT.w, size: 32 }));
  }

  function buildAspects(sheet) {
    const parts = [];
    for (const category of R.ASPECT_CATEGORIES) {
      const place = ASPECTS[category.key];
      sheet.aspects[category.key].forEach((text, index) => {
        parts.push(textAt(text.trim(), { x: place.x, y: place.rows[index], w: ASPECT_WIDTH, size: 30 }));
      });
    }
    return parts;
  }

  function buildGauges(sheet) {
    const parts = [];
    for (const key of ["vitality", "chakra"]) {
      const place = GAUGES[key];
      parts.push(valueAt(sheet[key].current, place.current, 62, INK_RED), textAt(sheet[key].max, { ...place.max, size: 40, color: INK_RED, cls: "ps-text--value" }));
    }
    return parts;
  }

  function buildElements(sheet, marks) {
    const parts = R.ELEMENTS.map((element) => valueAt(signed(sheet.elements[element.key]), ELEMENT_VALUES[element.key], 40));

    for (const key of sheet.unlockedNatures) {
      const center = NATURE_RINGS[key];
      if (!center) continue;
      marks.push(svg("circle", { class: "ps-nature", cx: center[0], cy: center[1], r: NATURE_RING_RADIUS }));
    }

    sheet.kekkeiGenkai.forEach((key, index) => {
      const nature = R.NATURES.find((entry) => entry.key === key);
      const center = KEKKEI_GENKAI_SLOTS[index];
      if (!nature || !center) return;
      const box = { x: center[0] - KG_TEXT_WIDTH / 2, w: KG_TEXT_WIDTH, align: "center" };
      parts.push(
        textAt(nature.name, { ...box, y: center[1] - 24, size: 28, cls: "ps-text--value" }),
        textAt(nature.label, { ...box, y: center[1] + 12, size: 24 }),
        textAt(signed(C.natureStatus(sheet, nature).level), { ...box, y: center[1] + 48, size: 30, cls: "ps-text--value" }),
      );
    });
    return parts;
  }

  /**
   * The printable page for a profile (not yet in the document).
   * @param {object} profile
   * @returns {HTMLElement}
   */
  function buildPrintSheet(profile) {
    const sheet = C.normalizeSheet(profile.sheet, profile.rank);
    const marks = [];
    const texts = [
      ...buildIdentity(profile, sheet),
      ...buildStats(sheet),
      ...buildExperience(sheet),
      ...buildArts(sheet),
      ...buildTechniques(sheet, marks),
      ...buildEquipment(profile, sheet),
      ...buildAspects(sheet),
      ...buildGauges(sheet),
      ...buildElements(sheet, marks),
    ];

    const overlay = svg("svg", { class: "ps-marks", viewBox: `0 0 ${PAGE_W} ${PAGE_H}`, preserveAspectRatio: "none", "aria-hidden": "true" }, marks);

    return h("div", { class: "print-sheet", role: "img", "aria-label": `Fiche de ninja de ${profile.name}, format A4 paysage` }, [
      h("img", { class: "print-sheet__paper", src: BACKGROUND, alt: "", decoding: "async" }),
      overlay,
      ...texts.filter(Boolean),
    ]);
  }

  /**
   * Shrink each text until it fits its blank, starting again from its normal size (sizes
   * are in cqw, so the result holds at any page size: preview and printed page alike).
   * @param {HTMLElement} page
   */
  function fitText(page) {
    for (const element of page.querySelectorAll(".ps-text")) {
      const base = Number(element.dataset.size);
      const multi = element.classList.contains("ps-text--multi");
      const overflows = () => (multi ? element.scrollHeight > element.clientHeight + 1 : element.scrollWidth > element.clientWidth + 1);
      let size = base;
      element.style.fontSize = cqw(size);
      while (overflows() && size > base * MIN_FIT_RATIO) {
        size *= 0.92;
        element.style.fontSize = cqw(size);
      }
    }
  }

  // --- Preview ---

  let closeActive = null;

  /**
   * Open the full-screen print preview of a profile's sheet.
   * @param {object} profile
   */
  function openPrintPreview(profile) {
    closeActive?.();
    const lastFocused = document.activeElement;
    const page = buildPrintSheet(profile);

    // A4 landscape, no margin, only while the preview is open (printing other pages of the
    // site keeps the browser's defaults).
    const pageStyle = h("style", { id: "print-page-style" }, "@page { size: A4 landscape; margin: 0; }");

    const printButton = h("button", { class: "btn btn--primary", type: "button", disabled: true }, "Chargement…");
    const closeButton = h("button", { class: "btn", type: "button" }, "Fermer");
    const stage = h("div", { class: "print-preview__stage" }, page);
    page.addEventListener("click", () => stage.classList.toggle("is-zoomed"));

    const preview = h("div", { class: "print-preview", role: "dialog", "aria-modal": "true", "aria-label": "Aperçu avant impression" }, [
      h("div", { class: "print-preview__bar" }, [
        h("div", { class: "print-preview__title" }, [
          h("strong", {}, "Aperçu avant impression"),
          h("span", {}, "A4 paysage · touchez la fiche pour zoomer · marges du navigateur sur « Aucune » si proposé."),
        ]),
        h("div", { class: "print-preview__actions" }, [printButton, closeButton]),
      ]),
      stage,
    ]);

    function onKeyDown(event) {
      if (event.key === "Escape") close();
    }
    // A font that arrives late changes text widths: fit again from the normal sizes.
    const refit = () => fitText(page);

    function close() {
      preview.remove();
      pageStyle.remove();
      document.body.classList.remove("is-print-preview");
      document.removeEventListener("keydown", onKeyDown);
      document.fonts?.removeEventListener?.("loadingdone", refit);
      window.removeEventListener("beforeprint", refit);
      closeActive = null;
      if (lastFocused instanceof HTMLElement) lastFocused.focus();
    }
    closeActive = close;

    closeButton.addEventListener("click", close);
    printButton.addEventListener("click", () => window.print());
    document.addEventListener("keydown", onKeyDown);
    document.fonts?.addEventListener?.("loadingdone", refit);
    window.addEventListener("beforeprint", refit);

    document.head.append(pageStyle);
    document.body.append(preview);
    document.body.classList.add("is-print-preview");
    closeButton.focus();

    const paper = page.querySelector(".print-sheet__paper");
    const ready = () => {
      fitText(page);
      printButton.disabled = false;
      printButton.textContent = "Imprimer";
    };
    const fontsReady = document.fonts?.ready ?? Promise.resolve();
    const imageReady = paper.decode ? paper.decode().catch(() => undefined) : Promise.resolve();
    // Never leave the button stuck on "Chargement…" if a browser is slow to report.
    const timeout = new Promise((resolve) => setTimeout(resolve, READY_TIMEOUT_MS));
    const loaded = Promise.all([fontsReady, imageReady]);
    Promise.race([loaded, timeout]).then(() => {
      if (preview.isConnected) ready();
    });
    // If the timeout won, fit again once the fonts really are there.
    loaded.then(() => {
      if (preview.isConnected) fitText(page);
    });
  }

  App.sheetPrint = { openPrintPreview, buildPrintSheet, fitText };
})();

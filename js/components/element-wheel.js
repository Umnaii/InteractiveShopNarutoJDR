/**
 * The element wheel of the paper sheet, drawn as inline SVG: the five base elements on a
 * pentagon with the domination arrows (Feu > Vent > Foudre > Terre > Eau > Feu), the
 * combined natures around them linked to their elements, Jiton in the center and the two
 * Kekkei Genkai slots in the bottom corners. A nature lights up when its prerequisites are
 * met and is drawn solid once unlocked. Display only: the controls live in the sheet view.
 * Plain script: attaches its API to the shared App namespace as App.elementWheel.
 * Depends on App.ninjaRules, App.sheetCalc (must be loaded first).
 */

(function () {
  "use strict";
  window.App = window.App || {};

  const R = App.ninjaRules;
  const C = App.sheetCalc;
  const SVG_NS = "http://www.w3.org/2000/svg";

  const VIEW_BOX = "0 -12 600 524";
  const BASE_RADIUS = 34;
  const NATURE_RADIUS = 29;
  /** Widest a nature name may be drawn inside its disc, in SVG units. */
  const NAME_MAX_WIDTH = 54;
  const KG_SLOT_POSITIONS = [
    { x: 44, y: 470 },
    { x: 556, y: 470 },
  ];

  /**
   * Create an SVG element.
   * @param {string} tag
   * @param {Object<string, string|number>} [attrs]
   * @param {Array<Node|string>} [children]
   * @returns {SVGElement}
   */
  function svg(tag, attrs, children) {
    const element = document.createElementNS(SVG_NS, tag);
    for (const [key, value] of Object.entries(attrs || {})) {
      if (value !== undefined && value !== null && value !== false) element.setAttribute(key, String(value));
    }
    for (const child of children || []) {
      if (child === null || child === undefined || child === false) continue;
      element.append(typeof child === "string" ? document.createTextNode(child) : child);
    }
    return element;
  }

  function signed(value) {
    return value > 0 ? `+${value}` : String(value);
  }

  /** A point on the segment from `from` towards `to`, `distance` away from `from`. */
  function towards(from, to, distance) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.hypot(dx, dy) || 1;
    return { x: from.x + (dx / length) * distance, y: from.y + (dy / length) * distance };
  }

  /** Gradient running through the colors of a nature's elements (its ring color). */
  function natureGradient(nature, idPrefix) {
    const colors = nature.elements.map((key) => C.elementDef(key).color);
    const stops = colors.length === 1 ? [colors[0], colors[0]] : colors;
    return svg(
      "linearGradient",
      { id: `${idPrefix}-${nature.key}`, x1: "0", y1: "0", x2: "1", y2: "1" },
      stops.map((color, index) => svg("stop", { offset: `${(index / (stops.length - 1)) * 100}%`, "stop-color": color })),
    );
  }

  /**
   * One nature disc: dashed and faded while locked, glowing orange when its prerequisites
   * are met, solid once unlocked.
   */
  function natureNode(nature, position, status, idPrefix, radius) {
    const state = status.unlocked ? "unlocked" : status.lit ? "lit" : "locked";
    const stateLabel = status.unlocked ? "débloquée" : status.lit ? "prérequis remplis" : "verrouillée";
    return svg("g", { class: `wheel-node wheel-node--nature is-${state}`, transform: `translate(${position.x} ${position.y})` }, [
      svg("title", {}, [`${nature.name} (${nature.label}) : ${stateLabel}${status.unlocked || status.lit ? `, niveau ${signed(status.level)}` : ""}`]),
      state === "lit" ? svg("circle", { class: "wheel-node__glow", r: radius + 6 }) : null,
      svg("circle", { class: "wheel-node__disc", r: radius, stroke: `url(#${idPrefix}-${nature.key})` }),
      svg(
        "text",
        {
          class: "wheel-node__name",
          y: status.unlocked || status.lit ? -6 : -2,
          // Long names (Shikotsumyaku...) are squeezed to fit the disc instead of overflowing it.
          ...(nature.name.length > 9 ? { textLength: NAME_MAX_WIDTH, lengthAdjust: "spacingAndGlyphs" } : {}),
        },
        [nature.name],
      ),
      svg("text", { class: "wheel-node__label", y: status.unlocked || status.lit ? 7 : 11 }, [nature.label]),
      status.unlocked || status.lit ? svg("text", { class: "wheel-node__level", y: 21 }, [signed(status.level)]) : null,
    ]);
  }

  /**
   * Build the wheel for a sheet.
   * @param {object} sheet - A sanitized sheet (App.sheet.getSheet).
   * @returns {SVGSVGElement}
   */
  function createElementWheel(sheet) {
    const idPrefix = `wheel-${Math.random().toString(36).slice(2, 8)}`;
    const positionOf = new Map(R.ELEMENTS.map((element) => [element.key, { x: element.x, y: element.y }]));
    const wheelNatures = R.NATURES.filter((nature) => nature.x !== undefined);
    const statuses = new Map(R.NATURES.map((nature) => [nature.key, C.natureStatus(sheet, nature)]));

    const defs = svg("defs", {}, [
      svg("marker", { id: `${idPrefix}-arrow`, viewBox: "0 0 10 10", refX: "8", refY: "5", markerWidth: "5", markerHeight: "5", orient: "auto-start-reverse" }, [
        svg("path", { d: "M0 0L10 5L0 10z", fill: "#d23a2e" }),
      ]),
      ...R.NATURES.map((nature) => natureGradient(nature, idPrefix)),
    ]);

    // Links from each nature to the elements it combines.
    const links = svg(
      "g",
      { class: "wheel-links" },
      wheelNatures.flatMap((nature) => {
        const status = statuses.get(nature.key);
        const state = status.unlocked ? "unlocked" : status.lit ? "lit" : "locked";
        return nature.elements.map((key) => {
          const from = towards({ x: nature.x, y: nature.y }, positionOf.get(key), NATURE_RADIUS);
          const to = towards(positionOf.get(key), { x: nature.x, y: nature.y }, BASE_RADIUS);
          return svg("line", { class: `wheel-link is-${state}`, x1: from.x, y1: from.y, x2: to.x, y2: to.y, stroke: C.elementDef(key).color });
        });
      }),
    );

    // Domination arrows around the pentagon.
    const arrows = svg(
      "g",
      { class: "wheel-arrows" },
      R.ELEMENTS.map((element, index) => {
        const next = R.ELEMENTS[(index + 1) % R.ELEMENTS.length];
        const from = towards(element, next, BASE_RADIUS + 3);
        const to = towards(next, element, BASE_RADIUS + 5);
        return svg("line", { class: "wheel-arrow", x1: from.x, y1: from.y, x2: to.x, y2: to.y, "marker-end": `url(#${idPrefix}-arrow)` });
      }),
    );

    const roleOf = (key) => {
      const { affinity, second, weak } = sheet.elementRoles;
      if (key === affinity) return "affinité";
      if (key === second) return "2de affinité";
      if (key === weak) return "faible";
      return "";
    };

    const baseNodes = R.ELEMENTS.map((element) => {
      const value = sheet.elements[element.key];
      const role = roleOf(element.key);
      return svg(
        "g",
        { class: `wheel-node wheel-node--base${value > 0 ? " is-positive" : ""}`, transform: `translate(${element.x} ${element.y})` },
        [
          svg("title", {}, [`${element.name} (${element.label}) : ${signed(value)}${role ? `, ${role}` : ""}`]),
          svg("circle", { class: "wheel-node__disc", r: BASE_RADIUS, stroke: element.color }),
          svg("text", { class: "wheel-node__name wheel-node__name--base", y: -10, fill: element.color }, [element.name]),
          svg("text", { class: "wheel-node__label", y: 3 }, [element.label]),
          svg("text", { class: "wheel-node__value", y: 24 }, [signed(value)]),
        ],
      );
    });

    const natureNodes = wheelNatures.map((nature) => natureNode(nature, { x: nature.x, y: nature.y }, statuses.get(nature.key), idPrefix, NATURE_RADIUS));

    const kgNodes = KG_SLOT_POSITIONS.map((position, slot) => {
      const nature = C.natureDef(sheet.kekkeiGenkai[slot]);
      const locked = slot > 0 && sheet.mode === "creation";
      if (nature) return natureNode(nature, position, statuses.get(nature.key), idPrefix, NATURE_RADIUS + 3);
      return svg("g", { class: `wheel-node wheel-node--slot${locked ? " is-locked" : ""}`, transform: `translate(${position.x} ${position.y})` }, [
        svg("title", {}, [locked ? "Kekkei Genkai : 2e emplacement verrouillé pendant la création" : "Kekkei Genkai : emplacement libre"]),
        svg("circle", { class: "wheel-node__disc", r: NATURE_RADIUS + 3 }),
        svg("text", { class: "wheel-node__label", y: -3 }, ["Kekkei"]),
        svg("text", { class: "wheel-node__label", y: 9 }, [locked ? "verrouillé" : "Genkai"]),
      ]);
    });

    const summary = R.ELEMENTS.map((element) => `${element.label} ${signed(sheet.elements[element.key])}`).join(", ");
    const unlockedNames = sheet.unlockedNatures.map((key) => C.natureDef(key)?.name).filter(Boolean);

    return svg(
      "svg",
      {
        class: "element-wheel",
        viewBox: VIEW_BOX,
        role: "img",
        "aria-label": `Roue des éléments. ${summary}.${unlockedNames.length ? ` Natures débloquées : ${unlockedNames.join(", ")}.` : ""}`,
      },
      [defs, links, arrows, ...natureNodes, ...baseNodes, ...kgNodes],
    );
  }

  App.elementWheel = { createElementWheel };
})();

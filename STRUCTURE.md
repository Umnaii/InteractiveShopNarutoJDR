# Structure

Architecture reference for Boutique Shinobi. Keep this file in sync with the code:
if you move, rename, add or remove a module, update the section below that describes it.

## 1. File tree

```
index.html                   Page shell: header, nav, #app-view, #modal-root, loads every script below in order
STRUCTURE.md                 This file
README.md                    What it is, how to run it, how data persists, how to reset it

css/
  variables.css               Design tokens: colors, spacing, typography, radii, shadows
  base.css                    CSS reset, base element styles, focus-visible, scrollbars
  layout.css                  App shell: header, nav, responsive containers/grids
  components.css               Buttons, cards, badges, star ratings, tables, forms, modal, toggles

data/
  items.js                    App.items: the full catalogue array, extracted from boutique_shinobi_catalogue.md, + category labels
  rarities.js                 App.rarities: the 5-tier rarity legend, + closing note
  missions.js                 App.missions: mission ranks (D..S, plus a "Libre" free-form rank), village cut / party size / leader multiplier constants

js/
  main.js                     Entry point: boots state, builds header/nav, registers routes, starts the router
  router.js                   Tiny hash router: registerRoute(pattern, handler), navigate(path), initRouter() -> App.router
  state.js                    In-memory app state singleton + subscribe/notify -> App.state. The ONLY module allowed to call App.storage. Also owns the session-only cart (not persisted)
  storage.js                  localStorage read/write, key naming, schema version + migrations -> App.storage. The ONLY module allowed to touch localStorage
  profiles.js                 Profile CRUD (create/rename/duplicate/delete/activate) + export/import as a portable JSON file -> App.profiles. Mutates state through App.state
  economy.js                  ALL Ryo math: purchase, cart checkout, undo-purchase, resale, consume, manual adjustment, mission payout breakdown/crediting + GM mission journal -> App.economy
  format.js                   Pure formatting helpers: Ryo strings, star glyphs, French labels, dates, CSV field escaping -> App.format
  dom.js                      Tiny `h(tag, attrs, children)` element builder + clearElement() -> App.dom, shared by components/views
  components/
    star-rating.js               Renders a rarity integer as colored ★/☆ glyphs -> App.starRating
    item-card.js                 Shop grid tile: name links to detail view, quick-buy + add-to-cart buttons -> App.itemCard
    modal.js                     Generic modal dialog (openModal/closeModal), used for delete confirmation and the full transaction history table -> App.modal
    filters.js                   Shop filter bar: category/rarity/type/search/sort controls -> App.filters
  views/
    shop.js                      Route "/shop" — browse + filter + sort the catalogue, quick-buy or add to cart -> App.shopView
    item-detail.js               Route "/item/:id" — full item info, buy or add to cart with quantity -> App.itemDetailView
    cart.js                      Route "/cart" — review/adjust the cart, check out for the active profile -> App.cartView
    rarities.js                  Route "/rarities" — the rarity legend table -> App.raritiesView
    inventory.js                 Route "/inventory" — active profile's owned items, consume/resell/undo purchase -> App.inventoryView
    missions.js                  Route "/missions" — mission payout calculator, manual adjustment form, GM-only mission journal (CSV export) -> App.missionsView
    profiles.js                  Route "/profiles" — profile CRUD UI + transaction history preview/full history/CSV export -> App.profilesView
```

This matches the layout requested at project kickoff, with one addition: `js/dom.js`. It
was not in the original list but was added because components/ and views/ all need the
same tiny "build a DOM element" helper — without it, that logic would have been copy-pasted
into ~10 files. It has a single responsibility (DOM construction) and no state of its own.

## 2. Why plain scripts, not ES modules

The app is loaded as a set of classic `<script src="...">` tags (see `index.html`), not
`<script type="module">` and not `import`/`export`. This is a deliberate choice: it means
`index.html` works by **double-clicking it directly** (a `file://` URL), with no local
server, no build step, and no "why do I need Python" moment — genuinely just a webpage.
ES modules are blocked by browsers on `file://` for security reasons, which is the only
reason a project would need a server just to preview itself locally.

The trade-off: without `import`/`export`, files need some other way to share code. Every
file in this project follows the same pattern —

```js
(function () {
  "use strict";
  window.App = window.App || {};

  // ...file-local functions and constants (not visible outside this file)...

  App.economy = { purchaseItem, resellItem, /* ...its public API... */ };
})();
```

Each file is wrapped in an IIFE (Immediately Invoked Function Expression), so its internal
helpers and constants stay private — only the object assigned to a property of `App` (the
single shared namespace, e.g. `App.economy`, `App.state`, `App.shopView`) is visible to
other files. This is the classic-script equivalent of ES module `export`: the property name
on `App` (e.g. `App.economy`) is the "module," and the keys inside that object are its
public API, exactly mirroring what used to be named exports.

**Load order matters and is fixed by `index.html`.** A file that reads `App.state` at the
top of its IIFE (e.g. `const { getProfiles } = App.state;`) requires `state.js` to have
already run — i.e. its `<script>` tag must appear earlier in `index.html`. The dependency
chain, in the order the scripts are loaded:

```
data/items.js, data/rarities.js, data/missions.js   (no dependencies)
  -> js/dom.js                                        (no dependencies)
  -> js/format.js                                      (needs App.items)
  -> js/storage.js                                     (no dependencies)
  -> js/state.js                                        (needs App.storage)
  -> js/profiles.js                                      (needs App.state)
  -> js/economy.js                                        (needs App.items, App.missions, App.state, App.profiles)
  -> js/components/star-rating.js                          (needs App.dom, App.format)
  -> js/components/item-card.js                             (needs App.dom, App.starRating, App.format)
  -> js/components/modal.js                                 (needs App.dom)
  -> js/components/filters.js                               (needs App.dom, App.items, App.format)
  -> js/views/*.js                                            (each needs whichever of the above it reads — see its header comment; js/views/cart.js needs App.state, App.economy, App.format, App.dom)
  -> js/router.js                                              (no dependencies)
  -> js/main.js                                                 (needs everything; boots the app on DOMContentLoaded)
```

If you add a new file, add its `<script>` tag to `index.html` **after** every file it
reads from `App.*`, and say what it depends on in its own header comment (matching the
pattern above) so the next person doesn't have to guess.

**One acknowledged trade-off:** this means the whole app hangs a single object off
`window` (`window.App`). That's the one deliberate exception to "no globals" — it's
unavoidable without a module system, and it's a single, namespaced object rather than
many loose globals, which keeps the blast radius small and collisions unlikely.

## 3. Data flow

```
localStorage  <-->  App.storage  <-->  App.state  <-->  App.profiles / App.economy
                                          |                      |
                                          v                      v
                                   App.*View  <----  App.itemCard / App.starRating / App.modal / App.filters
```

- **State lives in `js/state.js`**, a variable private to that file's IIFE (not a property
  of `App` itself, not attached to `window` directly — only the getter/setter functions
  around it are exposed as `App.state.*`).
- **`js/storage.js`** is the only file that calls `localStorage` directly. It JSON-encodes/
  decodes, and falls back to clean defaults on any parse error or missing key so a
  corrupted or wiped localStorage never crashes the app.
- **Views read state** via `App.state` getters (`getProfiles()`, `getActiveProfile()`,
  `getSettings()`, ...) and call `App.state.subscribe(listener)` to re-render when anything
  changes.
- **Mutations never happen in views.** A view calls a function on `App.profiles` (profile
  CRUD) or `App.economy` (anything touching Ryo or inventory quantities). Those modules
  read/transform the relevant profile(s) and call `App.state`'s setters
  (`setProfiles`, `setActiveProfileId`, `setSettings`), which persist via `App.storage`
  and then notify subscribers.
- **A mutation propagates back to the UI** as: a `App.*View` action handler -> an
  `App.profiles` / `App.economy` mutator -> an `App.state` setter -> `App.storage` write +
  `App.state` notify -> every subscribed view's listener re-renders itself from the now-
  current state.
- **Routing** (`App.router`) is orthogonal to this: it owns which view is mounted into
  `#app-view`, based on `location.hash`. Each view's render function may return a cleanup
  callback (typically the `unsubscribe` returned by `App.state.subscribe()`), which the
  router calls before mounting the next view, so listeners never pile up across
  navigations.

## 4. Data model schemas

```js
// data/items.js -> App.items.ITEMS
/**
 * @typedef {Object} Item
 * @property {string} id            // stable kebab-case slug, e.g. "kunai-explosif"
 * @property {string} name          // French display name
 * @property {string} category      // "A".."J", matches App.items.CATEGORY_LABELS keys
 * @property {number} rarity        // integer 1..5 (star count); ranged rarities use the lower bound
 * @property {number|{min:number,max:number}|null} price   // Ryo; null = hors-commerce/non vendu
 * @property {string} priceLabel    // raw French price string, exactly as shown to players
 * @property {{quantity:number,price:number}} [bulk] // optional catalogue bulk-pack discount,
 *   e.g. shuriken: {quantity:5, price:450} instead of 5x100. Applied automatically by
 *   economy.js's getItemTotalPrice() — never multiply price * quantity yourself.
 * @property {"consommable"|"permanent"|"restreint"|"intrigue"} type
 * @property {string} usage         // French conditions of use
 * @property {string} effect        // French mechanical effect text
 * @property {boolean} purchasable  // false for hors-commerce / non vendues items
 * @property {boolean} gmOnly       // true for section F (restricted substances) and J (plot items)
 */

// data/rarities.js -> App.rarities.RARITY_TIERS
/**
 * @typedef {Object} RarityTier
 * @property {number} stars         // 1..5
 * @property {string} label         // star glyphs, e.g. "★★★"
 * @property {string} whereToFind   // French text
 * @property {string} meaning       // French text ("ce que ça représente")
 */

// data/missions.js -> App.missions.MISSION_RANKS
/**
 * @typedef {Object} MissionRank
 * @property {string} rank          // "D" | "C" | "B" | "A" | "S"
 * @property {number} defaultReward // default total Ryo reward
 * @property {number} min           // typical range minimum
 * @property {number|null} max      // typical range maximum, null = open-ended ("S: 1 000 000+")
 */

// runtime data, persisted via App.state/App.storage — not in data/ because it's
// user-generated, not catalogue content
/**
 * @typedef {Object} Profile
 * @property {string} id
 * @property {string} name
 * @property {"Genin"|"Chûnin"|"Jônin"} rank
 * @property {number} balance           // current Ryo
 * @property {InventoryEntry[]} inventory
 * @property {Transaction[]} history    // newest first
 */
/**
 * @typedef {Object} InventoryEntry
 * @property {string} itemId
 * @property {number} quantity
 */
/**
 * @typedef {Object} Transaction
 * @property {string} id
 * @property {number} timestamp         // Date.now()
 * @property {"purchase"|"resale"|"mission"|"adjustment"|"undo"} kind
 * @property {number} amount            // signed Ryo delta
 * @property {string} reason            // French description
 * @property {string} [itemId]          // set on "purchase" transactions only, so
 *                                       // undoLastPurchase() can find the exact one to
 *                                       // reverse without parsing `reason`
 * @property {number} [quantity]        // paired with itemId above
 */

// runtime data, persisted via App.state/App.storage — the GM-only mission journal
// (never shown on the player-facing profile view)
/**
 * @typedef {Object} MissionLogEntry
 * @property {string} id
 * @property {number} timestamp
 * @property {string} rank              // "D" | "C" | "B" | "A" | "S" | "Libre"
 * @property {number} gross
 * @property {number} villageCut
 * @property {number} net
 * @property {number} partySize
 * @property {boolean} leaderBonus
 * @property {number} shareEach
 * @property {number|null} leaderShare
 * @property {string[]} participantNames // denormalized name snapshot, survives renames/deletes
 * @property {string|null} leaderName
 */

// runtime data, held in js/state.js only — deliberately NOT persisted to localStorage
// (see section 5). A staging area for a purchase in progress, not durable data.
/**
 * @typedef {Object} CartLine
 * @property {string} itemId
 * @property {number} quantity
 */
```

## 5. localStorage keys and schema versioning

All keys are namespaced under the `shinobi-shop` prefix and carry the schema version,
so a future breaking change can migrate old data instead of silently misreading it:

```
shinobi-shop:schema-version          -> "1"                (a bare integer string, no JSON)
shinobi-shop:v1:profiles             -> JSON array of Profile
shinobi-shop:v1:active-profile-id    -> JSON string|null
shinobi-shop:v1:settings             -> JSON { gmMode: boolean, showHorsCommerce: boolean }
shinobi-shop:v1:mission-log          -> JSON array of MissionLogEntry (GM-only, newest first)
```

**Not persisted here:** the cart (see the `CartLine` typedef in section 4) lives only in
`js/state.js`'s in-memory `cart` variable — it deliberately has no `localStorage` key, so it
resets on every page reload instead of accumulating stale staged purchases.

**Migration strategy:** `js/storage.js` defines `SCHEMA_VERSION` as a constant. On load, it
compares the stored `schema-version` marker to that constant. If a future change needs to
reshape stored data (e.g. renaming a field), add a numbered migration step inside
`ensureSchemaVersion()` in `storage.js` that transforms the old-versioned keys into the
new-versioned ones, then bumps the marker. Because the versioned keys already embed `v{N}`,
old and new data can briefly coexist during a migration without collisions. There is only
one schema version so far (v1), so this function is currently a no-op stamp.

Every read in `storage.js` is wrapped in a try/catch that falls back to
`getDefaultAppState()` (or a piece of it) on any error — missing keys, corrupted JSON,
or `localStorage` being unavailable (e.g. private browsing) all degrade to a clean,
usable empty state rather than crashing.

## 6. Profile export/import (cross-device transfer)

A single profile can be downloaded as a standalone `.json` file and re-imported on another
device/browser, since `localStorage` never leaves the browser it was written in. This lives
in `js/profiles.js` (data/validation) and `js/views/profiles.js` (the download/upload UI) —
it is not a new persistence mechanism, just a portable snapshot of one `Profile` record.

```
shape of an exported file:
{
  "app": "boutique-shinobi",
  "exportVersion": 1,        // independent of the localStorage SCHEMA_VERSION —
                              // this only ever has to describe this file format
  "exportedAt": 1737225600000,
  "profile": { ...Profile, as defined in section 4... }
}
```

- **Export** (`App.profiles.exportProfile(profileId)`): returns the envelope above as a
  plain object; the view (`downloadProfile()` in `js/views/profiles.js`) turns it into a
  `Blob` and triggers a browser download via a temporary `<a download>` link. Filename is
  `boutique-shinobi-<slugified-name>.json`.
- **Import parsing** (`App.profiles.parseProfileExport(jsonText)`): never throws. It accepts
  either the full envelope or a bare profile object (in case a file gets hand-edited or
  re-saved without the wrapper), and sanitizes every field the same way `storage.js`
  sanitizes localStorage reads — missing/invalid `rank` falls back to the first rank option,
  a non-finite `balance` becomes `0`, malformed inventory/history entries are dropped rather
  than crashing the import. Treat any uploaded file as untrusted input.
- **Import commit** (`App.profiles.importProfile(profile, strategy)`): if no profile with
  that id exists locally, it's added outright (this is the common case: first import on a
  fresh device). If one already exists, it refuses with `{conflict: true}` instead of
  guessing — the view shows a modal asking the player to **replace** (overwrite the local
  copy with the imported one, keeping the same id) or **duplicate** (import as a new profile
  with a freshly generated id), then re-calls `importProfile` with that explicit strategy.

## 7. Conventions

- **Module boundaries:** `js/storage.js` ↔ localStorage only. `js/state.js` ↔
  `App.storage` only (holds the in-memory copy + pub/sub). `js/profiles.js` and
  `js/economy.js` mutate state through `App.state`'s setters — they never call
  `App.storage` directly. `js/views/*.js` and `js/components/*.js` never read
  `App.storage` and never touch `localStorage`, and never mutate a profile object
  directly — they call `App.profiles` / `App.economy` functions.
- **Why views never write to localStorage directly:** it would let two code paths
  (a view, and profiles.js/economy.js) both decide what "a valid mutation" looks like,
  which is how balances or inventories drift out of sync. Centralizing every mutation in
  `App.economy` (money/inventory) and `App.profiles` (profile CRUD) means there is exactly
  one place that enforces invariants like "balance can't go negative" or "can't resell more
  than you own."
- **`data/` vs `js/`:** `data/` holds static, hand-authored catalogue content extracted
  from the rulebook/shop supplement — plain arrays/objects and constants, no functions that
  read state or touch the DOM. `js/` holds all behavior: state, persistence, business logic,
  and UI.
- **Naming:** files and identifiers in English; kebab-case for filenames, camelCase for
  functions/variables and for the `App.*` namespace keys, SCREAMING_SNAKE_CASE for
  module-level constants. All user-facing strings (labels, messages, catalogue text) are
  French literals inline where they're used or in `data/`.
- **Public API per file:** every file exposes a small, explicit object on `App` (e.g.
  `App.economy = { purchaseItem, resellItem, ... }`) at the very end of its IIFE. Everything
  else declared inside the IIFE is private to that file. Every publicly-exposed function has
  a JSDoc comment describing params/return.
- **No stray globals:** the only thing attached to `window` is the single `App` namespace
  object (see section 2 for why). No file assigns anything else to `window` or leaves a
  bare `var`/`let`/`function` at script scope — everything lives inside that file's IIFE.

## 8. How to add a new item

1. Open `data/items.js` and add an object to the `ITEMS` array (inside the IIFE, before
   `App.items = { ITEMS, CATEGORY_LABELS };`) following the `Item` typedef at the top of
   the file. Pick a kebab-case `id` that doesn't collide with an existing one.
2. If it belongs to a new catalogue section, add the letter to `CATEGORY_LABELS` first.
3. If price or rarity genuinely varies by named tier (like the storage scrolls' Petit/Moyen/Grand),
   add one item entry per tier rather than encoding a range — see the existing
   `parchemin-scellement-*` or `tenue-camouflage-*` entries for the pattern. Reserve
   `price: {min, max}` for cases with no discrete named tiers (e.g. `antidote-specifique`).
4. Set `purchasable: false` for hors-commerce/non-vendu items, and `gmOnly: true` for
   restricted-substance (section F) or plot items (section J) — nothing else needs
   changing; the shop/item-detail views already gate on these two flags.
5. If the catalogue gives the item a bulk-pack discount (a "X /u · Y la volée de N" style
   price), add `bulk: { quantity: N, price: Y }`. `economy.js`'s `getItemTotalPrice()`
   picks this up automatically — it applies the pack price for every full pack in the
   purchased quantity and unit price for the remainder, so nothing else needs to change
   for the discount to work in the shop and item detail views.
6. No other file needs to change — the shop grid, filters, item detail view and inventory
   view all read from `App.items.ITEMS` directly.

## 9. How to add a new view

1. Create `js/views/my-view.js` following the same IIFE pattern as the others:
   ```js
   (function () {
     "use strict";
     window.App = window.App || {};
     const { /* whatever App.* getters/mutators you need */ } = App.state;
     const { h, clearElement } = App.dom;

     function renderMyView(container) {
       // clear and rebuild container's contents from current state,
       // wire interactions to App.profiles / App.economy mutators,
       // call App.state.subscribe(...) and return its unsubscribe function
       // if this view needs to react to state changes made elsewhere.
     }

     App.myView = { renderMyView };
   })();
   ```
2. Add `<script src="js/views/my-view.js"></script>` to `index.html`, placed after every
   script it depends on (see section 2's dependency chain) and before `js/router.js`.
3. In `js/main.js`, add `registerRoute("/my-path", () => renderMyView(view()))` (or
   `(params) => renderMyView(view(), params.foo)` for a route with a `:foo` segment),
   using `const { renderMyView } = App.myView;` at the top of `main.js`'s IIFE like the
   other views.
4. If it should appear in the top navigation, add `{ path: "/my-path", label: "…" }` to
   `NAV_ITEMS` in `main.js`.
5. Reuse `App.itemCard` / `App.starRating` / `App.modal` / `App.filters` instead of
   duplicating markup; add a new component only if the UI piece is used in 2+ views.

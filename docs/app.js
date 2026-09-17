const el = (id) => document.getElementById(id);

const nf = new Intl.NumberFormat("es-ES", { maximumFractionDigits: 0 });
const euro = (value) => (value == null ? "—" : `${nf.format(Math.round(value))} €`);
const num = (value) => (value == null ? "—" : nf.format(value));

const relative = (iso) => {
  if (!iso) return "—";
  const days = Math.floor((Date.now() - new Date(iso)) / 86400000);
  if (days <= 0) return "hoy";
  if (days === 1) return "ayer";
  if (days < 30) return `hace ${days} días`;
  const months = Math.round(days / 30);
  return months < 12 ? `hace ${months} meses` : `hace ${Math.round(days / 365)} años`;
};

const escapeHtml = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/* ── Icons (small inline SVGs, no emoji) ─────────────────── */
const ICON_PATHS = {
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
  moon: '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>',
  plusCircle: '<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>',
  bank: '<path d="M3 10 12 4l9 6"/><path d="M4 10v9M9.5 10v9M14.5 10v9M20 10v9"/><path d="M2 21h20"/>',
  tag: '<path d="M20.6 12.3 12.7 20.2a2 2 0 0 1-2.8 0l-6-6a2 2 0 0 1 0-2.8L11.7 3.4A2 2 0 0 1 13.1 2.8L19 3a1 1 0 0 1 1 1l.2 5.9a2 2 0 0 1-.6 1.4z"/><circle cx="15.5" cy="7.5" r="1.4" fill="currentColor" stroke="none"/>',
  house: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-3.8-3.8"/>',
  alertTriangle: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h16.9a2 2 0 0 0 1.7-3L13.6 3.9a2 2 0 0 0-3.3 0z"/><path d="M12 9v4M12 17h.01"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
  pin: '<path d="M12 22s7-7.4 7-12.5A7 7 0 0 0 5 9.5C5 14.6 12 22 12 22z"/><circle cx="12" cy="9.5" r="2.3"/>',
  trendingUp: '<polyline points="3 17 9.5 10.5 13.5 14.5 21 6"/><polyline points="21 12 21 6 15 6"/>',
  trendingDown: '<polyline points="3 7 9.5 13.5 13.5 9.5 21 18"/><polyline points="21 12 21 18 15 18"/>',
  arrowDown: '<path d="M12 5v14"/><path d="M19 12l-7 7-7-7"/>',
  checkCircle: '<path d="M22 11.1V12a10 10 0 1 1-5.9-9.1"/><path d="M22 4 12 14 9 11"/>',
  play: '<polygon points="6 3 20 12 6 21 6 3"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><circle cx="12" cy="8" r="0.9" fill="currentColor" stroke="none"/>',
  radar: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><path d="M12 12 17.3 7.9"/><circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none"/>',
};

function icon(name, size = 14) {
  return `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[name]}</svg>`;
}

function noPhotoHtml() {
  return `<div class="no-photo">${icon("house", 28)}</div>`;
}

function toast(message, kind = "") {
  const node = document.createElement("div");
  node.className = `toast ${kind}`;
  node.textContent = message;
  el("toasts").append(node);
  setTimeout(() => node.remove(), 4200);
}

/* ── This place, mirrored from app/locations.py ────────────────────────
   Keep in sync by hand: there is no backend here to serve it fresh. ── */
const CATALOGUE = {
  "Madrid capital": {
    slugs: { idealista: "madrid-madrid", fotocasa: "madrid-capital", pisos: "madrid_capital", servihabitat: "madrid" },
    center: "40.4168,-3.7038",
  },
  "Barcelona capital": {
    slugs: {
      idealista: "barcelona-barcelona",
      fotocasa: "barcelona-capital",
      pisos: "barcelona_capital",
      servihabitat: "barcelona",
    },
    center: "41.3874,2.1686",
  },
  "Valencia capital": {
    slugs: {
      idealista: "valencia-valencia",
      fotocasa: "valencia-capital",
      pisos: "valencia_capital",
      servihabitat: "valencia",
    },
    center: "39.4699,-0.3763",
  },
  "Sevilla capital": {
    slugs: {
      idealista: "sevilla-sevilla",
      fotocasa: "sevilla-capital",
      pisos: "sevilla_capital",
      servihabitat: "sevilla",
    },
    center: "37.3891,-5.9845",
  },
  "Zaragoza capital": {
    slugs: {
      idealista: "zaragoza-zaragoza",
      fotocasa: "zaragoza-capital",
      pisos: "zaragoza_capital",
      servihabitat: "zaragoza",
    },
    center: "41.6488,-0.8891",
  },
  "Málaga capital": {
    slugs: {
      idealista: "malaga-malaga",
      fotocasa: "malaga-capital",
      pisos: "malaga_capital",
      servihabitat: "malaga",
    },
    center: "36.7213,-4.4214",
  },
};
const PORTALS = ["idealista", "fotocasa", "pisos", "servihabitat"];

/* ── GitHub as the backend for reads ─────────────────────────────────────
   Browsing (Resultados, Ejecuciones, the list of saved searches) only ever
   does plain unauthenticated reads — GitHub allows that for a public repo,
   so no visitor is asked for anything just to look. */
const GH_OWNER = "gonzalogmb";
const GH_REPO = "house-radar";
const GH_WORKFLOW = "daily-scrape.yml";
const GH_API = "https://api.github.com";
const GH_HEADERS = { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };

/** Plain read — no auth, works for anyone on a public repo. */
async function ghRead(path) {
  return fetch(`${GH_API}${path}`, { headers: GH_HEADERS });
}

function base64ToUtf8(b64) {
  return new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
}

async function readSearchesFile() {
  const response = await ghRead(`/repos/${GH_OWNER}/${GH_REPO}/contents/site/searches.json?ref=main`);
  if (!response.ok) throw new Error(`No se pudo leer site/searches.json (HTTP ${response.status})`);
  const data = await response.json();
  return { sha: data.sha, searches: JSON.parse(base64ToUtf8(data.content)) };
}

/* ── Login with GitHub + the Worker for writes ──────────────────────────
   Every write (save/delete a search, launch a scrape) goes through a small
   Cloudflare Worker instead of straight to GitHub. The Worker holds the
   real GitHub token (GITHUB_TOKEN, write access to this repo) as a
   server-side secret that never reaches this page.
   Signing in gets the browser a MUCH weaker credential instead: a GitHub
   OAuth access token scoped to `read:user`, which can't write anything.
   Getting it takes a real redirect to github.com and back (the code->token
   exchange needs a client secret, which is why the Worker does it, not this
   page). On every write, the Worker calls GitHub's own /user endpoint with
   that token to check the login is exactly ALLOWED_LOGIN before it reaches
   for its own secret. A visitor who isn't signed in as that account gets
   nothing: the client-side check below is just a friendlier error message,
   not the actual gate. */
const WORKER_URL = "https://house-radar-gate.gonzalogmb.workers.dev";
const GH_OAUTH_CLIENT_ID = "Iv23li70wXElgGvynH3v"; // must match cf-worker/wrangler.toml
const SESSION_KEY = "hr-gh-session";
const OAUTH_STATE_KEY = "hr-gh-oauth-state";

let currentSession = null; // { access_token, login }
try {
  currentSession = JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null");
} catch {
  /* private mode: just start signed out */
}

function showSignedIn(session) {
  el("auth-login").textContent = session.login;
  el("auth-signed-out").classList.add("hidden");
  el("auth-signed-in").classList.remove("hidden");
}

function beginSignIn() {
  const state = crypto.randomUUID();
  try {
    sessionStorage.setItem(OAUTH_STATE_KEY, state);
  } catch {
    /* if this fails, the callback below will too and just show an error */
  }
  const redirectUri = `${location.origin}${location.pathname}`;
  const params = new URLSearchParams({
    client_id: GH_OAUTH_CLIENT_ID,
    scope: "read:user",
    redirect_uri: redirectUri,
    state,
  });
  location.href = `https://github.com/login/oauth/authorize?${params}`;
}

async function finishSignIn(code, state) {
  let expectedState = null;
  try {
    expectedState = sessionStorage.getItem(OAUTH_STATE_KEY);
    sessionStorage.removeItem(OAUTH_STATE_KEY);
  } catch {
    /* ignore */
  }
  if (!expectedState || state !== expectedState) {
    toast("Inicio de sesión inválido (state no coincide) — inténtalo de nuevo.", "error");
    return;
  }
  try {
    const data = await workerRequest("/auth/callback", { code });
    currentSession = { access_token: data.access_token, login: data.login };
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(currentSession));
    } catch {
      /* still works for the rest of this page load even if it can't persist */
    }
    showSignedIn(currentSession);
    showTab("searches");
  } catch (error) {
    toast(`No se pudo iniciar sesión: ${error.message}`, "error");
  }
}

function signOut() {
  currentSession = null;
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
  el("auth-signed-in").classList.add("hidden");
  el("auth-signed-out").classList.remove("hidden");
}

el("github-signin-button").addEventListener("click", beginSignIn);
el("auth-signout").addEventListener("click", signOut);
if (currentSession) showSignedIn(currentSession);

function requireSignIn() {
  if (!currentSession) throw new Error("Inicia sesión con GitHub primero.");
  return currentSession.access_token;
}

async function workerRequest(path, body) {
  const response = await fetch(`${WORKER_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

async function dispatchWorkflow(searchName) {
  const credential = requireSignIn();
  await workerRequest("/dispatch", { credential, search_name: searchName || undefined });
}

async function addSearch(search) {
  const credential = requireSignIn();
  await workerRequest("/searches/add", { credential, search });
}

async function deleteSearch(name) {
  const credential = requireSignIn();
  await workerRequest("/searches/delete", { credential, name });
}

async function readWorkflowRuns() {
  const response = await ghRead(`/repos/${GH_OWNER}/${GH_REPO}/actions/workflows/${GH_WORKFLOW}/runs?per_page=15`);
  if (!response.ok) throw new Error(`No se pudo leer el historial (HTTP ${response.status})`);
  const data = await response.json();
  return data.workflow_runs;
}

/* ── Theme (same convention as the live app, separate storage key) ────── */
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  el("theme-toggle").innerHTML = theme === "light" ? icon("sun", 16) : icon("moon", 16);
  try {
    localStorage.setItem("hr-demo-theme", theme);
  } catch {
    /* private mode: the choice just won't stick */
  }
}

let storedTheme = "light";
try {
  storedTheme = localStorage.getItem("hr-demo-theme") || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
} catch {
  /* ignore */
}
applyTheme(storedTheme);
el("theme-toggle").addEventListener("click", () =>
  applyTheme(document.documentElement.dataset.theme === "light" ? "dark" : "light"),
);

/* ── Multi-select dropdown (grouped checkboxes, e.g. barrio by distrito) ── */
function createMultiSelect(root, { emptyLabel, onChange }) {
  const trigger = root.querySelector(".msel-trigger");
  const panel = root.querySelector(".msel-panel");
  const search = root.querySelector(".msel-search");
  const groupsEl = root.querySelector(".msel-groups");
  const clearBtn = root.querySelector('[data-action="clear"]');
  let groups = [];
  const selected = new Set();

  function renderOptions() {
    const term = search.value.trim().toLowerCase();
    const html = groups
      .map((group) => {
        const items = group.items.filter((item) => !term || item.label.toLowerCase().includes(term));
        if (!items.length) return "";
        return (
          `<div class="msel-group-label">${escapeHtml(group.group)}</div>` +
          items
            .map(
              (item) => `<label class="msel-option">
                <input type="checkbox" value="${escapeHtml(item.value)}" ${selected.has(item.value) ? "checked" : ""} />
                <span>${escapeHtml(item.label)}</span>
                <span class="muted">${item.count}</span>
              </label>`,
            )
            .join("")
        );
      })
      .join("");
    groupsEl.innerHTML = html || '<div class="msel-empty">Sin resultados</div>';
  }

  function renderTrigger() {
    if (!selected.size) {
      trigger.textContent = emptyLabel;
      return;
    }
    if (selected.size === 1) {
      const value = [...selected][0];
      const found = groups.flatMap((g) => g.items).find((i) => i.value === value);
      trigger.textContent = found ? found.label : value;
      return;
    }
    trigger.innerHTML = `Varios barrios <span class="count-badge">${selected.size}</span>`;
  }

  trigger.addEventListener("click", (event) => {
    event.stopPropagation();
    panel.classList.toggle("hidden");
    if (!panel.classList.contains("hidden")) search.focus();
  });

  document.addEventListener("click", (event) => {
    if (!root.contains(event.target)) panel.classList.add("hidden");
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") panel.classList.add("hidden");
  });

  search.addEventListener("input", renderOptions);

  groupsEl.addEventListener("change", (event) => {
    const checkbox = event.target.closest('input[type="checkbox"]');
    if (!checkbox) return;
    if (checkbox.checked) selected.add(checkbox.value);
    else selected.delete(checkbox.value);
    renderTrigger();
    onChange([...selected]);
  });

  clearBtn.addEventListener("click", () => {
    selected.clear();
    renderOptions();
    renderTrigger();
    onChange([...selected]);
  });

  return {
    setGroups(newGroups) {
      groups = newGroups;
      const known = new Set(groups.flatMap((g) => g.items.map((i) => i.value)));
      [...selected].forEach((value) => {
        if (!known.has(value)) selected.delete(value);
      });
      renderOptions();
      renderTrigger();
    },
    getSelected: () => [...selected],
  };
}

/** Fotocasa gives a bare number, idealista/pisos.com a phrase like "4ª planta exterior". */
function floorLabel(floor) {
  if (floor == null || floor === "") return null;
  const text = String(floor);
  if (!/^\d+$/.test(text)) return text.slice(0, 26);
  return text === "0" ? "bajo" : `planta ${text}`;
}

/* ── Data (Resultados tab) ──────────────────────────────────────────── */
const state = { data: null, quick: "all", ascending: false, operation: "venta", view: "grid" };

/* ── Map view (Leaflet, OpenStreetMap tiles — no API key) ────────────── */
let map = null;
let markerLayer = null;

function ensureMap() {
  if (map) return map;
  map = L.map("listings-map", { scrollWheelZoom: true }).setView([40.4168, -3.7038], 12);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
  }).addTo(map);
  markerLayer = L.markerClusterGroup({ maxClusterRadius: 45 });
  markerLayer.addTo(map);
  return map;
}

function mapPopupHtml(item) {
  const zone = [item.neighborhood, item.district, item.city].filter(Boolean)[0];
  return `<div class="map-popup">
    ${item.thumbnail ? `<img src="${escapeHtml(item.thumbnail)}" alt="" loading="lazy" />` : ""}
    <div class="price-row">
      <span class="price">${euro(item.price)}</span>
      ${item.price_per_m2 ? `<span class="ppm">${num(item.price_per_m2)} €/m²</span>` : ""}
    </div>
    <a href="${escapeHtml(item.url)}" target="_blank" rel="noopener">${escapeHtml(item.title ?? item.listing_id)}</a>
    <div class="specs">
      ${item.rooms ? `${item.rooms} hab · ` : ""}${item.surface_m2 ? `${num(item.surface_m2)} m²` : ""}
    </div>
    ${zone ? `<div class="specs">${escapeHtml(zone)}</div>` : ""}
  </div>`;
}

function renderMap(items) {
  ensureMap();
  requestAnimationFrame(() => map.invalidateSize());

  const withCoords = items.filter((i) => i.latitude != null && i.longitude != null);
  markerLayer.clearLayers();
  withCoords.forEach((item) => {
    L.marker([item.latitude, item.longitude]).bindPopup(mapPopupHtml(item)).addTo(markerLayer);
  });

  const note = el("map-note");
  note.classList.remove("hidden");
  note.textContent = items.length
    ? `${nf.format(withCoords.length)} de ${nf.format(items.length)} anuncios tienen ubicación exacta (por ahora solo Fotocasa la da) y se ven en el mapa.`
    : "";

  if (withCoords.length) {
    map.fitBounds(withCoords.map((i) => [i.latitude, i.longitude]), { padding: [30, 30], maxZoom: 16 });
  }
}

el("view-toggle").addEventListener("click", (event) => {
  const button = event.target.closest(".seg");
  if (!button || button.classList.contains("active")) return;
  state.view = button.dataset.view;
  el("view-toggle")
    .querySelectorAll(".seg")
    .forEach((seg) => seg.classList.toggle("active", seg === button));
  renderListings();
});

async function loadData() {
  const response = await fetch("data.json", { cache: "no-store" });
  if (!response.ok) throw new Error(`data.json: HTTP ${response.status}`);
  state.data = await response.json();
}

function renderMeta() {
  const portals = Object.keys(state.data.by_portal || {});
  el("meta-line").textContent =
    `${portals.join(", ") || "sin datos"} · actualizado ${relative(state.data.generated_at)} ` +
    `(${(state.data.generated_at || "").slice(0, 16).replace("T", " ")} UTC)`;
}

function renderKpis() {
  const d = state.data;
  const cards = [
    { value: num(d.total_listings), label: "anuncios seguidos" },
    { value: num(d.new_listings), label: "nuevos en la última pasada", cls: "accent" },
    { value: num(d.price_drops), label: "con bajada de precio", cls: "ok" },
    { value: num(d.sareb_listings), label: "de la Sareb", cls: "sareb" },
    { value: num(d.bargains), label: "chollos (≥15% bajo su barrio)", cls: "bargain" },
    { value: euro(d.median_price), label: "precio mediano" },
    { value: d.median_price_per_m2 ? `${num(d.median_price_per_m2)} €/m²` : "—", label: "mediana por m²" },
    { value: relative(d.last_scrape), label: "última captura" },
  ];
  el("kpis").innerHTML = cards
    .map(
      (card) =>
        `<div class="kpi ${card.cls ?? ""}"><div class="kpi-value">${card.value}</div><div class="kpi-label">${card.label}</div></div>`,
    )
    .join("");
}

const neighborhoodSelect = createMultiSelect(el("f-neighborhood"), {
  emptyLabel: "Todos los barrios",
  onChange: renderListings,
});

function renderFilterOptions() {
  const portals = [...new Set(state.data.listings.map((item) => item.portal))].sort();
  el("f-portal").innerHTML = '<option value="">Todos</option>' + portals.map((p) => `<option value="${p}">${p}</option>`).join("");

  const groups = new Map();
  (state.data.facets?.neighborhoods ?? []).forEach((facet) => {
    if (!groups.has(facet.group)) groups.set(facet.group, []);
    groups.get(facet.group).push({ value: facet.neighborhood, label: facet.neighborhood, count: facet.count });
  });
  neighborhoodSelect.setGroups([...groups.entries()].map(([group, items]) => ({ group, items })));
}

function listingCard(item) {
  const badges = [];
  if (item.is_new) badges.push(`<span class="badge new">${icon("plusCircle", 12)}Nuevo</span>`);
  if (item.price_delta < 0) badges.push(`<span class="badge drop">${icon("trendingDown", 12)}${euro(Math.abs(item.price_delta))}</span>`);
  if (item.price_delta > 0) badges.push(`<span class="badge rise">${icon("trendingUp", 12)}${euro(item.price_delta)}</span>`);
  if (item.is_sareb) badges.push(`<span class="badge sareb">${icon("bank", 12)}Sareb</span>`);
  if (item.is_bargain) badges.push(`<span class="badge bargain">${icon("tag", 12)}${item.price_vs_median_pct}% vs. barrio</span>`);

  const zone = [item.neighborhood, item.district, item.city].filter(Boolean)[0];
  const floor = floorLabel(item.floor);
  const media = item.thumbnail
    ? `<img data-thumb src="${escapeHtml(item.thumbnail)}" alt="" loading="lazy" />`
    : noPhotoHtml();

  return `<article class="listing">
    <div class="listing-media">
      ${media}
      <div class="media-badges">${badges.join("")}</div>
      <span class="badge media-portal">${item.portal}</span>
    </div>
    <div class="listing-body">
      <div class="price-row">
        <span class="price">${euro(item.price)}</span>
        ${item.previous_price && item.previous_price > item.price ? `<span class="price-old">${euro(item.previous_price)}</span>` : ""}
        <span class="ppm">${item.price_per_m2 ? `${num(item.price_per_m2)} €/m²` : ""}</span>
      </div>
      <a class="listing-title" href="${escapeHtml(item.url)}" target="_blank" rel="noopener">${escapeHtml(item.title ?? item.listing_id)}</a>
      <div class="specs">
        ${item.rooms ? `<span><b>${item.rooms}</b> hab</span>` : ""}
        ${item.surface_m2 ? `<span><b>${num(item.surface_m2)}</b> m²</span>` : ""}
        ${floor ? `<span>${escapeHtml(floor)}</span>` : ""}
      </div>
      ${zone ? `<div class="specs">${icon("pin", 12)}${escapeHtml(zone)}</div>` : ""}
      <div class="listing-foot">
        <span>${escapeHtml((item.advertiser_name ?? item.advertiser_type ?? "").slice(0, 26)) || "—"}</span>
        <span>${item.snapshots > 1 ? `${item.snapshots} capturas` : relative(item.first_seen)}</span>
      </div>
    </div>
  </article>`;
}

function renderListings() {
  if (!state.data) return;
  const grid = el("listings-grid");
  let items = [...state.data.listings];

  const portal = el("f-portal").value;
  const neighborhoods = neighborhoodSelect.getSelected();
  const maxPrice = Number(el("f-max-price").value) || null;
  const minRooms = Number(el("f-min-rooms").value) || null;
  const minSurface = Number(el("f-min-surface").value) || null;
  const order = el("f-order").value;

  const total = items.length;
  if (portal) items = items.filter((i) => i.portal === portal);
  if (neighborhoods.length) items = items.filter((i) => neighborhoods.includes(i.neighborhood));
  if (maxPrice) items = items.filter((i) => i.price != null && i.price <= maxPrice);
  if (minRooms) items = items.filter((i) => i.rooms != null && i.rooms >= minRooms);
  if (minSurface) items = items.filter((i) => i.surface_m2 != null && i.surface_m2 >= minSurface);
  if (state.quick === "new") items = items.filter((i) => i.is_new);
  if (state.quick === "drops") items = items.filter((i) => i.price_delta < 0);
  if (state.quick === "sareb") items = items.filter((i) => i.is_sareb);
  if (state.quick === "bargain") items = items.filter((i) => i.is_bargain);

  const matched = items.length;
  items.sort((a, b) => {
    const av = a[order];
    const bv = b[order];
    if (av == null) return 1;
    if (bv == null) return -1;
    return av > bv ? 1 : av < bv ? -1 : 0;
  });
  if (!state.ascending) items.reverse();

  const shown = state.view === "map" ? items.length : Math.min(items.length, 200);
  el("listings-count").textContent = total ? `${nf.format(matched)} de ${nf.format(total)} anuncios · mostrando ${nf.format(shown)}` : "";

  if (state.view === "map") {
    grid.classList.add("hidden");
    el("listings-map").classList.remove("hidden");
    if (!items.length) {
      el("map-note").classList.remove("hidden");
      el("map-note").textContent = total ? "Ningún anuncio pasa el filtro." : "Todavía no hay datos.";
      if (map) markerLayer.clearLayers();
      return;
    }
    renderMap(items);
    return;
  }

  el("listings-map").classList.add("hidden");
  el("map-note").classList.add("hidden");
  grid.classList.remove("hidden");
  items = items.slice(0, 200);

  if (!items.length) {
    grid.innerHTML = `<div class="empty" style="grid-column:1/-1">
      <div class="empty-icon">${icon("search", 26)}</div>
      <div class="empty-title">${total ? "Ningún anuncio pasa el filtro" : "Todavía no hay datos"}</div>
      <div class="tiny">${total ? "Prueba a relajar los filtros." : "El primer run diario aún no se ha ejecutado."}</div>
    </div>`;
    return;
  }
  grid.innerHTML = items.map(listingCard).join("");
  grid.querySelectorAll("[data-thumb]").forEach((img) =>
    img.addEventListener("error", () => { img.outerHTML = noPhotoHtml(); }, { once: true }),
  );
}

el("quick-filters").addEventListener("click", (event) => {
  const chip = event.target.closest(".chip");
  if (!chip) return;
  state.quick = chip.dataset.quick;
  el("quick-filters")
    .querySelectorAll(".chip")
    .forEach((c) => c.setAttribute("aria-pressed", String(c === chip)));
  renderListings();
});

el("sort-dir").addEventListener("click", () => {
  state.ascending = !state.ascending;
  el("sort-dir").classList.toggle("asc", state.ascending);
  renderListings();
});

["f-portal", "f-max-price", "f-min-rooms", "f-min-surface", "f-order"].forEach((id) =>
  el(id).addEventListener("change", renderListings),
);

/* ── Búsquedas tab ──────────────────────────────────────────────────── */
el("location-select").innerHTML = Object.keys(CATALOGUE)
  .map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`)
  .join("");

el("portals-field").innerHTML = PORTALS.map(
  (portal) => `<button type="button" class="chip" data-portal="${portal}" aria-pressed="true">${portal}</button>`,
).join("");
el("portals-field")
  .querySelectorAll("[data-portal]")
  .forEach((chip) =>
    chip.addEventListener("click", () =>
      chip.setAttribute("aria-pressed", chip.getAttribute("aria-pressed") === "true" ? "false" : "true"),
    ),
  );

el("operation-toggle").addEventListener("click", (event) => {
  const button = event.target.closest(".seg");
  if (!button) return;
  state.operation = button.dataset.value;
  el("operation-toggle")
    .querySelectorAll(".seg")
    .forEach((seg) => seg.classList.toggle("active", seg === button));
});

function readSearchForm() {
  const form = el("search-form");
  const data = new FormData(form);
  const number = (key) => (data.get(key) ? Number(data.get(key)) : null);
  const locationName = data.get("location");
  const portals = [...el("portals-field").querySelectorAll('[aria-pressed="true"]')].map((c) => c.dataset.portal);
  if (!portals.length) throw new Error("Selecciona al menos un portal");

  const location = CATALOGUE[locationName];
  return {
    name: data.get("name") || locationName,
    criteria: {
      location_name: locationName,
      location_slugs: Object.fromEntries(portals.map((p) => [p, location.slugs[p]]).filter(([, slug]) => slug)),
      center: location.center,
      operation: state.operation,
      portals,
      min_price: number("min_price"),
      max_price: number("max_price"),
      min_rooms: number("min_rooms"),
      min_surface: number("min_surface"),
      max_pages: number("max_pages"),
    },
  };
}

el("search-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const submitBtn = event.target.querySelector('button[type="submit"]');
  try {
    const payload = readSearchForm();
    submitBtn.disabled = true;
    await addSearch(payload);
    toast(`Búsqueda "${payload.name}" guardada`, "success");
    event.target.reset();
    renderSearches();
  } catch (error) {
    toast(`No se pudo guardar: ${error.message}`, "error");
  } finally {
    submitBtn.disabled = false;
  }
});

el("run-all").addEventListener("click", async () => {
  const button = el("run-all");
  button.disabled = true;
  try {
    await dispatchWorkflow(null);
    toast("Scraping lanzado para todas las búsquedas — tardará 1-2 min.", "success");
  } catch (error) {
    toast(error.message, "error");
  } finally {
    button.disabled = false;
  }
});

async function renderSearches() {
  const container = el("searches-list");
  let searches;
  try {
    ({ searches } = await readSearchesFile());
  } catch (error) {
    container.innerHTML = `<div class="empty"><div class="empty-icon">${icon("alertTriangle", 26)}</div>
      <div class="empty-title">No se pudo leer site/searches.json</div>
      <div class="tiny">${escapeHtml(error.message)}</div></div>`;
    return;
  }

  if (!searches.length) {
    container.innerHTML = `<div class="empty"><div class="empty-icon">${icon("search", 26)}</div>
      <div class="empty-title">Sin búsquedas guardadas</div>
      <div class="tiny">Rellena el formulario y guárdala: entrará en el run diario.</div></div>`;
    return;
  }

  container.innerHTML = searches
    .map((search) => {
      const c = search.criteria;
      const bits = [
        c.operation === "venta" ? "compra" : "alquiler",
        c.min_price ? `desde ${euro(c.min_price)}` : null,
        c.max_price ? `hasta ${euro(c.max_price)}` : null,
        c.min_rooms ? `${c.min_rooms}+ hab` : null,
        c.min_surface ? `${c.min_surface}+ m²` : null,
      ].filter(Boolean);
      return `<div class="saved">
        <div class="saved-main">
          <span class="saved-name">${escapeHtml(search.name)}</span>
          <span class="saved-meta">${escapeHtml(c.location_name)} · ${bits.join(" · ")}</span>
          <span class="saved-meta">${c.portals.join(", ")}</span>
        </div>
        <div class="actions">
          <button class="btn primary small" data-run="${escapeHtml(search.name)}">Lanzar</button>
          <button class="btn danger small ghost" data-delete="${escapeHtml(search.name)}">Borrar</button>
        </div>
      </div>`;
    })
    .join("");

  container.querySelectorAll("[data-run]").forEach((button) =>
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        await dispatchWorkflow(button.dataset.run);
        toast(`Scraping lanzado para "${button.dataset.run}" — tardará 1-2 min.`, "success");
      } catch (error) {
        toast(error.message, "error");
      } finally {
        button.disabled = false;
      }
    }),
  );

  container.querySelectorAll("[data-delete]").forEach((button) =>
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        await deleteSearch(button.dataset.delete);
        toast("Búsqueda borrada", "success");
        renderSearches();
      } catch (error) {
        toast(error.message, "error");
        button.disabled = false;
      }
    }),
  );
}

/* ── Ejecuciones tab ────────────────────────────────────────────────── */
const RUN_LABELS = { queued: "en cola", in_progress: "en curso", completed: "terminado" };
let runsPollTimer = null;

async function renderRuns() {
  const container = el("runs-list");
  let runs;
  try {
    runs = await readWorkflowRuns();
  } catch (error) {
    container.innerHTML = `<div class="empty"><div class="empty-icon">${icon("alertTriangle", 26)}</div>
      <div class="empty-title">No se pudo leer el historial</div>
      <div class="tiny">${escapeHtml(error.message)}</div></div>`;
    return;
  }

  if (!runs.length) {
    container.innerHTML = `<div class="empty"><div class="empty-icon">${icon("clock", 26)}</div>
      <div class="empty-title">Nada ejecutado todavía</div></div>`;
    return;
  }

  container.innerHTML = runs
    .map((run) => {
      const isDone = run.status === "completed";
      const badgeClass = !isDone ? "running" : run.conclusion === "success" ? "done" : "failed";
      const label = !isDone ? RUN_LABELS[run.status] ?? run.status : run.conclusion === "success" ? "ok" : "error";
      return `<div class="run">
        <div class="run-head">
          <span class="run-name">${run.event === "schedule" ? "Run diario" : "Lanzamiento manual"} #${run.run_number}</span>
          <span class="badge ${badgeClass}">${label}</span>
          <span class="muted tiny">${(run.created_at || "").replace("T", " ").slice(0, 16)} UTC</span>
        </div>
        <a class="link-btn" href="${run.html_url}" target="_blank" rel="noopener">Ver en GitHub →</a>
      </div>`;
    })
    .join("");

  clearTimeout(runsPollTimer);
  if (runs.some((run) => run.status !== "completed")) {
    runsPollTimer = setTimeout(renderRuns, 8000);
  }
}

/* ── Tabs ───────────────────────────────────────────────────────────── */
function showTab(name) {
  document.querySelectorAll(".seg[data-tab]").forEach((tab) => tab.classList.toggle("active", tab.dataset.tab === name));
  document.querySelectorAll(".panel").forEach((panel) => panel.classList.toggle("hidden", panel.id !== `tab-${name}`));
  if (name === "listings") renderListings();
  if (name === "searches") renderSearches();
  if (name === "runs") renderRuns();
  else clearTimeout(runsPollTimer);
}

document
  .querySelectorAll(".seg[data-tab]")
  .forEach((tab) => tab.addEventListener("click", () => showTab(tab.dataset.tab)));

loadData()
  .then(() => {
    renderMeta();
    renderKpis();
    renderFilterOptions();
    renderListings();
  })
  .catch((error) => {
    el("meta-line").textContent = `Error cargando datos: ${error.message}`;
    el("listings-grid").innerHTML = `<div class="empty" style="grid-column:1/-1">
      <div class="empty-icon">${icon("alertTriangle", 26)}</div>
      <div class="empty-title">No se pudo cargar data.json</div>
      <div class="tiny">Puede que el primer run de GitHub Actions todavía no se haya ejecutado.</div>
    </div>`;
  });

/* If we just landed back here from GitHub's login redirect, finish signing in
   and strip ?code=&state= from the address bar either way. */
{
  const params = new URLSearchParams(location.search);
  const code = params.get("code");
  const state = params.get("state");
  if (code && state) {
    history.replaceState(null, "", location.pathname);
    finishSignIn(code, state);
  }
}

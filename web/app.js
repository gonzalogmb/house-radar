const el = (id) => document.getElementById(id);

const api = async (path, options = {}) => {
  const response = await fetch(path, { headers: { "Content-Type": "application/json" }, ...options });
  if (!response.ok) throw new Error((await response.text()).slice(0, 200));
  return response.json();
};

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
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  radar: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><path d="M12 12 17.3 7.9"/><circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none"/>',
};

function icon(name, size = 14) {
  return `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[name]}</svg>`;
}

function noPhotoHtml() {
  return `<div class="no-photo">${icon("house", 28)}</div>`;
}

const state = { meta: {}, quick: "all", ascending: false, operation: "venta", portals: [], view: "grid" };
let pollTimer = null;

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
    : "Ningún anuncio pasa el filtro.";
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
      // Drop selections that no longer exist among the offered options (e.g. a
      // neighbourhood filtered out entirely by the other active filters).
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

/* ── Toasts ─────────────────────────────────────────────── */
function toast(message, kind = "") {
  const node = document.createElement("div");
  node.className = `toast ${kind}`;
  node.textContent = message;
  el("toasts").append(node);
  setTimeout(() => node.remove(), 4200);
}

/* ── Theme ──────────────────────────────────────────────── */
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  el("theme-toggle").innerHTML = theme === "light" ? icon("sun", 16) : icon("moon", 16);
  try {
    localStorage.setItem("hr-theme", theme);
  } catch {
    /* private mode: the choice just won't stick */
  }
}

let storedTheme = "light";
try {
  storedTheme = localStorage.getItem("hr-theme") || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
} catch {
  /* ignore */
}
applyTheme(storedTheme);
el("theme-toggle").addEventListener("click", () =>
  applyTheme(document.documentElement.dataset.theme === "light" ? "dark" : "light"),
);

/* ── Meta + KPIs ────────────────────────────────────────── */
async function loadMeta() {
  state.meta = await api("/api/meta");
  state.portals = state.meta.portals;

  const backends = Object.entries(state.meta.backends || {})
    .map(([portal, backend]) => `${portal} · ${backend.includes("Api") ? "API oficial" : "scraping"}`)
    .join("  ·  ");
  el("meta-line").textContent =
    `${backends}  ·  ${state.meta.delay_seconds}s entre peticiones  ·  ` +
    (state.meta.daily_run_hour >= 0 ? `run diario ${state.meta.daily_run_hour}:00` : "run diario desactivado");

  el("location-select").innerHTML = Object.keys(state.meta.locations)
    .map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`)
    .join("");

  el("portals-field").innerHTML = state.portals
    .map((portal) => `<button type="button" class="chip" data-portal="${portal}" aria-pressed="true">${portal}</button>`)
    .join("");
  el("portals-field")
    .querySelectorAll("[data-portal]")
    .forEach((chip) =>
      chip.addEventListener("click", () =>
        chip.setAttribute("aria-pressed", chip.getAttribute("aria-pressed") === "true" ? "false" : "true"),
      ),
    );

  el("f-portal").innerHTML =
    '<option value="">Todos</option>' + state.portals.map((p) => `<option value="${p}">${p}</option>`).join("");

  if (state.meta.public_demo) {
    el("demo-banner").classList.remove("hidden");
    document.querySelectorAll('#search-form button[type="submit"], #run-now').forEach((button) => {
      button.disabled = true;
      button.title = "Desactivado en la demo pública";
    });
  }
}

async function renderKpis() {
  const stats = await api("/api/stats");
  const cards = [
    { value: num(stats.total_listings), label: "anuncios seguidos" },
    { value: num(stats.new_listings), label: "nuevos en la última pasada", cls: "accent" },
    { value: num(stats.price_drops), label: "con bajada de precio", cls: "ok" },
    { value: num(stats.sareb_listings), label: "de la Sareb", cls: "sareb" },
    { value: num(stats.bargains), label: "chollos (≥15% bajo su barrio)", cls: "bargain" },
    { value: euro(stats.median_price), label: "precio mediano" },
    { value: stats.median_price_per_m2 ? `${num(stats.median_price_per_m2)} €/m²` : "—", label: "mediana por m²" },
    { value: relative(stats.last_scrape), label: "última captura" },
  ];
  el("kpis").innerHTML = cards
    .map(
      (card) =>
        `<div class="kpi ${card.cls ?? ""}"><div class="kpi-value">${card.value}</div><div class="kpi-label">${card.label}</div></div>`,
    )
    .join("");
}

/* ── Search form ────────────────────────────────────────── */
el("operation-toggle").addEventListener("click", (event) => {
  const button = event.target.closest(".seg");
  if (!button) return;
  state.operation = button.dataset.value;
  el("operation-toggle")
    .querySelectorAll(".seg")
    .forEach((seg) => seg.classList.toggle("active", seg === button));
});

function readForm() {
  const form = el("search-form");
  const data = new FormData(form);
  const number = (key) => (data.get(key) ? Number(data.get(key)) : null);
  const locationName = data.get("location");
  const portals = [...el("portals-field").querySelectorAll('[aria-pressed="true"]')].map((c) => c.dataset.portal);
  if (!portals.length) throw new Error("Selecciona al menos un portal");

  const location = state.meta.locations[locationName];
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
  try {
    const payload = readForm();
    await api("/api/searches", { method: "POST", body: JSON.stringify(payload) });
    toast(`Búsqueda "${payload.name}" guardada`, "success");
    renderSearches();
  } catch (error) {
    toast(`No se pudo guardar: ${error.message}`, "error");
  }
});

el("run-now").addEventListener("click", async () => {
  try {
    const payload = readForm();
    await api("/api/runs", { method: "POST", body: JSON.stringify(payload) });
    toast("Ejecución lanzada");
    showTab("runs");
  } catch (error) {
    toast(`No se pudo lanzar: ${error.message}`, "error");
  }
});

/* ── Saved searches ─────────────────────────────────────── */
async function renderSearches() {
  const searches = await api("/api/searches");
  const container = el("searches-list");
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
          <span class="saved-meta">${c.portals.join(", ")} · última: ${
            search.last_run_at ? relative(search.last_run_at) : "nunca"
          }</span>
        </div>
        ${
          state.meta.public_demo
            ? ""
            : `<div class="actions">
          <button class="btn primary small" data-run="${search.id}">Lanzar</button>
          <button class="btn danger small ghost" data-delete="${search.id}">Borrar</button>
        </div>`
        }
      </div>`;
    })
    .join("");

  container.querySelectorAll("[data-run]").forEach((button) =>
    button.addEventListener("click", async () => {
      button.disabled = true;
      await api(`/api/searches/${button.dataset.run}/run`, { method: "POST" });
      toast("Ejecución lanzada");
      showTab("runs");
    }),
  );
  container.querySelectorAll("[data-delete]").forEach((button) =>
    button.addEventListener("click", async () => {
      await api(`/api/searches/${button.dataset.delete}`, { method: "DELETE" });
      toast("Búsqueda borrada");
      renderSearches();
    }),
  );
}

/* ── Listings ───────────────────────────────────────────── */
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

const neighborhoodSelect = createMultiSelect(el("f-neighborhood"), {
  emptyLabel: "Todos los barrios",
  onChange: renderListings,
});

/** Barrios agrupados por distrito, con el recuento de anuncios de cada uno. */
function renderNeighborhoodOptions(facets) {
  const groups = new Map();
  facets.forEach((facet) => {
    if (!groups.has(facet.group)) groups.set(facet.group, []);
    groups.get(facet.group).push({ value: facet.neighborhood, label: facet.neighborhood, count: facet.count });
  });
  neighborhoodSelect.setGroups([...groups.entries()].map(([group, items]) => ({ group, items })));
}

/** Fotocasa gives a bare number, idealista a phrase like "4ª planta exterior". */
function floorLabel(floor) {
  if (floor == null || floor === "") return null;
  const text = String(floor);
  if (!/^\d+$/.test(text)) return text.slice(0, 26);
  return text === "0" ? "bajo" : `planta ${text}`;
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
      <a class="listing-title" href="${escapeHtml(item.url)}" target="_blank" rel="noopener">${escapeHtml(
        item.title ?? item.listing_id,
      )}</a>
      <div class="specs">
        ${item.rooms ? `<span><b>${item.rooms}</b> hab</span>` : ""}
        ${item.surface_m2 ? `<span><b>${num(item.surface_m2)}</b> m²</span>` : ""}
        ${floor ? `<span>${escapeHtml(floor)}</span>` : ""}
      </div>
      ${zone ? `<div class="specs">${icon("pin", 12)}${escapeHtml(zone)}</div>` : ""}
      <div class="listing-foot">
        <span>${escapeHtml((item.advertiser_name ?? item.advertiser_type ?? "").slice(0, 26)) || "—"}</span>
        <button class="link-btn" data-history="${item.portal}|${item.listing_id}">
          ${item.snapshots > 1 ? `${item.snapshots} capturas` : relative(item.first_seen)}
        </button>
      </div>
    </div>
  </article>`;
}

async function renderListings() {
  const grid = el("listings-grid");
  const onMap = state.view === "map";
  if (!onMap) grid.innerHTML = Array.from({ length: 6 }, () => '<div class="skeleton"></div>').join("");

  const params = new URLSearchParams({
    order_by: el("f-order").value,
    ascending: String(state.ascending),
    limit: onMap ? "1000" : "200",
  });
  const optional = {
    portal: el("f-portal").value,
    max_price: el("f-max-price").value,
    min_rooms: el("f-min-rooms").value,
    min_surface: el("f-min-surface").value,
  };
  Object.entries(optional).forEach(([key, value]) => value && params.set(key, value));
  neighborhoodSelect.getSelected().forEach((value) => params.append("neighborhood", value));
  if (state.quick === "new") params.set("only_new", "true");
  if (state.quick === "drops") params.set("only_drops", "true");
  if (state.quick === "sareb") params.set("only_sareb", "true");
  if (state.quick === "bargain") params.set("only_bargain", "true");

  const data = await api(`/api/listings?${params}`);
  renderNeighborhoodOptions(data.facets?.neighborhoods ?? []);
  el("listings-count").textContent = data.total
    ? `${nf.format(data.matched)} de ${nf.format(data.total)} anuncios · mostrando ${data.items.length}`
    : "";

  if (onMap) {
    grid.classList.add("hidden");
    el("listings-map").classList.remove("hidden");
    renderMap(data.items);
    return;
  }
  el("listings-map").classList.add("hidden");
  el("map-note").classList.add("hidden");
  grid.classList.remove("hidden");

  if (!data.items.length) {
    grid.innerHTML = `<div class="empty" style="grid-column:1/-1">
      <div class="empty-icon">${icon("search", 26)}</div>
      <div class="empty-title">${data.total ? "Ningún anuncio pasa el filtro" : "Todavía no hay datos"}</div>
      <div class="tiny">${data.total ? "Prueba a relajar los filtros." : "Lanza una búsqueda desde la pestaña Búsquedas."}</div>
    </div>`;
    return;
  }

  grid.innerHTML = data.items.map(listingCard).join("");
  grid.querySelectorAll("[data-history]").forEach((button) =>
    button.addEventListener("click", () => showHistory(...button.dataset.history.split("|"))),
  );
  grid.querySelectorAll("[data-thumb]").forEach((img) =>
    img.addEventListener("error", () => { img.outerHTML = noPhotoHtml(); }, { once: true }),
  );
}

/* ── Price history modal ────────────────────────────────── */
async function showHistory(portal, listingId) {
  const { points } = await api(`/api/listings/${portal}/${listingId}/history`);
  el("modal-title").textContent = "Histórico de precio";
  el("modal-body").innerHTML = points.length
    ? points
        .map((point, index) => {
          const previous = index ? points[index - 1].price : null;
          const delta = previous == null ? null : point.price - previous;
          const deltaHtml =
            delta == null || delta === 0
              ? ""
              : `<span class="${delta < 0 ? "delta-down" : "delta-up"}">${delta < 0 ? "↓" : "↑"} ${euro(Math.abs(delta))}</span>`;
          return `<div class="history-row"><span class="muted">${point.scraped_at.slice(0, 10)}</span>
            <span>${euro(point.price)} ${deltaHtml}</span></div>`;
        })
        .reverse()
        .join("")
    : '<p class="muted">Sin capturas anteriores.</p>';
  el("modal").classList.remove("hidden");
}

el("modal-close").addEventListener("click", () => el("modal").classList.add("hidden"));
el("modal").addEventListener("click", (event) => {
  if (event.target === el("modal")) el("modal").classList.add("hidden");
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") el("modal").classList.add("hidden");
});

/* ── Runs ───────────────────────────────────────────────── */
const RUN_LABELS = { pending: "en cola", running: "en curso", done: "ok", failed: "error" };

async function renderRuns() {
  const runs = await api("/api/runs?limit=25");
  const container = el("runs-list");
  if (!runs.length) {
    container.innerHTML = `<div class="empty"><div class="empty-icon">${icon("clock", 26)}</div>
      <div class="empty-title">Nada ejecutado todavía</div>
      <div class="tiny">Lanza una búsqueda para ver aquí su traza.</div></div>`;
    return;
  }

  container.innerHTML = runs
    .map((run) => {
      const failed = run.portals.filter((portal) => portal.status === "failed").length;
      const partial = run.status === "done" && failed > 0;
      const statusClass = partial ? "running" : run.status;
      const statusLabel = partial ? `parcial · ${failed} portal con error` : RUN_LABELS[run.status];

      const portals = run.portals
        .map((portal) => {
          const weak = Object.entries(portal.field_coverage || {})
            .filter(([, ratio]) => ratio < 0.5)
            .map(([name]) => name);
          return `<div class="portal-line">
            <span class="badge ${portal.status}">${portal.portal}</span>
            <span><b>${portal.listings}</b> anuncios · ${portal.pages_fetched} págs · vía ${portal.fetcher ?? "—"}</span>
            ${weak.length ? `<span class="error-text">campos vacíos: ${weak.join(", ")}</span>` : ""}
            ${portal.error ? `<span class="error-text">${escapeHtml(portal.error)}</span>` : ""}
          </div>`;
        })
        .join("");
      return `<div class="run">
        <div class="run-head">
          <span class="run-name">${escapeHtml(run.search_name)}</span>
          <span class="badge ${statusClass}">${statusLabel}</span>
          <span class="muted tiny">${run.started_at.replace("T", " ").slice(0, 16)}</span>
        </div>
        <div class="run-stats">
          <span><b>${run.total_listings}</b> anuncios</span>
          <span><b>${run.new_listings}</b> nuevos</span>
          <span><b>${run.price_drops}</b> bajadas</span>
        </div>
        <div class="run-portals">${portals}</div>
        ${run.error ? `<span class="error-text">${escapeHtml(run.error)}</span>` : ""}
      </div>`;
    })
    .join("");

  clearTimeout(pollTimer);
  if (runs.some((run) => run.status === "running" || run.status === "pending")) {
    pollTimer = setTimeout(() => {
      renderRuns();
      renderKpis();
    }, 3000);
  }
}

/* ── Tabs ───────────────────────────────────────────────── */
function showTab(name) {
  document.querySelectorAll(".seg[data-tab]").forEach((tab) => tab.classList.toggle("active", tab.dataset.tab === name));
  document.querySelectorAll(".panel").forEach((panel) => panel.classList.toggle("hidden", panel.id !== `tab-${name}`));
  if (name === "listings") renderListings();
  if (name === "runs") renderRuns();
  if (name === "searches") renderSearches();
}

document
  .querySelectorAll(".seg[data-tab]")
  .forEach((tab) => tab.addEventListener("click", () => showTab(tab.dataset.tab)));

loadMeta()
  .then(() => Promise.all([renderKpis(), renderSearches()]))
  .catch((error) => toast(`Error al cargar: ${error.message}`, "error"));

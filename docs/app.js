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

/* ── Theme (same convention as the live app, separate storage key) ────── */
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  el("theme-toggle").textContent = theme === "light" ? "☀" : "☾";
  try {
    localStorage.setItem("hr-demo-theme", theme);
  } catch {
    /* private mode: the choice just won't stick */
  }
}

let storedTheme = "dark";
try {
  storedTheme = localStorage.getItem("hr-demo-theme") || (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
} catch {
  /* ignore */
}
applyTheme(storedTheme);
el("theme-toggle").addEventListener("click", () =>
  applyTheme(document.documentElement.dataset.theme === "light" ? "dark" : "light"),
);

/* ── Data ───────────────────────────────────────────────── */
const state = { data: null, quick: "all", ascending: false };

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
  if (item.is_new) badges.push('<span class="badge new">✦ Nuevo</span>');
  if (item.price_delta < 0) badges.push(`<span class="badge drop">↓ ${euro(Math.abs(item.price_delta))}</span>`);
  if (item.price_delta > 0) badges.push(`<span class="badge rise">↑ ${euro(item.price_delta)}</span>`);
  if (item.is_sareb) badges.push('<span class="badge sareb">🏦 Sareb</span>');

  const zone = [item.neighborhood, item.district, item.city].filter(Boolean)[0];
  const floor = floorLabel(item.floor);
  const media = item.thumbnail
    ? `<img src="${escapeHtml(item.thumbnail)}" alt="" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'no-photo',textContent:'🏠'}))" />`
    : '<div class="no-photo">🏠</div>';

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
      ${zone ? `<div class="specs">📍 ${escapeHtml(zone)}</div>` : ""}
      <div class="listing-foot">
        <span>${escapeHtml((item.advertiser_name ?? item.advertiser_type ?? "").slice(0, 26)) || "—"}</span>
        <span>${item.snapshots > 1 ? `${item.snapshots} capturas` : relative(item.first_seen)}</span>
      </div>
    </div>
  </article>`;
}

function renderListings() {
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

  const matched = items.length;
  items.sort((a, b) => {
    const av = a[order];
    const bv = b[order];
    if (av == null) return 1;
    if (bv == null) return -1;
    return av > bv ? 1 : av < bv ? -1 : 0;
  });
  if (!state.ascending) items.reverse();
  items = items.slice(0, 200);

  el("listings-count").textContent = total ? `${nf.format(matched)} de ${nf.format(total)} anuncios · mostrando ${items.length}` : "";

  if (!items.length) {
    grid.innerHTML = `<div class="empty" style="grid-column:1/-1">
      <div class="empty-icon">🏚️</div>
      <div class="empty-title">${total ? "Ningún anuncio pasa el filtro" : "Todavía no hay datos"}</div>
      <div class="tiny">${total ? "Prueba a relajar los filtros." : "El primer run diario aún no se ha ejecutado."}</div>
    </div>`;
    return;
  }
  grid.innerHTML = items.map(listingCard).join("");
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
  el("sort-dir").textContent = state.ascending ? "↑" : "↓";
  renderListings();
});

["f-portal", "f-max-price", "f-min-rooms", "f-min-surface", "f-order"].forEach((id) =>
  el(id).addEventListener("change", renderListings),
);

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
      <div class="empty-icon">⚠️</div>
      <div class="empty-title">No se pudo cargar data.json</div>
      <div class="tiny">Puede que el primer run de GitHub Actions todavía no se haya ejecutado.</div>
    </div>`;
  });

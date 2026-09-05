const api = async (path, options = {}) => {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!response.ok) throw new Error((await response.text()).slice(0, 300));
  return response.json();
};

const el = (id) => document.getElementById(id);
const euro = (value) =>
  value == null ? "—" : new Intl.NumberFormat("es-ES", { maximumFractionDigits: 0 }).format(value) + " €";
const day = (value) => (value ? value.slice(0, 10) : "—");

let meta = { portals: [], locations: {} };
let pollTimer = null;

async function loadMeta() {
  meta = await api("/api/meta");
  const backends = Object.entries(meta.backends || {})
    .map(([portal, backend]) => `${portal} (${backend.replace("Scraper", "")})`)
    .join(", ");
  el("meta-line").textContent =
    `${backends} · ${meta.delay_seconds}s entre peticiones · ` +
    `hasta ${meta.max_pages_per_run} páginas por portal · ` +
    (meta.daily_run_hour >= 0 ? `run diario a las ${meta.daily_run_hour}:00` : "run diario desactivado");

  el("location-select").innerHTML = Object.keys(meta.locations)
    .map((name) => `<option value="${name}">${name}</option>`)
    .join("");

  el("portals-field").insertAdjacentHTML(
    "beforeend",
    meta.portals
      .map(
        (portal) =>
          `<label class="checkbox"><input type="checkbox" name="portal" value="${portal}" checked /> ${portal}</label>`,
      )
      .join(""),
  );

  el("f-portal").innerHTML =
    '<option value="">todos</option>' + meta.portals.map((p) => `<option value="${p}">${p}</option>`).join("");
}

function readForm() {
  const form = el("search-form");
  const data = new FormData(form);
  const number = (key) => (data.get(key) ? Number(data.get(key)) : null);
  const locationName = data.get("location");
  const portals = [...form.querySelectorAll('input[name="portal"]:checked')].map((i) => i.value);

  if (!portals.length) throw new Error("Selecciona al menos un portal");

  const location = meta.locations[locationName];
  return {
    name: data.get("name") || locationName,
    criteria: {
      location_name: locationName,
      location_slugs: Object.fromEntries(
        portals.map((p) => [p, location.slugs[p]]).filter(([, slug]) => slug),
      ),
      center: location.center,
      operation: data.get("operation"),
      portals,
      min_price: number("min_price"),
      max_price: number("max_price"),
      min_rooms: number("min_rooms"),
      min_surface: number("min_surface"),
      max_pages: number("max_pages"),
    },
  };
}

async function renderSearches() {
  const searches = await api("/api/searches");
  const container = el("searches-list");
  if (!searches.length) {
    container.innerHTML = '<p class="empty">Todavía no hay búsquedas guardadas.</p>';
    return;
  }
  container.innerHTML = searches
    .map((search) => {
      const c = search.criteria;
      const filters = [
        c.operation,
        c.min_price ? `desde ${euro(c.min_price)}` : null,
        c.max_price ? `hasta ${euro(c.max_price)}` : null,
        c.min_rooms ? `${c.min_rooms}+ hab` : null,
        c.min_surface ? `${c.min_surface}+ m²` : null,
      ]
        .filter(Boolean)
        .join(" · ");
      return `<div class="row">
        <div class="row-main">
          <span class="row-title">${search.name}</span>
          <span class="muted">${c.location_name} · ${filters} · ${c.portals.join(", ")}</span>
          <span class="muted">Última ejecución: ${search.last_run_at ? day(search.last_run_at) : "nunca"}</span>
        </div>
        <div class="actions">
          <button class="primary" data-run="${search.id}">Lanzar</button>
          <button class="danger" data-delete="${search.id}">Borrar</button>
        </div>
      </div>`;
    })
    .join("");

  container.querySelectorAll("[data-run]").forEach((button) =>
    button.addEventListener("click", async () => {
      await api(`/api/searches/${button.dataset.run}/run`, { method: "POST" });
      showTab("runs");
    }),
  );
  container.querySelectorAll("[data-delete]").forEach((button) =>
    button.addEventListener("click", async () => {
      await api(`/api/searches/${button.dataset.delete}`, { method: "DELETE" });
      renderSearches();
    }),
  );
}

async function renderListings() {
  const params = new URLSearchParams();
  const filters = {
    portal: el("f-portal").value,
    max_price: el("f-max-price").value,
    min_rooms: el("f-min-rooms").value,
    min_surface: el("f-min-surface").value,
    order_by: el("f-order").value,
    ascending: el("f-asc").checked,
  };
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== "" && value !== null) params.set(key, value);
  });

  const data = await api(`/api/listings?${params}`);
  el("listings-count").textContent = `${data.total} anuncios guardados (mostrando ${data.items.length})`;
  const body = document.querySelector("#listings-table tbody");
  body.innerHTML = data.items
    .map(
      (item) => `<tr>
        <td>${item.portal}</td>
        <td class="title"><a href="${item.url}" target="_blank" rel="noopener">${item.title ?? item.listing_id}</a></td>
        <td>${euro(item.price)}</td>
        <td>${item.price_per_m2 ? Math.round(item.price_per_m2) : "—"}</td>
        <td>${item.rooms ?? "—"}</td>
        <td>${item.surface_m2 ?? "—"}</td>
        <td>${[item.neighborhood, item.district, item.city].filter(Boolean)[0] ?? "—"}</td>
        <td>${item.advertiser_name ?? item.advertiser_type ?? "—"}</td>
        <td>${day(item.scraped_at)}</td>
      </tr>`,
    )
    .join("");
  if (!data.items.length) {
    body.innerHTML = '<tr><td colspan="9" class="empty">Sin datos todavía. Lanza una búsqueda.</td></tr>';
  }
}

async function renderRuns() {
  const runs = await api("/api/runs?limit=25");
  const container = el("runs-list");
  if (!runs.length) {
    container.innerHTML = '<p class="empty">Todavía no se ha ejecutado ninguna búsqueda.</p>';
    return;
  }
  container.innerHTML = runs
    .map((run) => {
      const portals = run.portals
        .map((p) => {
          const coverage = Object.entries(p.field_coverage || {})
            .filter(([, ratio]) => ratio < 0.5)
            .map(([field]) => field);
          const warning = coverage.length ? ` · campos vacíos: ${coverage.join(", ")}` : "";
          return `<span class="muted">${p.portal}: ${p.listings} anuncios en ${p.pages_fetched} págs (${p.fetcher})${warning}${
            p.error ? ` <span class="error-text">${p.error}</span>` : ""
          }</span>`;
        })
        .join("<br />");
      return `<div class="row">
        <div class="row-main">
          <span class="row-title">${run.search_name} <span class="badge ${run.status}">${run.status}</span></span>
          <span class="muted">${run.started_at.replace("T", " ").slice(0, 16)} · ${run.total_listings} anuncios · ${
            run.new_listings
          } nuevos · ${run.price_drops} bajadas de precio</span>
          ${portals}
          ${run.error ? `<span class="error-text">${run.error}</span>` : ""}
        </div>
      </div>`;
    })
    .join("");

  const active = runs.some((run) => run.status === "running" || run.status === "pending");
  clearTimeout(pollTimer);
  if (active) pollTimer = setTimeout(renderRuns, 3000);
}

function showTab(name) {
  document.querySelectorAll(".tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.tab === name));
  document.querySelectorAll(".panel").forEach((panel) => panel.classList.toggle("hidden", panel.id !== `tab-${name}`));
  if (name === "listings") renderListings();
  if (name === "runs") renderRuns();
  if (name === "searches") renderSearches();
}

document.querySelectorAll(".tab").forEach((tab) => tab.addEventListener("click", () => showTab(tab.dataset.tab)));

el("search-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await api("/api/searches", { method: "POST", body: JSON.stringify(readForm()) });
    el("form-msg").textContent = "Búsqueda guardada.";
    renderSearches();
  } catch (error) {
    el("form-msg").textContent = `Error: ${error.message}`;
  }
});

el("run-now").addEventListener("click", async () => {
  try {
    await api("/api/runs", { method: "POST", body: JSON.stringify(readForm()) });
    showTab("runs");
  } catch (error) {
    el("form-msg").textContent = `Error: ${error.message}`;
  }
});

el("apply-filters").addEventListener("click", renderListings);

loadMeta().then(renderSearches);

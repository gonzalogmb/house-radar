# house-radar

Radar de vivienda: ingesta diaria de anuncios inmobiliarios, almacenamiento crudo +
normalizado, y una web para configurar búsquedas, lanzarlas y consultar resultados.

```
web (HTML/JS)  ->  FastAPI  ->  scrapers  ->  data/raw/*.html.gz   (payload íntegro)
                                          ->  data/listings/*.parquet (normalizado)
```

## Estado de los portales

| Portal | Backend | Estado |
|---|---|---|
| **fotocasa** | HTTP + `BeautifulSoup` | Funciona. La página incrusta todo el resultado como JSON en `<script id="__initial_props__">`, así que leemos eso en vez del marcado: sobrevive a rediseños y trae más campos (coordenadas, código postal, fecha de publicación). |
| **pisos.com** | HTTP + `BeautifulSoup` | Funciona, sin muro anti-bot detectado. Los filtros son segmentos de ruta en un orden fijo (`con-N-habitaciones`, `desde-N-m2`, `desde-N`, `hasta-N`) que el servidor reordena solo con un 301 si se los pasas en otro orden; no soporta fecha de publicación en el listado (se excluye de la cobertura de campos, no es una rotura). |
| **idealista** | API oficial (`IdealistaApiScraper`) | Requiere clave. Su web pública está tras **DataDome** y responde `403` a cualquier cliente automatizado — comprobado con Chromium y Chrome reales, headless y con ventana. No se intenta evadir el muro. |
| idealista | HTML (`IdealistaScraper`) | Fallback sin clave: el parser es correcto y está probado, pero devolverá el error del muro anti-bot en vez de fingir que funcionó. |

Para activar idealista, pide una clave gratuita en <https://www.idealista.com/labs/> y
define `HR_IDEALISTA_API_KEY` / `HR_IDEALISTA_API_SECRET`. El plan gratuito ronda las
100 peticiones al mes, así que ahí `max_pages` importa mucho más que en un portal scrapeado.

## Puesta en marcha

```bash
python -m venv .venv
.venv/Scripts/pip install -r requirements.txt
.venv/Scripts/python -m playwright install chromium
.venv/Scripts/python -m uvicorn app.main:app --reload
```

La web queda en <http://localhost:8000>. Copia `.env.example` a `.env` para ajustar
ritmo de peticiones, páginas por run, hora del run diario y credenciales.

### Docker

```bash
docker compose up --build
```

Los datos persisten en `./data`, montado como volumen.

## Uso

- **Búsquedas**: defines ubicación, operación, precio, habitaciones, superficie y portales.
  Puedes guardarla (entra en el run diario) o lanzarla al momento.
- **Resultados**: tarjetas con foto, precio, €/m² y zona. Los anuncios vistos por primera
  vez en la última pasada llevan distintivo **Nuevo**, y los que han cambiado de precio
  muestran la diferencia; filtros rápidos para ver solo unos u otros. Al pulsar en el pie
  de una tarjeta se abre su histórico de precio.
- **Ejecuciones**: estado en vivo de cada run, anuncios nuevos, bajadas de precio, y qué
  falló en cada portal.

Un run diario a la hora de `HR_DAILY_RUN_HOUR` lanza todas las búsquedas guardadas
(APScheduler dentro del proceso; `HR_DAILY_RUN_HOUR=-1` lo desactiva).

### CLI

```bash
python -m app.cli check          # canario: 1 página por portal + cobertura de campos
python -m app.cli run --all      # ejecuta todas las búsquedas guardadas
```

## Cómo se enfrenta a lo que rompe un scraper

**Rate limiting.** Un `RateLimiter` por portal garantiza un hueco de
`HR_DELAY_SECONDS` + jitter aleatorio entre peticiones; las páginas de un portal van en
serie y los portales entre sí en paralelo (hosts distintos). Ante `429`/`5xx` hay
reintentos con backoff exponencial que respetan la cabecera `Retry-After`.

**Muros anti-bot.** `403`, `429` o marcadores tipo DataDome en el cuerpo se distinguen de
un error de red: son `BlockedError`. Fotocasa arranca por HTTP y, si lo bloquean, el run
cae automáticamente a Playwright y sigue. Cuando el muro también rechaza el navegador,
el run lo reporta con la causa en vez de guardar cero anuncios en silencio.

**Cambios de estructura HTML.** Dos redes distintas:

1. *Rotura total*: si una página carga (>30 KB) pero no sale ningún anuncio, se lanza
   `StructureChangedError` y se vuelca el HTML en `data/debug/` para diagnosticarlo.
2. *Rotura silenciosa* — la peor: los anuncios salen pero con campos vacíos porque
   cambió un selector. Cada run calcula la **cobertura por campo** (% de anuncios con ese
   campo relleno) y la muestra en la pestaña de Ejecuciones; `python -m app.cli check`
   la imprime y sale con código 1 si algo baja del 50%, para engancharlo a un cron.

**Reparseo sin re-scrapear.** El payload íntegro de cada página se guarda comprimido en
`data/raw/{portal}/{fecha}/`. Si el parser resulta estar mal, se corrige y se reprocesa
lo ya descargado sin volver a pedirle nada al portal.

## Datos

- `data/raw/{portal}/{fecha}/{run}_p{n}.html.gz` — payload tal cual llegó.
- `data/listings/portal={portal}/date={fecha}/{run}.parquet` — anuncios normalizados.
- `data/searches.json`, `data/runs.json` — búsquedas guardadas e historial de runs.

Cada run es una foto nueva, así que el histórico permite reconstruir la evolución de
precio de un anuncio (`GET /api/listings/{portal}/{id}/history`) y detectar altas nuevas
y bajadas de precio comparando con la última foto conocida.

## Añadir un portal

1. Crea `app/scrapers/miportal.py` con una subclase de `BaseScraper`: `portal`,
   `build_url(criteria, page)` y `parse_page(html) -> PageResult`. Toda la maquinaria de
   ritmo, reintentos, paginación, guardado del crudo y detección de roturas ya está puesta.
2. Regístralo en `app/scrapers/__init__.py` (`PORTALS` y `scraper_for`).
3. Añade su slug de ubicación en `app/locations.py`.
4. `python -m app.cli check` para ver la cobertura de campos.

## Aviso

Scrapear puede chocar con las condiciones de uso de un portal. Este proyecto es para uso
personal, va deliberadamente despacio y usa la API oficial donde existe. Si un portal
bloquea, la respuesta correcta es su API o su permiso, no una carrera de evasión.

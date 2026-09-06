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

### Demo pública gratuita (GitHub Pages + Actions)

Esta es la que está enlazada desde el portfolio. No hay servidor corriendo en
ningún sitio ni factura de por medio:

- [`.github/workflows/daily-scrape.yml`](.github/workflows/daily-scrape.yml) corre una
  vez al día (gratis, `workflow_dispatch` para lanzarlo también a mano), scrapea las
  búsquedas de [`site/searches.json`](site/searches.json), acumula el histórico en
  `site/history.parquet` (committeado — un runner de Actions no persiste nada entre
  ejecuciones, así que el histórico vive en el propio repo) y escribe
  [`docs/data.json`](docs/data.json).
- `docs/` es una página estática (sin FastAPI, sin Python en el navegador) que lee
  [`docs/data.json`](docs/data.json) y filtra/ordena en el cliente para **Resultados**.
  La sirve GitHub Pages: gratis para siempre, no se duerme, no tiene disco que pagar.
- **Búsquedas** y **Ejecuciones** sí están completas ahí, apoyadas en la propia API de
  GitHub en vez de un backend:
  - *Ver* (lista de búsquedas guardadas, historial de Ejecuciones) es una lectura sin
    autenticar — funciona para cualquier visitante, porque el repo es público.
  - *Guardar/borrar una búsqueda* escribe directamente en
    [`site/searches.json`](site/searches.json) vía la API de contenidos de GitHub (un
    commit por cambio). *Lanzar* (una búsqueda o todas) dispara el mismo
    `workflow_dispatch` que la pestaña Actions, con un input opcional para decirle que
    corra solo una búsqueda por nombre.
  - Todo eso escribe, así que exige iniciar sesión con **Google** primero (botón
    "Iniciar sesión" en la pestaña Búsquedas) — y no con cualquier cuenta: tiene que
    ser exactamente `gonzalogmb@gmail.com`. Esa comprobación no la hace el
    navegador: la hace [`cf-worker/worker.js`](cf-worker/worker.js), una función
    Cloudflare Workers (gratis) que se interpone entre la página y GitHub. El
    navegador nunca ve ni guarda el token de GitHub — vive únicamente como secreto
    de ese Worker. Lo que la página manda al Worker es el token de identidad que
    entrega Google al iniciar sesión; el Worker verifica su firma contra las claves
    públicas de Google, comprueba emisor/audiencia/caducidad, y solo si el email
    verificado es el tuyo llama a GitHub con su propio secreto. Así que ni abriendo
    la consola del navegador se puede falsificar esto: sin haber iniciado sesión de
    verdad como esa cuenta de Google, el Worker rechaza la petición.
  - Sin servidor propio, "Ejecuciones" no es tiempo real: lanzar algo tarda 1-2 min en
    encolarse y correr en un runner de Actions; la pestaña muestra `en cola`/`en
    curso`/`ok`/`error` con un enlace a los logs completos en GitHub, no una barra de
    progreso al segundo.

Puesta en marcha (una sola vez):

1. Repo → **Settings → Pages** → Source: rama `main`, carpeta `/docs`.
2. Repo → **Settings → Pages → Custom domain**: `radar.gonzalomartinezberzal.com`
   (ya está el archivo `docs/CNAME` con ese valor). Marca **Enforce HTTPS** en cuanto
   se active la opción.
3. En tu proveedor DNS de `gonzalomartinezberzal.com`, añade un `CNAME`:
   `radar` → `gonzalogmb.github.io`.
4. Opcional: si tienes clave de idealista, añádela como secretos del repo
   (**Settings → Secrets and variables → Actions**) `HR_IDEALISTA_API_KEY` /
   `HR_IDEALISTA_API_SECRET`, y añade `"idealista"` a `portals` +
   `"idealista": "madrid-madrid"` en `location_slugs` dentro de
   `site/searches.json`. Sin esas claves, no añadas idealista ahí: caería al scraper
   HTML, que necesita Playwright (deliberadamente no instalado en el workflow para
   mantenerlo ligero) y de todos modos lo bloquea DataDome.
5. Para editar qué se scrapea (ciudad, precio, habitaciones...), edita
   `site/searches.json` — es una lista de `{name, criteria}` con la misma forma que
   `SearchCriteria` (ver `app/models.py`).

#### Login con Google (para poder guardar/lanzar/borrar desde la web)

Dos piezas nuevas, las dos gratis: un Client ID de OAuth de Google (para que la
página pueda pedir "inicia sesión con Google") y un Cloudflare Worker (para
verificarlo de verdad y guardar el token de GitHub fuera del navegador).

**1. Client ID de Google:**

1. [Google Cloud Console](https://console.cloud.google.com/) → crea un proyecto
   (o usa uno existente) → **APIs & Services → Credentials → Create Credentials →
   OAuth client ID** → tipo **Web application**.
2. En **Authorized JavaScript origins** añade `https://radar.gonzalomartinezberzal.com`
   (y `http://localhost:8001` o el puerto que uses si quieres probarlo en local).
3. No hace falta configurar una pantalla de consentimiento pública ni verificarla
   — con que tu propia cuenta de Google pueda usarlo basta (modo "Testing" en
   OAuth consent screen, añadiéndote a ti mismo como test user, es suficiente).
4. Copia el **Client ID** (termina en `.apps.googleusercontent.com`). No es
   secreto — está pensado para ir embebido en el frontend.

**2. Cloudflare Worker:**

1. Crea una cuenta gratuita en [Cloudflare](https://dash.cloudflare.com/sign-up) si
   no tienes.
2. Instala Wrangler (`npm install -g wrangler`) y autentícate (`wrangler login`).
3. En `cf-worker/wrangler.toml`, sustituye `GOOGLE_CLIENT_ID` por el Client ID del
   paso anterior (y `ALLOWED_ORIGIN` si tu dominio es otro).
4. Desde `cf-worker/`, define el secreto real (nunca va en el `.toml` ni en git):
   ```
   wrangler secret put GITHUB_TOKEN
   ```
   Pégale un token fine-grained de GitHub limitado a `house-radar`, con
   **Contents: Read and write** y **Actions: Read and write**.
5. Despliega: `wrangler deploy` (desde `cf-worker/`). Te da una URL del tipo
   `https://house-radar-gate.<tu-subdominio>.workers.dev`.
6. En [`docs/app.js`](docs/app.js), sustituye las constantes `WORKER_URL` y
   `GOOGLE_CLIENT_ID` por los valores reales de los pasos 5 y 1. Haz commit y push.

A partir de aquí, el botón "Iniciar sesión" de la pestaña Búsquedas solo deja
guardar/lanzar/borrar cuando entras con `gonzalogmb@gmail.com` — cualquier otra
cuenta, o no haber iniciado sesión, hace que el Worker rechace la petición.

### Desplegar en Render (app completa e interactiva, de pago)

Alternativa a la anterior, no además: usa esto solo si más adelante quieres cambiar
la instantánea estática por la aplicación completa funcionando en vivo (crear/lanzar
búsquedas desde la web, pestaña de Ejecuciones en tiempo real) — para eso hace falta
un servidor real corriendo, y eso sí tiene coste. El registro DNS de
`radar.gonzalomartinezberzal.com` solo puede apuntar a un sitio a la vez, así que
esto significaría repuntarlo desde GitHub Pages hacia Render.

El repo incluye [render.yaml](render.yaml) para desplegar como Blueprint:

1. Render → New → Blueprint → apunta a este repo. Necesita un plan **de pago**
   ("Starter") con disco, no el gratuito: el free tier no tiene disco persistente
   (los datos desaparecerían en cada reinicio) y se duerme a los 15 min de
   inactividad, lo que se saltaría el run diario en silencio mientras duerme.
2. En el dashboard del servicio, define `HR_ADMIN_TOKEN` (un secreto tuyo — te
   deja crear/lanzar/borrar búsquedas de forma remota mandando la cabecera
   `X-Admin-Token`, sin ese token esas acciones quedan bloqueadas para todo el
   mundo). Opcionalmente `HR_IDEALISTA_API_KEY`/`SECRET` si quieres incluir
   idealista.
3. Añade un registro DNS en tu dominio apuntando al host `*.onrender.com` que te
   dé Render (Render te indica exactamente cuál cuando configuras el dominio
   personalizado en el servicio) — por ejemplo un `CNAME` de
   `radar.gonzalomartinezberzal.com`. Ese paso lo haces tú en tu proveedor DNS.
4. Crea al menos una búsqueda guardada con `HR_ADMIN_TOKEN` (por ejemplo con
   `curl -H "X-Admin-Token: ..." -d '{...}' https://tu-servicio/api/searches`)
   para que el run diario tenga algo que ejecutar — sin ninguna búsqueda
   guardada, la demo se queda vacía hasta que crees una.

Con `HR_PUBLIC_DEMO=true` (ya en el `render.yaml`), cualquier visitante puede
explorar `Resultados` y `Ejecuciones` pero no puede crear, lanzar ni borrar
búsquedas — evita que un desconocido dispare scraping contra los portales
reales, o gaste tu cuota de la API de idealista, desde tu web pública. El run
diario programado no se ve afectado: corre igual, lo dispares tú o no.

## Uso

- **Búsquedas**: defines ubicación, operación, precio, habitaciones, superficie y portales.
  Puedes guardarla (entra en el run diario) o lanzarla al momento.
- **Resultados**: tarjetas con foto, precio, €/m² y zona. Los anuncios vistos por primera
  vez en la última pasada llevan distintivo **Nuevo**, y los que han cambiado de precio
  muestran la diferencia; filtros rápidos para ver solo unos u otros (incluye barrio con
  selección múltiple). Al pulsar en el pie de una tarjeta se abre su histórico de precio.
  El distintivo **🏦 Sareb** marca los anuncios cuyo anunciante coincide con una gestora
  conocida del banco malo (Hipoges, Aliseda, Servihabitat, Aelca...) — ver
  [`app/advertiser_tags.py`](app/advertiser_tags.py). Es una coincidencia de texto sobre
  lo que ya se scrapea de Fotocasa/pisos.com, no un portal nuevo: la Sareb no vende
  directamente (su web tiene hCaptcha) y esas gestoras también gestionan activos de
  otros propietarios, así que es una señal fuerte, no una certeza.
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

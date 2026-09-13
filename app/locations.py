"""Each portal addresses the same place differently.

Fotocasa, pisos.com and the idealista HTML site use URL slugs; the idealista API takes
a centre point plus a radius. A location entry therefore carries both.

Adding more: idealista slugs are `{municipio}-{provincia}`; fotocasa and pisos.com both
use `{municipio}_capital` for province capitals (confirmed identical on both for the six
cities below) and presumably diverge elsewhere. Run the search by hand on the portal and
copy the slug out of the URL.

Servihabitat is province-wide, not municipio-level — `/es/venta/vivienda/{provincia}`
was the only clean URL found (no per-city narrowing), so its slug covers the whole
province the capital sits in, not just the capital itself. Confirmed by hand for
madrid and malaga; the rest follow the same plain, unaccented province name.
"""

CATALOGUE: dict[str, dict] = {
    "Madrid capital": {
        "slugs": {
            "idealista": "madrid-madrid",
            "fotocasa": "madrid-capital",
            "pisos": "madrid_capital",
            "servihabitat": "madrid",
        },
        "center": "40.4168,-3.7038",
    },
    "Barcelona capital": {
        "slugs": {
            "idealista": "barcelona-barcelona",
            "fotocasa": "barcelona-capital",
            "pisos": "barcelona_capital",
            "servihabitat": "barcelona",
        },
        "center": "41.3874,2.1686",
    },
    "Valencia capital": {
        "slugs": {
            "idealista": "valencia-valencia",
            "fotocasa": "valencia-capital",
            "pisos": "valencia_capital",
            "servihabitat": "valencia",
        },
        "center": "39.4699,-0.3763",
    },
    "Sevilla capital": {
        "slugs": {
            "idealista": "sevilla-sevilla",
            "fotocasa": "sevilla-capital",
            "pisos": "sevilla_capital",
            "servihabitat": "sevilla",
        },
        "center": "37.3891,-5.9845",
    },
    "Zaragoza capital": {
        "slugs": {
            "idealista": "zaragoza-zaragoza",
            "fotocasa": "zaragoza-capital",
            "pisos": "zaragoza_capital",
            "servihabitat": "zaragoza",
        },
        "center": "41.6488,-0.8891",
    },
    "Málaga capital": {
        "slugs": {
            "idealista": "malaga-malaga",
            "fotocasa": "malaga-capital",
            "pisos": "malaga_capital",
            "servihabitat": "malaga",
        },
        "center": "36.7213,-4.4214",
    },
}

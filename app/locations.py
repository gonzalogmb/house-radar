"""Each portal addresses the same place differently.

Fotocasa, pisos.com and the idealista HTML site use URL slugs; the idealista API takes
a centre point plus a radius. A location entry therefore carries both.

Adding more: idealista slugs are `{municipio}-{provincia}`; fotocasa and pisos.com both
use `{municipio}_capital` for province capitals (confirmed identical on both for the six
cities below) and presumably diverge elsewhere. Run the search by hand on the portal and
copy the slug out of the URL.
"""

CATALOGUE: dict[str, dict] = {
    "Madrid capital": {
        "slugs": {"idealista": "madrid-madrid", "fotocasa": "madrid-capital", "pisos": "madrid_capital"},
        "center": "40.4168,-3.7038",
    },
    "Barcelona capital": {
        "slugs": {
            "idealista": "barcelona-barcelona",
            "fotocasa": "barcelona-capital",
            "pisos": "barcelona_capital",
        },
        "center": "41.3874,2.1686",
    },
    "Valencia capital": {
        "slugs": {
            "idealista": "valencia-valencia",
            "fotocasa": "valencia-capital",
            "pisos": "valencia_capital",
        },
        "center": "39.4699,-0.3763",
    },
    "Sevilla capital": {
        "slugs": {"idealista": "sevilla-sevilla", "fotocasa": "sevilla-capital", "pisos": "sevilla_capital"},
        "center": "37.3891,-5.9845",
    },
    "Zaragoza capital": {
        "slugs": {
            "idealista": "zaragoza-zaragoza",
            "fotocasa": "zaragoza-capital",
            "pisos": "zaragoza_capital",
        },
        "center": "41.6488,-0.8891",
    },
    "Málaga capital": {
        "slugs": {"idealista": "malaga-malaga", "fotocasa": "malaga-capital", "pisos": "malaga_capital"},
        "center": "36.7213,-4.4214",
    },
}

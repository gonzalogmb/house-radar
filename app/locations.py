"""Each portal addresses the same place differently.

Fotocasa and the idealista HTML site use URL slugs; the idealista API takes a centre
point plus a radius. A location entry therefore carries both.

Adding more: idealista slugs are `{municipio}-{provincia}`, fotocasa uses
`{municipio}-capital` for province capitals and `{municipio}` elsewhere. Run the search
by hand on the portal and copy the slug out of the URL.
"""

CATALOGUE: dict[str, dict] = {
    "Madrid capital": {
        "slugs": {"idealista": "madrid-madrid", "fotocasa": "madrid-capital"},
        "center": "40.4168,-3.7038",
    },
    "Barcelona capital": {
        "slugs": {"idealista": "barcelona-barcelona", "fotocasa": "barcelona-capital"},
        "center": "41.3874,2.1686",
    },
    "Valencia capital": {
        "slugs": {"idealista": "valencia-valencia", "fotocasa": "valencia-capital"},
        "center": "39.4699,-0.3763",
    },
    "Sevilla capital": {
        "slugs": {"idealista": "sevilla-sevilla", "fotocasa": "sevilla-capital"},
        "center": "37.3891,-5.9845",
    },
    "Zaragoza capital": {
        "slugs": {"idealista": "zaragoza-zaragoza", "fotocasa": "zaragoza-capital"},
        "center": "41.6488,-0.8891",
    },
    "Málaga capital": {
        "slugs": {"idealista": "malaga-malaga", "fotocasa": "malaga-capital"},
        "center": "36.7213,-4.4214",
    },
}

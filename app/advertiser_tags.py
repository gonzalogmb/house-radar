"""Best-effort tagging of listings from Sareb's servicing chain.

Sareb doesn't sell to individuals directly — its own site sits behind an hCaptcha
wall we don't attempt to pass — and by design delegates sales to servicing/asset
management companies. Their agents show up as the `advertiser_name` on listings
already scraped from Fotocasa/pisos.com, so this is a substring match against known
servicer names rather than anything the portals themselves report. It will miss any
listing published under a name not in this list, and Aliseda/Servihabitat/Hipoges
also service assets for owners other than Sareb, so a match here is a strong signal,
not a certainty.
"""

SAREB_ADVERTISER_KEYWORDS = (
    "sareb",
    "hipoges",
    "aliseda",
    "servihabitat",
    "aelca",
    "arqura",
    "árqura",
)


def is_sareb_related(advertiser_name: str | None) -> bool:
    if not advertiser_name:
        return False
    lowered = advertiser_name.lower()
    return any(keyword in lowered for keyword in SAREB_ADVERTISER_KEYWORDS)

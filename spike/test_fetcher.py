"""pytest for the Spike fetcher — parsers only, no network.

Fixtures live in spike/samples/ (see their headers for provenance).
Run:  python -m pytest spike/test_fetcher.py -q
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from fetcher import (
    extract_image_url,
    parse_data_qa,
    parse_embedded_offer,
    parse_json_ld,
    parse_pdp,
    parse_search,
)
from scraper import _is_akamai_challenge, parse_products_from_html

SAMPLES = os.path.join(os.path.dirname(os.path.abspath(__file__)), "samples")


def _read(name: str) -> str:
    with open(os.path.join(SAMPLES, name), encoding="utf-8") as f:
        return f.read()


def test_json_ld_gives_pinned_offer_price_and_seller():
    result = parse_json_ld(_read("pdp_sample.html"))
    assert result is not None
    assert result["price"] == 1829.0
    assert result["original_price"] == 3300.0
    assert result["seller"] == "Dokkan Tech"
    assert result["in_stock"] is True


def test_json_ld_gives_first_image_url():
    result = parse_json_ld(_read("pdp_sample.html"))
    assert result is not None
    assert result["image_url"] == (
        "https://f.nooncdn.com/p/pzsku/ZC828F28BBB2158AD1155Z/45/_/1779704343/"
        "7ad6add4-8892-4182-829f-97d019bebfde.jpg?width=1200"
    )


def test_pdp_carries_image_url():
    result = parse_pdp(_read("pdp_sample.html"), "N21961435A", "f96a6024019fdc0d")
    assert result["parse_ok"] is True
    assert result["image_url"] is not None
    assert result["image_url"].startswith("https://f.nooncdn.com/")


def test_extract_image_url_falls_back_to_og_image():
    html = (
        '<html><head><meta property="og:image" '
        'content="https://f.nooncdn.com/p/x.jpg"></head>'
        '<body><script type="application/ld+json">'
        '{"@type": "Product", "offers": {"price": 10}}</script></body></html>'
    )
    assert extract_image_url(html) == "https://f.nooncdn.com/p/x.jpg"


def test_extract_image_url_is_none_without_any_image():
    html = '<html><head></head><body><script type="application/ld+json">{"@type": "Product", "offers": {"price": 10}}</script></body></html>'
    assert extract_image_url(html) is None


def test_pdp_failure_has_no_image():
    result = parse_pdp("<html><body>no data</body></html>", "N00000000A", "")
    assert result["parse_ok"] is False
    assert result["image_url"] is None


def test_embedded_offer_gives_same_price_as_json_ld():
    result = parse_embedded_offer(_read("pdp_sample.html"), "N21961435A", "f96a6024019fdc0d")
    assert result is not None
    assert result["price"] == 1829.0
    assert result["original_price"] == 3300.0
    assert result["seller"] == "Dokkan Tech"


def test_data_qa_gives_price_but_no_seller():
    result = parse_data_qa(_read("pdp_sample.html"))
    assert result is not None
    assert result["price"] == 1829.0
    assert result["original_price"] == 3300.0
    assert result["seller"] is None


def test_pdp_prefers_json_ld():
    result = parse_pdp(_read("pdp_sample.html"), "N21961435A", "f96a6024019fdc0d")
    assert result["parse_ok"] is True
    assert result["parser_used"] == "json_ld"
    assert result["price"] == 1829.0


def test_pdp_parse_fails_cleanly_on_empty_html():
    result = parse_pdp("<html><body>no data</body></html>", "N00000000A", "")
    assert result["parse_ok"] is False
    assert result["price"] is None


def test_search_finds_sku_in_embedded_payload():
    result = parse_search(_read("list_sample.html"), "N23157381A")
    assert result["parse_ok"] is True
    assert result["price"] == 320.0
    assert result["original_price"] == 640.0
    assert result["seller"] == "noon"
    assert result["parser_used"] == "embedded_payload"


def test_search_finds_sku_in_product_cards():
    result = parse_search(_read("list_sample.html"), "N11111111A")
    assert result["parse_ok"] is True
    assert result["price"] == 250.0
    assert result["original_price"] == 500.0


def test_search_returns_not_found_for_unknown_sku():
    result = parse_search(_read("list_sample.html"), "N00000000A")
    assert result["parse_ok"] is False


def test_list_parser_drops_priceless_items():
    # parse_products_from_html returns the first non-empty parser (embedded),
    # so the card product is not in this result — it is found by parse_search.
    products = parse_products_from_html(_read("list_sample.html"))
    assert [p["sku"] for p in products] == ["N23157381A"]


def test_akamai_challenge_is_not_mistaken_for_a_page():
    challenge = '<html><body><div id="sec-if-cpt-container"></div></body></html>'
    assert _is_akamai_challenge(challenge)
    assert not _is_akamai_challenge(_read("pdp_sample.html"))

from datetime import datetime, timezone

from pipeline.dates import parse_range
from pipeline.dedupe import dates_overlap
from pipeline.normalize import canonical_url, parse_money, title_key, to_usd
from pipeline.sources.mlh import current_seasons


def d(y, m, day, end=False):
    return datetime(y, m, day, 23, 59, 59, tzinfo=timezone.utc) if end else datetime(y, m, day, tzinfo=timezone.utc)


def test_parse_range_formats():
    assert parse_range("Aug 31 - Oct 23, 2026") == (d(2026, 8, 31), d(2026, 10, 23, True))
    assert parse_range("Oct 05 - 23, 2026") == (d(2026, 10, 5), d(2026, 10, 23, True))
    assert parse_range("Dec 20, 2026") == (d(2026, 12, 20), d(2026, 12, 20, True))
    assert parse_range("Dec 01, 2026 - Jan 15, 2027") == (d(2026, 12, 1), d(2027, 1, 15, True))
    assert parse_range("Dec 20 - Jan 05, 2027") == (d(2026, 12, 20), d(2027, 1, 5, True))
    assert parse_range("sometime soon") == (None, None)
    assert parse_range(None) == (None, None)


def test_canonical_url():
    assert canonical_url("HTTPS://WWW.Example.com/Event/?utm_source=x&b=2&a=1#top") == \
        "https://example.com/Event?a=1&b=2"
    assert canonical_url("//foo.devpost.com/") == "https://foo.devpost.com"
    assert canonical_url("http://hacknc.com/") == "https://hacknc.com"


def test_title_key():
    assert title_key("HackNC 2026") == title_key("HackNC") == "hacknc"
    assert title_key("The TUM Blockchain & AI Hackathon") == "tumblockchainai"


def test_parse_money():
    assert parse_money("$138,000") == (138000, "USD")
    assert parse_money("$CAD 10,000") == (10000, "CAD")
    assert parse_money("₹ 50,000") == (50000, "INR")
    assert parse_money("€50k in prizes") == (50000, "EUR")
    assert parse_money("lots of swag") == (None, None)
    assert to_usd(1000, "EUR") == 1080
    assert to_usd(1000, None) is None


def test_dates_overlap():
    assert dates_overlap(d(2026, 10, 9), d(2026, 10, 11), d(2026, 10, 10), d(2026, 10, 10)) is True
    assert dates_overlap(d(2026, 10, 9), d(2026, 10, 11), d(2027, 10, 10), d(2027, 10, 11)) is False
    assert dates_overlap(None, None, d(2026, 1, 1), None) is None


def test_mlh_season():
    assert current_seasons(d(2026, 10, 11)) == [2027]
    assert current_seasons(d(2027, 2, 1)) == [2027]
    assert current_seasons(d(2027, 6, 1)) == [2027, 2028]


def test_devpost_prize_parsing():
    from bs4 import BeautifulSoup

    from pipeline.sources.devpost import parse_prizes

    html = """<div id="prizes">
      <div class="prize"><h6><div class="prize-title"><span></span><div>Grand Prize</div></div></h6>
        <div class="prize-content"><div class="prize-value"><span data-currency="true">€
        <span data-currency-value>10,000</span></span> in cash</div>
        <div class="prize-winners">1 winner</div><p>• Mentoring<br>• Swag</p></div></div>
      <div class="prize"><h6><div class="prize-title"><div>Company Challenge</div></div></h6>
        <div class="prize-content"><div class="prize-value"><span>$<span>2,000</span></span> in cash</div>
        <div class="prize-winners">15 winners</div><p></p></div></div>
      <div class="prize"><h6><div class="prize-title"><div>Best Design</div></div></h6>
        <div class="prize-content"><div class="prize-winners">1 winner</div><p>• Hardware kit</p></div></div>
    </div>"""
    prizes = parse_prizes(BeautifulSoup(html, "lxml"))
    assert [p["name"] for p in prizes] == ["Grand Prize", "Company Challenge", "Best Design"]
    assert prizes[0]["amount_text"] == "€10,000" and prizes[0]["amount_usd"] == 10800
    assert prizes[0]["perks"] == ["Mentoring", "Swag"]
    assert prizes[1]["winners"] == 15 and prizes[1]["amount_usd"] == 2000
    assert prizes[2]["amount_text"] is None and prizes[2]["perks"] == ["Hardware kit"]

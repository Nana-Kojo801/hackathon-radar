"""Parsing tests for the API-based adapters, on trimmed copies of real responses (no network)."""

import json
from datetime import datetime, timezone

from pipeline.sources import ethglobal, hackerearth, taikai, unstop

NOW = datetime(2026, 10, 11, tzinfo=timezone.utc)


def test_unstop_item():
    item = {
        "id": 1768977,
        "title": "Pitch//break: The Survival Arena",
        "seo_url": "https://unstop.com/hackathons/pitchbreak-1768977",
        "region": "offline",
        "end_date": "2026-10-18T00:00:00+05:30",
        "organisation": {"name": "USAR, GGSIPU EDC"},
        "prizes": [
            {"rank": "1st", "cash": 15000, "currency": "fa-rupee", "currencyCode": None, "others": ""},
            {"rank": "2nd", "cash": 5000, "currency": "fa-rupee", "currencyCode": None, "others": "Goodies"},
            {"rank": "Participation", "cash": 0, "currency": None, "others": ""},
        ],
        "regnRequirements": {
            "end_regn_dt": "2026-10-18T00:00:00+05:30",
            "min_team_size": 1,
            "max_team_size": 4,
            "eligibility": json.dumps({"sector": ["students"]}),
        },
        "address_with_country_logo": {"city": "East Delhi", "state": "Delhi", "country": {"name": "India"}},
        "filters": [{"name": "Engineering Students", "type": "eligible"}, {"name": "Tech", "type": "category"}],
        "details": "<p><strong>Build under pressure.</strong></p><p>Pitch with conviction.</p>",
        "logoUrl2": "https://cdn.example/logo.jpg",
    }
    r = unstop.to_listing(item)
    assert r.title == "Pitch//break: The Survival Arena"
    assert r.format == "in_person"
    assert r.location_text == "East Delhi, Delhi, India"
    assert r.prize_text == "₹20,000 in cash prizes"
    assert r.prize_usd == 240.0  # INR at the fixed rate
    assert [p["amount_text"] for p in r.prizes] == ["₹15,000", "₹5,000"]
    assert r.prizes[1]["perks"] == ["Goodies"]
    assert r.student_only is True
    assert r.registration_deadline.isoformat() == "2026-10-18T00:00:00+05:30"
    assert "Engineering Students" in r.description and "Build under pressure." in r.description


def test_unstop_eligibility_open_to_professionals():
    item = {"title": "X", "seo_url": "https://unstop.com/x", "regnRequirements": {"eligibility": '{"sector":["students","corporates"]}'}}
    assert unstop.to_listing(item).student_only is False
    item["regnRequirements"]["eligibility"] = "[]"
    assert unstop.to_listing(item).student_only is None


def _taikai(**over):
    c = {
        "name": "Hack4Guimarães 2035",
        "slug": "hack4guimaraes2035",
        "shortDescription": "Shape the city of 2035.",
        "prize": 20000,
        "prizeDecimals": 0,
        "prizeCurrency": {"name": "EUR"},
        "organization": {"name": "CM Guimarães", "slug": "cmguimaraes", "city": "Guimarães", "country": "Portugal"},
        "allowedParticipants": "CROWD",
        "endParticipantRegistrationDate": "2026-10-19T08:30:00.000Z",
        "steps": [{"name": "Final", "startDate": "2026-10-28T16:00:00.000Z"}, {"name": "Kickoff", "startDate": "2026-09-15T08:00:00.000Z"}],
        "tabs": [{"title": "overview", "content": "<p>Three days of building.</p>"}, {"title": "prizes", "content": "1st place: 10.000€"}],
        "coverImageFile": {"url": "https://storage.example/cover.png"},
    }
    c.update(over)
    return c


def test_taikai_challenge():
    r = taikai.to_listing(_taikai(), now=NOW)
    assert r.source_url == "https://taikai.network/cmguimaraes/hackathons/hack4guimaraes2035"
    assert r.prize_usd == 21600.0 and r.prize_text == "EUR 20,000"
    assert r.start_date.isoformat().startswith("2026-09-15") and r.end_date.isoformat().startswith("2026-10-28")
    assert "Prizes:\n1st place: 10.000€" in r.description
    assert r.location_text == "Guimarães, Portugal"


def test_taikai_skips_stale_open_flag():
    stale = _taikai(endParticipantRegistrationDate="2025-05-14T20:59:00.000Z", steps=[{"name": "End", "startDate": "2025-05-17T14:30:00.000Z"}])
    assert taikai.to_listing(stale, now=NOW) is None


def test_ethglobal_rsc_extraction():
    event = {
        "id": 527, "name": "ETHGlobal Mumbai", "slug": "mumbai", "type": "hackathon", "medium": "physical",
        "startTime": "2026-11-05T00:00:00.000Z", "endTime": "2026-11-07T00:00:00.000Z", "status": "future",
        "signupDeadline": "2026-11-03T18:29:00.000Z", "city": {"name": "Mumbai", "country": {"name": "India"}},
    }
    summit = {"id": 9, "name": "ETHConf", "slug": "ethconf", "type": "summit", "status": "future"}
    compact = {"separators": (",", ":")}  # as in the real payload
    payload = '0:["$",' + json.dumps(event, **compact) + "," + json.dumps(summit, **compact) + "]"
    html = "<script>self.__next_f.push([1," + json.dumps(payload) + "])</script>"
    events = ethglobal.events_from(ethglobal.rsc_text(html))
    assert {e["slug"] for e in events} == {"mumbai", "ethconf"}
    r = ethglobal.ETHGlobalSource.__new__(ethglobal.ETHGlobalSource)._to_listing(events[0], 157500.0, "medium")
    assert r.source_url == "https://ethglobal.com/events/mumbai"
    assert r.format == "in_person" and r.location_text == "Mumbai, India"
    assert r.registration_deadline.isoformat().startswith("2026-11-03")


def test_ethglobal_prize_header():
    html = "<header><div><h2>$100,000</h2><h3>Available in prizes</h3></div></header>"
    assert ethglobal.prize_from_event_page(html) == 100000.0
    prizes = 'self.__next_f.push([1,' + json.dumps('{"sponsors":[{"prizeAmount":20000},{"prizeAmount":7500}]}') + '])'
    assert ethglobal.prize_from_prizes_page(prizes) == 27500.0


def test_hackerearth_filters_hackathons_that_have_not_ended():
    base = {"url": "/challenges/hackathon/agentic-banking/", "start": "2026-10-05T14:30:00", "company_name": "Airwallex"}
    live = hackerearth.to_listing({**base, "title": "Agentic Banking Hackathon", "type": "Hackathon", "end": "2026-11-13T18:29:00"}, now=NOW)
    assert live.source_url == "https://www.hackerearth.com/challenges/hackathon/agentic-banking/"
    assert live.end_date.tzinfo is not None and live.registration_deadline == live.end_date
    named = hackerearth.to_listing({**base, "title": "GoDaddy Inclusive Innovation Hackathon", "type": "Competitive", "end": "2026-11-01T07:30:00"}, now=NOW)
    assert named is not None
    assert hackerearth.to_listing({**base, "title": "Weekly Coding Contest", "type": "Competitive", "end": "2026-11-01T07:30:00"}, now=NOW) is None
    assert hackerearth.to_listing({**base, "title": "Old Hackathon", "type": "Hackathon", "end": "2021-10-31T10:30:00"}, now=NOW) is None

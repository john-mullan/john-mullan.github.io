"""Regenerate events.json from a public Google Calendar ICS feed.

Reads the feed URL from the ICS_URL environment variable and writes events.json
in the repo root. Designed to run in GitHub Actions on a schedule; safe to run
locally too:  ICS_URL="https://calendar.google.com/.../basic.ics" python scripts/ics_to_events.py

Calendar conventions (all optional, one per line in the event description):
    title: Evensong with The Thirteen        (overrides the calendar entry's name)
    ensemble: The Thirteen
    ensembleUrl: https://www.thethirteenchoir.org
    tickets: https://example.com/tickets     (also accepts "url:" or "details:")
    venue: Washington National Cathedral     (overrides the location field)
Everything else: event title -> program title, location -> venue, start -> date/time.
Events whose name contains "not confirmed", "tentative", "hold", or "?" are
skipped, as is anything with a line "skip" or "private" in its description.
Recurring events are exported by Google as single VEVENTs per occurrence only if
"expand recurring" is on in the feed; otherwise only the first occurrence appears.
"""
import json
import os
import re
import sys
import urllib.request
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

LOCAL_TZ = ZoneInfo(os.environ.get("SITE_TZ", "America/New_York"))
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "events.json")
ENSEMBLES = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "ensembles.json")


def load_ensemble_urls():
    try:
        with open(ENSEMBLES, encoding="utf-8") as f:
            entries = json.load(f)
    except (OSError, ValueError):
        return {}
    return {re.sub(r"\s+", " ", name).strip().casefold(): url
            for name, url in entries.items() if isinstance(url, str) and url.strip()}


ENSEMBLE_URLS = load_ensemble_urls()


def unfold(text):
    # ICS folds long lines with CRLF + single space/tab
    return re.sub(r"\r?\n[ \t]", "", text).splitlines()


def unescape(value):
    return (value.replace("\\n", "\n").replace("\\,", ",")
                 .replace("\\;", ";").replace("\\\\", "\\"))


def parse_calendar_datetime(params, value):
    if re.fullmatch(r"\d{8}", value):  # all-day
        return datetime.strptime(value, "%Y%m%d"), False
    dt = datetime.strptime(value.rstrip("Z"), "%Y%m%dT%H%M%S")
    if value.endswith("Z"):
        dt = dt.replace(tzinfo=timezone.utc).astimezone(LOCAL_TZ)
    elif "TZID" in params:
        try:
            dt = dt.replace(tzinfo=ZoneInfo(params["TZID"])).astimezone(LOCAL_TZ)
        except Exception:
            pass  # keep naive time as-is
    return dt, True


def fmt_time(dt):
    hour = dt.hour % 12 or 12
    return "%d:%02d %s" % (hour, dt.minute, "am" if dt.hour < 12 else "pm")


def trim_location(loc):
    # Google locations are often full postal addresses; keep the venue-ish part:
    # everything before the first segment that starts with a street number.
    parts = [p.strip() for p in loc.split(",") if p.strip()]
    keep = []
    for part in parts:
        if keep and re.match(r"^\d", part):
            break
        keep.append(part)
        if len(keep) == 2:
            break
    return ", ".join(keep) if keep else loc


def parse_events(ics_text):
    events = []
    current = None
    for line in unfold(ics_text):
        if line == "BEGIN:VEVENT":
            current = {}
        elif line == "END:VEVENT":
            if current is not None and "DTSTART" in current and "SUMMARY" in current:
                events.append(current)
            current = None
        elif current is not None and ":" in line:
            name, value = line.split(":", 1)
            name, *param_parts = name.split(";")
            params = dict(p.split("=", 1) for p in param_parts if "=" in p)
            current[name.upper()] = (params, value)
    out = []
    for raw in events:
        title = unescape(raw["SUMMARY"][1]).strip()
        description = unescape(raw["DESCRIPTION"][1]) if "DESCRIPTION" in raw else ""
        if re.search(r"not\s+confirmed|tentative|\bhold\b|\?", title, re.I):
            continue
        if re.search(r"^\s*(skip|private)\s*$", description, re.I | re.M):
            continue
        params, value = raw["DTSTART"]
        try:
            dt, timed = parse_calendar_datetime(params, value)
        except ValueError:
            continue
        event = {"date": dt.strftime("%Y-%m-%d")}

        end_date = None
        if "DTEND" in raw:
            end_params, end_value = raw["DTEND"]
            try:
                end_dt, _ = parse_calendar_datetime(end_params, end_value)
                # In ICS, an all-day DTEND is exclusive. Google represents an
                # Oct. 4-6 event with DTEND on Oct. 7.
                if not timed:
                    end_dt -= timedelta(days=1)
                if end_dt.date() > dt.date():
                    end_date = end_dt.strftime("%Y-%m-%d")
                    event["endDate"] = end_date
            except ValueError:
                pass

        # Present multi-day engagements as date ranges without potentially
        # misleading start times.
        if timed and not end_date:
            event["time"] = fmt_time(dt)
        event["title"] = title
        if "LOCATION" in raw and raw["LOCATION"][1].strip():
            event["venue"] = trim_location(unescape(raw["LOCATION"][1]))
        if "URL" in raw and raw["URL"][1].strip():
            event["url"] = raw["URL"][1].strip()
        for dline in description.splitlines():
            m = re.match(r"\s*(title|ensembleurl|ensemble|tickets|url|details|venue)\s*:\s*(.+)", dline, re.I)
            if not m:
                continue
            key, val = m.group(1).lower(), m.group(2).strip()
            if key == "title":
                event["title"] = val
            elif key == "ensemble":
                event["ensemble"] = val
            elif key == "ensembleurl":
                event["ensembleUrl"] = val
            elif key == "venue":
                event["venue"] = val
            else:  # tickets / url / details
                event["url"] = val
        event.setdefault("ensemble", "")
        if event["ensemble"] and not event.get("ensembleUrl"):
            key = re.sub(r"\s+", " ", event["ensemble"]).strip().casefold()
            if key in ENSEMBLE_URLS:
                event["ensembleUrl"] = ENSEMBLE_URLS[key]
        event.setdefault("venue", "")
        out.append(event)
    out.sort(key=lambda e: e["date"], reverse=True)
    return out


def main():
    url = os.environ.get("ICS_URL")
    if not url:
        sys.exit("ICS_URL is not set — add the calendar's public ICS address "
                 "as a repository secret named GIGS_ICS_URL (see README).")
    with urllib.request.urlopen(url, timeout=60) as resp:
        ics_text = resp.read().decode("utf-8", errors="replace")
    events = parse_events(ics_text)
    if not events:
        sys.exit("Parsed 0 events — refusing to overwrite events.json. "
                 "Check that the calendar is public and the ICS URL is right.")
    # Preserve past events already in events.json that the feed doesn't carry,
    # so performance history accumulates even if old calendar entries are removed.
    try:
        with open(OUT, encoding="utf-8") as f:
            existing = json.load(f)
    except (OSError, ValueError):
        existing = []
    today = datetime.now(LOCAL_TZ).strftime("%Y-%m-%d")
    seen = {(e["date"], e["title"].strip().lower()) for e in events}
    for e in existing:
        if e.get("date", "") < today and (e["date"], e.get("title", "").strip().lower()) not in seen:
            events.append(e)
    events.sort(key=lambda e: e["date"], reverse=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(events, f, indent=2, ensure_ascii=False)
        f.write("\n")
    print("Wrote %d events to events.json" % len(events))


if __name__ == "__main__":
    main()

"""Replace the Hawaiʻi Mesonet stations in the Hurricane Nolo rainfall manifest with
daily totals summed from the Mesonet database's 5-minute readings.

The manifest built by build_rainfall_frames.py takes every station's daily total from
HCDP's gap-filled ("partial") station values. For Mesonet stations those can differ
from the 5-minute record the page's hourly section plots (a gap-filled day, or a day
QC removed), so this rewrites them from the same source the hourly section uses:
RF_1_Tot300s, unflagged readings, a day being the readings stamped after 00:00 and
up to 24:00 HST. Other networks keep their HCDP values.

A station-day counts only when at least MIN_COVER of its 288 readings are present;
the "All" total keeps only stations that counted on every day, as before.

Run from dews-hawaii-app/ after build_rainfall_frames.py (rerunning is safe):
    python3 scripts/nolo_mesonet_rain.py
Reads the token from src/environments/environment.ts. Writes manifest.json and
manifest.js in public/hurricane-nolo/data/rain/.
"""
import datetime as dt
import json
import pathlib
import re
from collections import defaultdict

import requests

APP = pathlib.Path(__file__).resolve().parent.parent
RAIN = APP / "public" / "hurricane-nolo" / "data" / "rain"
API = "https://api.hcdp.ikewai.org/mesonet/db"
VAR = "RF_1_Tot300s"            # 5-minute rainfall total, mm
MM_PER_IN = 25.4
SLOTS_PER_DAY = 288
MIN_COVER = 0.8                 # share of a day's 5-minute readings needed to count it
HST = dt.timezone(dt.timedelta(hours=-10))
JS_PREFIX = "window.RAIN_DAYS = "


def token():
    text = (APP / "src" / "environments" / "environment.ts").read_text()
    return re.search(r"apiToken\s*:\s*['\"]([^'\"]+)['\"]", text).group(1)


def day_totals(session, date):
    """station id -> (inches, readings) for one HST day."""
    start = dt.datetime.fromisoformat(date).replace(tzinfo=HST) + dt.timedelta(minutes=5)
    end = start + dt.timedelta(days=1) - dt.timedelta(minutes=5)
    r = session.get(API + "/measurements", params={
        "location": "hawaii", "var_ids": VAR, "row_mode": "json", "limit": 2000000,
        "start_date": start.astimezone(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "end_date": end.astimezone(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")}, timeout=300)
    r.raise_for_status()
    sums, counts = defaultdict(float), defaultdict(int)
    for row in r.json():
        if row["flag"] != 0 or row["value"] in (None, ""):
            continue
        sums[row["station_id"]] += float(row["value"]) / MM_PER_IN
        counts[row["station_id"]] += 1
    return {sid: (sums[sid], counts[sid]) for sid in counts}


def entry(st, inches):
    return {"skn": str(st["skn"]) if st.get("skn") else None, "id": st["station_id"],
            "name": st.get("full_name") or st.get("name") or st["station_id"],
            "network": "HiMesonet", "observer": "HiMesonet", "mesonet": True,
            "lat": float(st["lat"]), "lon": float(st["lng"]), "inches": round(inches, 2)}


def main():
    s = requests.Session()
    s.headers["Authorization"] = "Bearer " + token()
    r = s.get(API + "/stations", params={"location": "hawaii"}, timeout=120)
    r.raise_for_status()
    meta = {m["station_id"]: m for m in r.json() if m.get("lat") and m.get("lng")}

    js = (RAIN / "manifest.js").read_text()
    full = json.loads(js[len(JS_PREFIX):].rstrip().rstrip(";"))   # with the embedded PNGs
    totals, counted = defaultdict(float), defaultdict(int)
    for day in full["days"]:
        got = day_totals(s, day["date"])
        keep = [x for x in day["stations"] if not x["mesonet"]]
        added = 0
        for sid, (inches, n) in got.items():
            if sid in meta and n >= MIN_COVER * SLOTS_PER_DAY:
                keep.append(entry(meta[sid], inches))
                totals[sid] += inches
                counted[sid] += 1
                added += 1
        day["stations"] = sorted(keep, key=lambda x: -x["inches"])
        print(f"{day['date']}: {added} Mesonet stations, {len(keep) - added} others")

    if full.get("total"):
        n_days = len(full["days"])
        keep = [x for x in full["total"]["stations"] if not x["mesonet"]]
        keep += [entry(meta[sid], totals[sid]) for sid in totals if counted[sid] == n_days]
        full["total"]["stations"] = sorted(keep, key=lambda x: -x["inches"])
        print(f"total: {sum(1 for x in keep if x['mesonet'])} Mesonet stations on every day")
    full["mesonet_stations"] = f"Hawaiʻi Mesonet {VAR}, unflagged, >= {MIN_COVER:.0%} of readings per day"

    (RAIN / "manifest.js").write_text(JS_PREFIX + json.dumps(full, ensure_ascii=False, separators=(",", ":")) + ";\n")
    for day in full["days"] + ([full["total"]] if full.get("total") else []):
        day.pop("data", None)
    (RAIN / "manifest.json").write_text(json.dumps(full, ensure_ascii=False, separators=(",", ":")))


if __name__ == "__main__":
    main()

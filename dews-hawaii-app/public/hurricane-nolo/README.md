# Hurricane Nolo Wind and Rainfall

A single-page web map, `nolo_wind_rainfall.html`, covering Hurricane Nolo's pass
south of Hawaiʻi Island and its turn north toward Kauaʻi, from the start of
23 September 2026 to the end of 2 October 2026. It is the Hurricane Lowell viewer rebuilt for Nolo, with the
two sections whose data exist for this storm, in this order on the page:

1. **Wind Gusts and Rainfall, Every 15 Minutes** — a Hawaiʻi Mesonet animation
   of hourly peak gust and hourly rainfall, stepped every 15 minutes from
   23 Sep 00:00 HST to 3 Oct 00:00 HST, over GOES-West infrared imagery, with the
   storm track and a per-station chart of the whole period.
2. **How Much Rain Fell, Day by Day** — HCDP statewide daily rainfall maps for
   23 September to 2 October with every reporting station's daily total, plus an
   **All** map of the total over those ten days. The text beside the map follows
   the selected day.

The Lowell page's WindNinja wind-map section and its storm-surf section are not
on this page: no WindNinja runs and no wave figure exist for Nolo. If they are
produced later, the Lowell scripts (`build_wind_frames.py`) and markup carry
across unchanged.

Everything except the Mesonet API calls is precomputed into small files under
`data/`, so the page runs from a bare `file://` URL or from the bundled local
server.
This folder is the self-contained distribution: it holds the page, the packed
data, the logos, Leaflet and the processing scripts, but not the raw GOES files
or the API token. See `HOW_TO_RUN.txt` for the two ways to open it.

## Running it

```
start_map.bat                   # serves this folder on port 8418 and opens the page
```

or open `nolo_wind_rainfall.html` directly. Opened from a file, the page asks
you to pick your token file, or paste the token, once per browser session.
Served, it reads `hi_meso_token.txt` automatically if you put that file beside
the page; the distribution does not include a token.

The page needs the HCDP mesonet token for section 1 only. Section 2 reads its
data from `data/rain/manifest.js` and needs nothing else. The token is kept in
the tab's session storage and sent only to the HCDP API.

## Page anatomy

| Section | Data files read by the page | Notes |
|---|---|---|
| 1. Mesonet animation | `data/goes/frames.js` + WebP frames, live HCDP mesonet API | 961 GOES frames at 15 min |
| 1. Storm track | `data/track_nolo.js` | 40 six-hourly best-track fixes, 23 Sep 00 UTC to 2 Oct 18 UTC |
| 2. Rainfall | `data/rain/manifest.js` | 10 daily statewide frames, 23 Sep – 2 Oct, and their total; opens on the 26th, zoomed to Hawaiʻi Island |
| Both maps | `data/coastline_hawaii.js` | State of Hawaiʻi coastline, drawn in yellow |
| Logos | `mn_logo.png`, `logo.png` | see below |

Each manifest exists as both `.json` (for a served page) and `.js` (a script
setting a `window.*` global, so a `file://` page can load it). The rainfall
manifest carries its PNG frames inline as data URLs so the hover readout can
read the pixels back even from a `file://` page.

### Logos and links

| Logo | Where | Links to |
|---|---|---|
| `mn_logo.png`, Hawaiʻi Mesonet, 72 px tall | top right of the 15-minute map | https://www.hawaii.edu/climate-data-portal/hawaii-mesonet-data/#/ |
| `logo.png`, HCDP wordmark | top right of the rainfall map | https://www.hawaii.edu/climate-data-portal/ |

Both open in a new tab. The Mesonet logo's height is the `.logo-ctl img` rule in
the page's style block.

### Text on the page

Section 1 carries three paragraphs, set 12 px apart: the overview of the storm
(formation, watches and warnings, closest approach, peak strength, strongest
gusts, emergency declarations), then how to read the animation, then how to use
the chart and the two find buttons. Section 2 carries the rainfall account, one
paragraph per day from 24 September to 2 October, and a closing paragraph on how to
use the map. The sources are listed at the end of this file.

### Mesonet animation (section 1)

* Observations: HCDP Mesonet API `/mesonet/db/measurements`, variables
  `RF_1_Tot300s` (5-minute rainfall, mm), `WG_1_Max` (5-minute peak gust, m/s)
  and `WDrs_1_Avg` (direction, degrees from), fetched live for the whole period
  when the page loads in day-sized requests sent together, about 400,000
  observations from 77 rain and 71 gust stations. Each frame is the trailing hour: rain summed to inches per hour,
  gust the hour's maximum in mph, direction from the 5 minutes that held the
  peak gust.
* Colour scales are fixed and pseudo-log spaced: **rain 0–1 in/hr**, **gusts
  0–70 mph**. The period's peaks were 2.01 in/hr at Common Ground in
  Kīlauea, Kauaʻi (1 Oct 23:15 HST), which tops the rain ramp, and 67.2 mph at
  Puʻuloa in Kohala (26 Sep 04:15 HST).
* Higher values are drawn on top of lower ones in both modes: rain circles are
  drawn in rising order, gust pills are stacked by the gust value itself. The
  selected station is always on top.
* Base map: GOES-18 (GOES-West) ABI Level 2 CMIPF band 13 clean longwave
  infrared from the NOAA Open Data bucket `noaa-goes18` on AWS, one full-disk
  file per 15-minute frame, cut to the box −167.95, 13.06 to −145.73, 28.08,
  turned into a plain grey ramp (200 K white to 310 K black) and warped to Web
  Mercator. Built by `fetch_goes_aws.py`; the period lives in
  `fetch_goes_frames.py` (`FIRST`, `LAST`), which also holds the projection
  helpers. About 23 GB of NetCDF passes through for the 961 frames, 49.8 MB of
  WebP once rendered; each NetCDF is deleted after its frame is written. The
  downloader retries dropped connections, and a rerun keeps the frames already
  on disk, so an interrupted run can simply be started again.
* Storm track: the National Hurricane Center's ATCF best-track file for
  EP152026 (`https://ftp.nhc.noaa.gov/atcf/btk/bep152026.dat`), one fix every
  6 hours with position, maximum sustained wind and central pressure. Nolo is
  East Pacific system 15: it formed as Tropical Depression Fifteen-E and was
  named by the Central Pacific Hurricane Center after it regenerated. Built by
  `build_track.py` into `data/track_nolo.js`. The map draws the whole track as
  a dashed line, the part already travelled at the time on screen as a solid
  line, a dot for every fix coloured by Saffir-Simpson category, and a storm
  symbol at the position interpolated to the frame. Hover a dot or the symbol
  for time, category, wind and pressure. The box under the logo is the key
  and switches the track off and on. The file is preliminary while the storm
  is active; rerun the script for new fixes. `build_track.py` keeps only the fixes inside the GOES frames (east of
  `BBOX`'s western edge, 167.95°W): the center crosses it on the afternoon of
  2 October, so the last fix is 2 Oct 08:00 HST. After that the animation runs
  on to 00:00 HST on 3 October with the whole track drawn but no storm symbol.
* The map opens on the statewide extent pushed west and south so the track
  south of Hawaiʻi Island is in view (`EXTENT_BOX` in the page's script).
* The page's own period is set by `FIRST` and `LAST` near the top of its
  script. To extend the animation to a later time, move `LAST` in
  `fetch_goes_frames.py`, rerun `fetch_goes_aws.py`, move `LAST` in the page
  to match, and rerun `build_track.py`.

### Rainfall (section 2)

* Source: HCDP API, `/raster?datatype=rainfall&production=new&period=day&extent=statewide`
  (250 m statewide daily rainfall, mm) and `/stations` (`hcdp_station_value`
  daily totals with `partial` fill, joined to `hcdp_station_metadata` by SKN).
* Built by `build_rainfall_frames.py` (the default `DATES` are 23 Sep to 2 Oct); pass
  `--env path/to/environment.ts` to read the token from the Angular app instead of
  `hi_meso_token.txt`.
  Each day is one lossless RGB PNG, code = round(inches × 100) in R and G, B
  marks cells with data. The manifest is rebuilt from the dates given, so
  pass every day you want on the page. The manifest's `total` is the grid summed
  over every day given, with station totals only for stations that reported on
  all of them.
* Stations are drawn as circles for the Hawaiʻi Mesonet and squares for the
  other networks.

## Files

```
nolo_wind_rainfall.html     the page
README.md                   this file
start_map.bat, serve.py     local server on port 8418 (no-cache headers)
HOW_TO_RUN.txt              the short version
vendor/leaflet.css, .js     Leaflet 1.9.4, bundled so no CDN is needed
logo.png                    HCDP wordmark
mn_logo.png                 Hawaiʻi Mesonet logo, 320 px copy
fetch_goes_frames.py        period, bounding box, projection and manifest helpers
fetch_goes_aws.py           builds data/goes/ from the AWS archive
build_rainfall_frames.py    builds data/rain/ from the HCDP API
build_track.py              builds data/track_nolo.js from the NHC best track
build_coastline_geojson.py  rebuilds data/coastline_hawaii.js from the state shapefile
data/goes/                  frames.json, frames.js and one WebP per 15 minutes
data/rain/                  manifest.json, manifest.js and one PNG per day
data/track_nolo.js, .json   the storm track
data/coastline_hawaii.js, .geojson
```

Requires Python with numpy, pillow, rasterio, pyproj and requests for the
builders; the page itself needs only a browser and, for section 1, the token.
`build_rainfall_frames.py` needs `hi_meso_token.txt` beside it, and
`build_coastline_geojson.py` needs the State of Hawaiʻi coastline shapefile;
neither input is in this folder.

## Sources for the text

* Hurricane Nolo, Wikipedia: https://en.wikipedia.org/wiki/Hurricane_Nolo
* Hawaiʻi Emergency Management Agency, Hurricane Nolo updates:
  https://dod.hawaii.gov/hiema/tropical-storm-nolo-updates/
* Honolulu Star-Advertiser, 26 Sep 2026 live coverage:
  https://www.staradvertiser.com/2026/09/26/breaking-news/hurricane-nolo-meanders-south-of-hawaii-island-bringing-showers-and-gusty-winds/
* Hawaii Tribune-Herald, 26 Sep 2026:
  https://www.hawaiitribune-herald.com/2026/09/26/hawaii-news/hurricane-nolo-meanders-south-of-hawaii-island/
* NBC News, 25–26 Sep 2026:
  https://www.nbcnews.com/news/us-news/hurricane-nolo-expected-bring-heavy-rain-skirts-hawaiis-big-island-rcna599924
* The Weather Channel, 28 Sep 2026:
  https://weather.com/2026/09/27/storms/hurricane/hawaii-hurricane-nolo-flooding-wind-forecast
* Storm track: NOAA National Hurricane Center ATCF best track, preliminary:
  https://ftp.nhc.noaa.gov/atcf/btk/bep152026.dat
* Rainfall figures in the text are the HCDP daily station totals and grid
  values in `data/rain/`, as built on 6 October 2026. The Mesonet peak gust
  and peak rain rate are from the page's own load of the Mesonet API on
  5 October 2026.

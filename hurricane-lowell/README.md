# Hurricane Lowell Wind and Rainfall

A single-page web map, `rainfall_rate_animation.html`, that tells the story of
Hurricane Lowell's passage over Kauaʻi and Oʻahu on 7–8 September 2026 with
four stacked sections:

1. **Mapping Hurricane Lowell's Winds, Hour by Hour** — WindNinja 250 m wind
   maps, one per hour, for Kauaʻi, Oʻahu, or both, drawn over GOES-West
   infrared imagery with the station observations that fed each run.
2. **How Much Rain Fell, Day by Day** — HCDP statewide daily rainfall maps for
   6, 7 and 8 September with every reporting station's daily total.
3. **Kauaʻi Coastal Impacts Storm Surf** — a PacIOOS wave-height figure with a
   short account of the surf and surge damage.
4. **Wind Gusts and Rainfall, Every 15 Minutes** — a Hawaiʻi Mesonet animation
   of hourly peak gust and hourly rainfall, stepped every 15 minutes from
   7 Sep 00:00 to 8 Sep 12:00 HST, over the same GOES-West imagery, with a
   per-station chart of the whole storm.

Everything except the Mesonet API calls is precomputed into small files under
`data/`, so the page runs from a bare `file://` URL or from the bundled local
server. This folder is the self-contained distribution: it holds the page, the
packed data, the images and the processing scripts, but not the raw inputs
(the WindNinja GeoTIFFs, the raw GOES files, the API token). See
`HOW_TO_RUN.txt` for the two ways to open it.

## Running it

```
start_rate_animation.bat        # serves the folder on port 8414 and opens the page
```

or open `rainfall_rate_animation.html` directly. The page needs an HCDP
mesonet API token for section 4 only; sections 1–3 read their data from the
manifests under `data/` and need nothing else. No token is included here.
Opened from a file, the page asks you to pick a token file or paste the token
once per browser session; served, it reads `hi_meso_token.txt` automatically
if you place that file beside the page.

## Page anatomy

| Section | Data files read by the page | Notes |
|---|---|---|
| Wind maps | `data/wind_ka/manifest.js`, `data/wind_oa/manifest.js` | 36 hourly frames each, 7 Sep 00:00 – 8 Sep 11:00 HST |
| Rainfall | `data/rain/manifest.js` | 3 daily statewide frames, 6–8 Sep |
| Surf | `wave_lowell.png` | static image, PacIOOS |
| Mesonet animation | `data/goes/frames.js` + WebP frames, live HCDP mesonet API | 145 GOES frames at 15 min |
| All maps | `data/coastline_hawaii.js`, `logo.png` | coastline and HCDP wordmark |

Each manifest exists as both `.json` (for a served page) and `.js` (a script
setting a `window.*` global, so a `file://` page can load it). The wind and
rainfall manifests also carry their PNG frames inline as data URLs: a canvas
cannot read pixels back from an image loaded off a `file://` URL, but an inline
data URL counts as same-origin, and reading the pixels back is what makes the
hover readouts work.

### Wind maps (section 1)

* Source: WindNinja point-initialisation runs produced by the HCDP pipeline,
  one per hour per county, in `data/20260907/` and `data/20260908/`
  (`<HH00>/<county>/spd_dir_wind/*_vel_mps_wgs84.tif` and
  `*_dir_deg_wgs84.tif`, plus `stationData/*_wn_input_sta.csv`). EPSG:4326,
  0.00225° (≈250 m), 10 m wind speed in m/s and direction in degrees from.
* Views: Oahu, Kauai, and Kauai & Oahu (both rasters at once). The combined
  view opens at the widest zoom with its upper-right corner at 23.766°N,
  156.56°W, stations and arrows off; the single-island views fit the island
  with arrows, stations and towns on.
* Colour: the gust map's violet-to-red ramp on a fixed pseudo-log scale,
  0–85 mph, with everything over 85 mph in fuchsia. Arrows point downwind,
  length ∝ speed, spaced ~17 px on screen at any zoom.
* Stations: the hour's WindNinja inputs. Hawaiʻi Mesonet stations draw as the
  same pill used on the gust map, other networks as a rectangle, both coloured
  and sized on the map's scale. Popups give name, network, observer, Mesonet
  station id and SKN. Towns are dots with leader lines to offset labels.
* Find bar: "Peak Modeled Wind Hour" jumps to the period's peak hour and zooms
  to the peak cell; "Peak station this hour" zooms to the strongest station of
  the hour on display. The hour's grid min/mean/max sit in the map's upper
  right, and the date and hour are shown in large type in the upper left.
  Hovering reads any cell's speed and direction.
* Time series: clicking anywhere on the map plots that grid cell's modeled
  wind for all 36 hours in a chart under the map; clicking a station plots
  what it measured. A red line marks the map's hour and follows the slider,
  clicking the chart moves the map to that hour, and a ring marks the picked
  point. Clear drops the selection.
* Backdrop: the same GOES-West frame the Mesonet animation shows for that hour.

### Rainfall (section 2)

* Source: HCDP API, `GET /raster` with `datatype=rainfall`, `production=new`,
  `period=day`, `extent=statewide` (250 m, mm) and `GET /stations` with
  `hcdp_station_value` documents (`fill=partial`) joined to
  `hcdp_station_metadata` by SKN.
* Buttons: zoom to Kauai, Oahu, Maui, Hawaii or Statewide, and pick 6, 7 or
  8 September. Opens on Kauaʻi, 7 September.
* Colour: the rain ramp on a fixed pseudo-log scale, 0–30 inches, as on the
  HCDP Hurricane Lala page. Mesonet stations are circles, other networks
  squares, coloured on the same scale. Grid statistics in the upper right are
  for the current zoom box; the stat cards give the stations in view, the
  wettest of them, and the three-day peak cell. Find buttons zoom to the
  wettest cell or station in view.

### Mesonet animation (section 4)

* Source: HCDP mesonet database API (`/mesonet/db/measurements`) at native
  5-minute cadence: `RF_1_Tot300s` (rainfall, mm), `WG_1_Max` (peak gust, m/s)
  and `WDrs_1_Avg` (vector-average direction). Fetched live at page load with
  the token; about 100 k observations for the period.
* Each 15-minute frame covers the trailing hour: rain is the hour's total in
  inches per hour; gust is the hour's strongest 5-minute peak gust in mph, with
  the direction from the 5 minutes that held it. Stations are drawn only when
  they reported in that hour.
* Gusts draw as pills (arrow points downwind, number is mph) coloured on a
  0–80 mph pseudo-log ramp, strongest on top; rain as circles on a 0–4 in/hr
  ramp. Clicking a station charts its whole record; "Highest overall" and
  "Highest this hour" find the peak station.
* Backdrop: GOES-West band 13 infrared, see below.

## Data processing scripts

The scripts are included for reference and reproducibility; the page does not
need them to run. They require Python with numpy, pillow, pyproj, rasterio and
requests, an HCDP API token in `hi_meso_token.txt`, and the raw inputs, which
are not part of this folder. None need a vector library: the shapefile is read
directly.

| Script | What it makes | Source |
|---|---|---|
| `build_coastline_geojson.py` | `data/coastline_hawaii.geojson` and `.js` — the state coastline, simplified to 0.0003° | the State of Hawaiʻi coastline shapefile (NAD83 HARN / UTM 4N), path set at the top of the script; not included |
| `build_wind_frames.py` | `data/wind_<cc>/` — one lossless PNG per hour (R speed code, G direction code, B mask) plus a manifest with each hour's station inputs and their names and networks | WindNinja output placed under `data/<YYYYMMDD>/` (not included); `--county` and repeatable `--span YYYYMMDD:H-H` (default all of 7 Sep plus 00–11 on 8 Sep) |
| `build_rainfall_frames.py` | `data/rain/` — one PNG per day at 0.01-inch precision plus a manifest with every station's daily total | HCDP API raster and stations endpoints; `--dates` to change the days |
| `fetch_goes_aws.py` | `data/goes/` — 145 greyscale WebP frames and `frames.json`/`frames.js`, the base map now in use | NOAA GOES-18 ABI L2 CMIPF band 13 NetCDF from the public `noaa-goes18` bucket on AWS; each 24 MB file is downloaded, cut to the box, rendered and deleted |
| `fetch_goes_frames.py` | The earlier STAR-based base maps (kept as an alternative): `--source fd` full disk, or `--source sector` the 1 km Hawaiʻi sector with a coastline-fitted calibration | NOAA STAR pre-rendered JPGs; not currently used by the page |

Station names and networks for the wind panel come from
`data/Hawaii_Master_Station_Meta.csv` (the ikewai master list the WindNinja
pipeline itself merges on) and `data/mesonet_stations.json` (the mesonet
station list with each station's SKN), both saved locally.

### GOES-West base map

* Product: ABI band 13 clean longwave infrared, 10.3 µm, brightness
  temperature. Cold cloud tops are white, the sea dark: 200 K and colder maps
  to white, 310 K to black.
* Coverage: 13.06–28.08°N, 167.95–145.73°W, the box the page requests, on a
  2000 m Web Mercator grid (the 2 km native resolution of the band).
* Cadence: one frame per 15-minute animation step, using the 10-minute scan at
  or just before it, 7 Sep 00:00 – 8 Sep 12:00 HST.
* Geometry comes from the projection and transform stored in each NetCDF.
  The frames are warped to Web Mercator because a Leaflet image overlay is
  stretched linearly in Web Mercator between its corners; a plain lat/lon grid
  would sit about 10 km too far north at the islands' latitude.

The `fetch_goes_frames.py` route is documented in that script: STAR's full-disk
JPGs are the ABI fixed grid edge to edge (verified against Natural Earth's
global coastline to within one pixel), while the Hawaiʻi sector publishes no
corner coordinates and is georeferenced by cross-correlating the projected
state coastline with the white coastline strokes NOAA draws on the image.

## Narrative text on the page

The final wording of each section, as published. All figures were checked
against the packed data and the sources listed below.

### Mapping Hurricane Lowell's Winds, Hour by Hour

From the afternoon of September 7 into the morning of September 8, Hurricane Lowell passed close by Kauaʻi. It had been a Category 5 storm over the open ocean days earlier and was still a Category 2 hurricane when its center passed about 40 miles west of Niʻihau late that night. Its brush with the island brought powerful wind and high seas. Kauaʻi is a small island with very steep terrain, and the wind that actually crossed its ridges and valleys was almost certainly far stronger than the wind any weather station measured, because the stations sit on the coast and in the lowlands where people live.

This experimental map is our attempt to see that unmeasured wind. It takes the readings from every available wind station on the island each hour and feeds them into a computer model of how wind speeds up, slows down and turns as it flows over mountains and through vegetation. The result is one map per hour showing the average wind over that hour at every point on the island. Average wind is the steady wind you would feel over a whole hour. Gusts are the short, sudden bursts that can be much stronger, and they are not what this map shows.

A few things stand out. The strongest readings from the stations came from the coast, at the Līhuʻe and Port Allen airports, while the strongest modeled winds are up on the ridgelines, just as you would expect. The wind built steadily through the afternoon and evening as Lowell closed in, roughly doubling between four in the afternoon and nine at night, and stayed near its peak until midnight. It then eased through the small hours and was down to ordinary trade wind strength by late morning on September 8.

The peak hour was 11 pm on September 7. In that hour Līhuʻe airport recorded an average wind of 56 mph, the strongest station reading of the storm on Kauaʻi. In the same hour the model put about a third of the island above 60 mph and small patches along the highest ridges above 85 mph, with its single strongest estimate of about 133 mph on the high ground between Mount Kāhili and the southwest side of Waiʻaleʻale, far inland above Kalāheo and Poʻipū.

Treat the highest values as an upper bound rather than a measurement. The model has not been checked against the ground for this storm, and over exposed ridges it can push winds well beyond anything a station could confirm. Hover the map to read the modeled wind at any point, step through the hours with the slider, and switch on the stations to compare the model with what was actually measured.

### How Much Rain Fell, Day by Day

Rain from Lowell arrived a day ahead of the wind. On September 6 the storm's outer bands brushed the older islands while the center was still far to the southeast. Windward Oʻahu and the north side of East Maui caught the most, with the Kamananui gauge in the Koʻolau mountains measuring more than 9 inches and the West Wailuaiki gauge near Keʻanae more than 8. Kauaʻi had a comparatively quiet day, with under 5 inches even on Mount Waiʻaleʻale, one of the wettest places on Earth.

September 7 was Kauaʻi's day. As Lowell passed close to the island, almost all of it received more than 2 inches and nearly half received more than 5. The biggest total came, as it usually does, from the summit of Waiʻaleʻale, where the gauge recorded just over 23 inches in 24 hours and the map's own estimate tops out near 24. The number that stands out, though, is from the Hawaiʻi Mesonet station at Lower Limahuli on the north shore near Hāʻena. It sits close to sea level, far from the mountain rain that Waiʻaleʻale is famous for, yet it measured just over 15 inches on the 7th alone and more than 17 across the three days, the largest total of any Mesonet station in the storm. The Kilohana gauge above Hanalei also passed 15 inches. The other islands, by then well clear of the storm, saw little more than an inch or two.

By September 8 the rain was easing but not over. Kauaʻi still picked up more than 8 inches on Waiʻaleʻale and around 5 on the ridges above Waimea, while the rest of the state returned to scattered showers. Over the three days the mountain gauge on Waiʻaleʻale totaled almost 36 inches, and the map suggests the wettest spots in the interior received more than 3 feet of rain.

Use the buttons to zoom to each island and to switch between the three days. Hover the map to read the rainfall estimate at any point, and compare it with the stations, drawn as circles for the Hawaiʻi Mesonet and squares for other networks. The map is filled in from those station readings, so it is most trustworthy near a station and most uncertain in the mountains between them.

### Kauaʻi Coastal Impacts Storm Surf

Lowell's center never touched land. It passed about 40 miles west of Niʻihau late on the night of September 7, by then a Category 2 hurricane after peaking as a Category 5 far out at sea. For Kauaʻi the sea was as dangerous as the wind. A huge swell built out of the south and southwest through the day and peaked that night, with breaking waves of 20 to 30 feet on south and west facing shores and a storm surge of several feet on top. The PacIOOS wave forecast shown here put wave heights near 38 feet in the open water just off the southwest coast around midnight.

The surge and surf flooded the low lying grounds of the Sheraton resort at Poʻipū and damaged homes along the shore, buried the highway fronting Kekaha Beach under rock and pieces of broken seawall, and tore up the small boat harbor at Port Allen. Roads on the west side and north shore were left impassable by sand, boulders and debris. One man on Kauaʻi lost his life to the storm surge. The high surf warnings stayed up into September 8 as the swell slowly eased.

### Wind Gusts and Rainfall, Every 15 Minutes

Watch Hurricane Lowell unfold as the Hawaiʻi Mesonet saw it. Press play and the map steps forward 15 minutes at a time, with each step showing what the weather stations recorded over the hour that had just ended. Choose Gusts to see the strongest burst of wind each station felt in that hour, drawn as a small pill that points the way the wind was blowing. The bigger and redder the pill, the harder it blew. Choose Rain to see how much rain fell in that hour, the wetter the redder. Behind the stations is the view from the GOES-West weather satellite, also refreshed every 15 minutes: the brightest white marks the tallest, coldest storm clouds, so you can watch the rain bands sweep over the islands as the stations light up beneath them.

Click any station to see its whole storm charted below the map, drag the slider to any moment, or use the two buttons on the map to jump straight to the wildest station of the storm or of the hour on screen. Hover over a station for its name and reading.

### Fact-check notes

* Lowell peaked as a Category 5 (160 mph) on 2–5 September over open water and
  was a Category 2 (110 mph) when its centre passed about 40 miles west of
  Niʻihau near 09:00 UTC on 8 September, which is 11 pm HST on the 7th, the
  hour the wind maps peak.
* Kauaʻi wind, from the packed WindNinja frames: grid maximum 132.8 mph at
  23:00 HST on 7 September, in the cell 5 km north of Mount Kāhili and 6 km
  southwest of the Waiʻaleʻale summit; 2.9% of the island's cells above 85 mph
  and 33% above 60 mph in that hour; Līhuʻe airport 56.4 mph, the strongest
  station input of the storm on Kauaʻi. The NWS separately reported gusts of
  92 mph at Puʻu Lua and 79 mph at Līhuʻe airport.
* Rainfall, from the packed HCDP daily maps and station totals: Kauaʻi grid
  maximum 23.95 in on 7 September with 95% of the island above 2 in and 48%
  above 5 in; Waiʻaleʻale gauge 23.1 in (35.9 in over the three days); Lower
  Limahuli 15.04 in on the 7th (confirmed against the raw 5-minute Mesonet
  feed) and 17.2 in over three days, the largest Mesonet total of the storm;
  Kilohana 15.3 in. On 6 September Kamananui (Oʻahu) 9.3 in and West Wailuaiki
  (Maui) 8.2 in; on 8 September Waiʻaleʻale 8.2 in.
* Coastal impacts are from press and agency reporting, not from data in this
  project; the 38 ft wave height is the PacIOOS wave model value shown in the
  figure.

### Sources used for the narrative

* Hurricane Lowell (2026), Wikipedia — https://en.wikipedia.org/wiki/Hurricane_Lowell_(2026)
* Kauai and Niihau suffer the worst of Hurricane Lowell's wrath, Honolulu Star-Advertiser —
  https://www.staradvertiser.com/2026/09/08/hawaii-news/kauai-urges-residents-to-shelter-in-place-as-hurricane-lowell-hits/
* Powerful Hurricane Lowell passes 90 miles west of Lihue, Honolulu Star-Advertiser —
  https://www.staradvertiser.com/2026/09/07/breaking-news/tropical-storm-watch-issued-for-oahu-kauai-county-under-hurricane-warning/
* Hurricane Lowell slams Hawaii, Yale Climate Connections —
  https://yaleclimateconnections.org/2026/09/hurricane-lowell-slams-hawaii-triggering-historic-tornado-watch-and-widespread-flooding/
* High surf warnings, advisories issued for dangerous surf from Hurricane Lowell, Hawaii News Now —
  https://www.hawaiinewsnow.com/2026/09/07/high-surf-warnings-advisories-issued-dangerous-surf-hurricane-lowell/
* Hurricane Lowell brings 30-foot surf as it nears western Hawaiian islands, NBC News —
  https://www.nbcnews.com/weather/hurricanes/hurricane-lowell-forecast-hawaii-warnings-rcna596485
* Hurricane Lowell leaves trail of destruction across Kauai, NBC News —
  https://www.nbcnews.com/weather/hurricanes/hurricane-lowell-flooding-destruction-hawaii-kauai-rcna596804
* Flash flood, high surf warning in effect for Kauaʻi County, Kauai Now —
  https://kauainownews.com/2026/09/08/update-swells-from-lowell-karina-cause-surf-advisory-to-be-extended-through-tuesday-morning/
* PacIOOS wave model — https://www.pacioos.hawaii.edu/

## Sources and credits

* Hawaiʻi Mesonet station observations — Hawaiʻi Climate Data Portal (HCDP),
  mesonet database API.
* Daily rainfall maps and station totals — HCDP, "new" production, via the
  HCDP API (docs: https://hcdp.github.io/hcdp_api_docs/).
* WindNinja hourly wind maps — HCDP experimental product; WindNinja is the US
  Forest Service Missoula Fire Sciences Laboratory's wind model
  (https://ninjastorm.firelab.org/windninja/). The maps are not
  cross-validated and terrain amplification over ridges can exceed any station
  reading; treat the highest values as an upper bound.
* Station metadata — ikewai Hawaiʻi master station list
  (https://github.com/ikewai/hawaii_wx_station_mgmt_container).
* GOES-West imagery — NOAA GOES-18, NOAA Open Data on AWS
  (https://registry.opendata.aws/noaa-goes/).
* Coastline — State of Hawaiʻi coastline shapefile.
* Wave figure — PacIOOS (https://www.pacioos.hawaii.edu/).
* Basemap tiles (fallbacks only) — © OpenStreetMap contributors, © CARTO.

## Known quirks and caveats

* In the raw WindNinja outputs (not included), the hourly *statewide*
  direction rasters are corrupt (values 0–186°, roughly half the county values); the county
  rasters and all u/v components are fine and the page only uses county data.
  The hourly statewide metadata files are blank templates.
* On Hawaiʻi Island a few WindNinja input rows each hour carry the following
  hour's timestamp.
* The Mesonet API only serves its native 5-minute cadence; all hourly figures
  are built in the browser.
* Stations on the rainfall map share the grid's colour scale, so a marker over
  an equally wet cell shows mainly by its white outline.
* Only Kauaʻi and Oʻahu are packed for the page. Maui and Hawaiʻi Island can
  be added by whoever holds the raw WindNinja outputs, with
  `build_wind_frames.py --county MN` / `--county BI`; the view list in the page
  script then needs an entry for them.

## File layout

```
HOW_TO_RUN.txt                 the short version of this file
README.md                      this file
rainfall_rate_animation.html   the page (all CSS and JS inline)
serve.py, start_map.bat, start_rate_animation.bat   local server on port 8414
logo.png, wave_lowell.png      images used by the page
build_*.py, fetch_goes_*.py    data processing scripts, for reference
data/
  goes/                        145 GOES-West WebP frames + frames.js / frames.json
  wind_ka/, wind_oa/           36 WindNinja PNG frames each + manifest.js / manifest.json
  rain/                        3 daily rainfall PNG frames + manifest.js / manifest.json
  coastline_hawaii.js / .geojson   coastline
  Hawaii_Master_Station_Meta.csv, mesonet_stations.json   station lookups used by the builders
```

Not included: `hi_meso_token.txt` (bring your own HCDP token), the raw
WindNinja outputs, raw GOES files and raw rainfall GeoTIFFs, and the coastline
shapefile.

import { Component, ElementRef, OnDestroy, AfterViewInit, ViewChild, NgZone } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import * as L from 'leaflet';
import * as GeoTIFF from 'geotiff';
import { Pool } from 'geotiff';
import { environment } from '../../../environments/environment';

type Kind = 'rain' | 'wind';
type Mode = 'day' | 'cum';
type Period = 'day' | 'cday';

interface DayRecord {
  rain: (number | null)[];
  wind: (number | null)[];
  gust: (number | null)[];
  rainTot: number | null;
  windSum: number;
  windN: number;
  windMax: number | null;
  gustMax: number | null;
}

interface Station { id: string; name: string; lat: number; lng: number; elev: number; }

interface RasterStats { min: number; mean: number; max: number; n: number; }

interface ParsedRaster {
  band: Float32Array;
  width: number; height: number;
  xmin: number; ymin: number; xmax: number; ymax: number;
  pixelWidth: number; pixelHeight: number;
}

interface Extent { name: string; bounds: L.LatLngBounds; }

interface ChartOpts {
  area?: boolean;
  unit: string;
  dp: number;
  minTop: number;
  d0: number; d1: number;
  series2?: (number | null)[] | null;
  markIndex?: number | null;
  markSeries?: (number | null)[] | null;
  markWhat?: string;
  markColor?: string;
  markLabel?: string;
  aria: string;
}

@Component({
  selector: 'app-hurricane-lala',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './hurricane-lala.component.html',
  styleUrl: './hurricane-lala.component.css'
})
export class HurricaneLalaComponent implements AfterViewInit, OnDestroy {
  // ------------------------------------------------------------ config
  private readonly API = 'https://api.hcdp.ikewai.org/mesonet/db';
  private readonly LOC = 'hawaii';
  private readonly RAINV = 'RF_1_Tot300s';   // 5-minute rainfall total, mm
  private readonly WINDV = 'WS_1_Avg';       // 5-minute scalar-average wind speed, m/s
  private readonly GUSTV = 'WG_1_Max';       // 5-minute maximum gust, m/s
  readonly DAYS = ['2026-08-14', '2026-08-15', '2026-08-16'];
  private readonly STEP = 5 * 60 * 1000;     // 5 min
  private readonly SLOTS = 288;              // samples per day
  private readonly DAYMS = this.SLOTS * this.STEP;
  private readonly T0 = Date.parse(this.DAYS[0] + 'T00:00:00-10:00');   // 00:00 HST 14 Aug 2026, as an instant
  private readonly MM_PER_IN = 25.4;
  private readonly MPH_PER_MS = 2.236936;

  // Both maps run on a FIXED domain with pseudo-log spacing, so a colour means
  // the same magnitude on every day: t(v) = log1p(v/soft) / log1p(domain/soft).
  // Rainfall is wildly skewed here and needs an aggressive bend; wind day-maxima
  // are not, so a gentler one keeps the low classes from sitting empty.
  private readonly SCALE = {
    rain: { domain: 30, soft: 0.05 },   // inches / day
    wind: { domain: 60, soft: 8 }       // mph, day maximum
  };
  readonly RAIN_TICKS = [0, 0.1, 0.25, 0.75, 2, 5, 12, 30];
  readonly WIND_TICKS = [0, 3, 7, 12, 20, 30, 42, 60];

  private readonly GRID_SPEC: Record<Kind, { dir: string; stem: string; unit: (v: number) => number }> = {
    rain: { dir: 'data/hurricane-lala/rf', stem: 'rainfall', unit: v => v / this.MM_PER_IN },
    wind: { dir: 'data/hurricane-lala/wind', stem: 'wind_max', unit: v => v * this.MPH_PER_MS }
  };

  // Voyager over the plain "light_all" style — same CARTO tile set, but its
  // ocean fill reads as a clear blue instead of near-white, which reads
  // better behind these storm maps.
  private readonly TILE_URL = 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png';

  // Transcribed from extents_hi_counties.csv. Statewide is the union of the
  // four counties, matching the bounds of the HCDP statewide rasters exactly.
  private readonly EXTENT_BOXES: { name: string; box: [number, number, number, number] }[] = [
    { name: 'Statewide', box: [-159.816, -154.668, 18.849, 22.269] },
    { name: 'Kauai', box: [-159.816, -159.25125, 21.819, 22.269] },
    { name: 'Oahu', box: [-158.322, -157.602, 21.18, 21.7425] },
    { name: 'Maui', box: [-157.35, -155.92575, 20.343, 21.32175] },
    { name: 'Hawaii', box: [-156.243, -154.668, 18.849, 20.334] }
  ];
  extents: Extent[] = [];

  // ------------------------------------------------------------- template refs
  @ViewChild('mapRain') private mapRainEl!: ElementRef<HTMLDivElement>;
  @ViewChild('mapWind') private mapWindEl!: ElementRef<HTMLDivElement>;
  @ViewChild('chartRain') private chartRainEl!: ElementRef<SVGSVGElement>;
  @ViewChild('chartWind') private chartWindEl!: ElementRef<SVGSVGElement>;
  @ViewChild('tip') private tipEl!: ElementRef<HTMLDivElement>;

  // ------------------------------------------------------------- bound state
  dayIdx = 0;
  mode: Mode = 'day';
  domainIdx = 0;          // EXTENTS index the grid statistics cover
  activeExtentIdx = 0;    // which Region button reads as pressed — cleared by a manual pan/zoom, unlike domainIdx
  daysLoading = false;

  gridOn: Record<Kind, boolean> = { rain: true, wind: true };
  stationsOn: Record<Kind, boolean> = { rain: true, wind: true };

  readoutRain: { show: boolean; color: string; value: string; coord: string } = { show: false, color: '', value: '', coord: '' };
  readoutWind: { show: boolean; color: string; value: string; coord: string } = { show: false, color: '', value: '', coord: '' };

  statsRain: { day?: RasterStats | null; cum?: RasterStats | null } = {};
  statsWind: { day?: RasterStats | null; cum?: RasterStats | null } = {};

  rainRampStyle = '';
  windRampStyle = '';
  rainTickLabels: { value: number; pct: number; shift: string }[] = [];
  windTickLabels: { value: number; pct: number; shift: string }[] = [];

  selectedWho = 'No station selected';
  rainStatText = '';
  windStatText = '';
  windLegendShow = false;
  selected: string | null = null;

  emptyRainText = 'Click a station to load its rainfall accumulated over the selected day.';
  emptyWindText = 'Click a station to load its 24-hour wind speed trace.';

  statusMsg = '';
  statusErr = false;

  bootVisible = true;
  bootOpacity = 1;
  bootPct = 0;

  // ------------------------------------------------------------- internal state
  private stations: Station[] = [];
  private stationById = new Map<string, Station>();
  private dayCache = new Map<number, Map<string, DayRecord>>();
  private fitting = false;
  private syncingViews = false;

  private maps: Record<Kind, L.Map> = {} as any;
  private layers: Record<Kind, L.LayerGroup> = {} as any;
  private markers: Record<Kind, Map<string, L.CircleMarker>> = { rain: new Map(), wind: new Map() };
  private gridOverlay: Record<Kind, L.ImageOverlay | null> = { rain: null, wind: null };

  private rasterCache = new Map<string, ParsedRaster>();          // url -> parsed band + geo transform
  private rasterPending = new Map<string, Promise<ParsedRaster>>();
  private colorCache = new Map<string, string>();                 // url -> rendered PNG data URL
  private statsCache = new Map<string, RasterStats | null>();      // url|domain -> stats

  private rampStopsCache: Record<Kind, [number, number, number][] | null> = { rain: null, wind: null };
  private tiffPool = new Pool(Math.min(4, navigator.hardwareConcurrency || 4));

  constructor(private http: HttpClient, private host: ElementRef<HTMLElement>, private zone: NgZone) {}

  ngAfterViewInit() {
    // deferred one tick so the initial state mutations below (extents, ramp
    // styles, boot progress) land after Angular's first change-detection
    // pass on this view, rather than during it (NG0100)
    setTimeout(() => this.boot(), 0);
  }

  private async boot() {
    this.extents = this.EXTENT_BOXES.map(e => ({
      name: e.name,
      bounds: L.latLngBounds([[e.box[2], e.box[0]], [e.box[3], e.box[1]]])
    }));

    this.initMaps();
    this.rainRampStyle = this.buildRampCss('rain');
    this.windRampStyle = this.buildRampCss('wind');
    this.rainTickLabels = this.buildTickLabels('rain');
    this.windTickLabels = this.buildTickLabels('wind');
    this.updateChartHints();
    this.zoomTo(0);
    for (const kind of ['rain', 'wind'] as Kind[]) {
      this.maps[kind].setMinZoom(this.maps[kind].getBoundsZoom(this.extents[0].bounds));
    }

    this.bootProgress(0.12);
    try {
      await this.loadStations();
      this.bootProgress(0.28);
      await this.setDay(0);              // the day's measurements are the big download
      this.bootProgress(0.8);
      await Promise.all((['rain', 'wind'] as Kind[]).map(k => this.ensureGridLoaded(k)));
      this.bootProgress(1, true);
    } catch (e: any) {
      this.setStatus(e.message, true);
      this.bootProgress(1, true);        // never leave the cover stuck over an error
    }
  }

  ngOnDestroy() {
    for (const kind of ['rain', 'wind'] as Kind[]) {
      this.maps[kind]?.remove();
    }
    (this.tiffPool as any)?.destroy?.();
  }

  // ---------------------------------------------------------------- helpers
  private setStatus(msg: string, isErr = false) {
    this.statusMsg = msg;
    this.statusErr = isErr;
  }

  private fmt(v: number | null | undefined, d: number): string {
    return v == null || !isFinite(v) ? '–' : v.toFixed(d);
  }

  private hhmm(slot: number): string {
    return String(Math.floor(slot / 12)).padStart(2, '0') + ':' + String((slot % 12) * 5).padStart(2, '0');
  }

  dayLabel(d: string): string {
    return new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  }

  /** What the map is currently showing — day + mode — for the corner label on each map. */
  periodLabel(): string {
    return `${this.dayLabel(this.DAYS[this.dayIdx])} (${this.mode === 'cum' ? 'Cumulative' : 'Daily'} map)`;
  }

  private css(name: string): string {
    return getComputedStyle(this.host.nativeElement).getPropertyValue(name).trim();
  }

  // --------------------------------------------------------------- API layer
  private async apiGet<T>(path: string, params: Record<string, string>): Promise<T> {
    const headers = new HttpHeaders({ Authorization: `Bearer ${environment.apiToken}` });
    return firstValueFrom(this.http.get<T>(`${this.API}/${path}`, { headers, params }));
  }

  /** Bucket a UTC timestamp onto the HST 5-minute grid -> [dayIndex, slot].
   *  T0 is already the instant of 00:00 HST, and HST has no DST, so elapsed
   *  milliseconds map straight onto HST wall-clock position. */
  private bucket(ts: string): [number, number] | null {
    const off = Date.parse(ts) - this.T0;
    if (!isFinite(off) || off < 0 || off >= this.DAYS.length * this.DAYMS) return null;
    const d = Math.floor(off / this.DAYMS);
    const s = Math.round((off - d * this.DAYMS) / this.STEP);
    return s >= this.SLOTS ? null : [d, s];
  }

  private async loadStations(): Promise<void> {
    const rows = await this.apiGet<any[]>('stations', { location: this.LOC });
    this.stations = rows.filter(s => s.lat && s.lng).map(s => ({
      id: s.station_id,
      name: s.full_name || s.name || s.station_id,
      lat: +s.lat, lng: +s.lng, elev: +(s.elevation || 0)
    }));
    this.stations.forEach(s => this.stationById.set(s.id, s));
  }

  /** One day of both variables for every station -> per-station day summaries.
   *  One request covers every station at full 5-minute resolution, so the day
   *  fetch doubles as the source for the per-station charts — a station click
   *  costs no extra request for any day already in hand. */
  private async loadDay(i: number): Promise<Map<string, DayRecord>> {
    if (this.dayCache.has(i)) return this.dayCache.get(i)!;
    const rows = await this.apiGet<any[]>('measurements', {
      location: this.LOC,
      var_ids: `${this.RAINV},${this.WINDV},${this.GUSTV}`,
      start_date: `${this.DAYS[i]}T00:00:00-10:00`,
      end_date: new Date(this.T0 + (i + 1) * this.DAYMS).toISOString(),
      row_mode: 'json',
      limit: '1000000'
    });
    const acc = new Map<string, DayRecord>();
    for (const r of rows) {
      if (r.flag !== 0 || r.value == null || r.value === '') continue;
      const b = this.bucket(r.timestamp);
      if (!b || b[0] !== i) continue;              // drops the inclusive end-of-range boundary row
      const raw = +r.value;
      if (!isFinite(raw)) continue;
      const v = r.variable === this.RAINV ? raw / this.MM_PER_IN : raw * this.MPH_PER_MS;
      let a = acc.get(r.station_id);
      if (!a) {
        a = {
          rain: new Array(this.SLOTS).fill(null), wind: new Array(this.SLOTS).fill(null),
          gust: new Array(this.SLOTS).fill(null),
          rainTot: null, windSum: 0, windN: 0, windMax: null, gustMax: null
        };
        acc.set(r.station_id, a);
      }
      if (r.variable === this.RAINV) {
        a.rain[b[1]] = v;
        a.rainTot = (a.rainTot ?? 0) + v;
      } else if (r.variable === this.GUSTV) {
        a.gust[b[1]] = v;
        a.gustMax = a.gustMax == null ? v : Math.max(a.gustMax, v);
      } else {
        a.wind[b[1]] = v;
        a.windSum += v; a.windN++;
        a.windMax = a.windMax == null ? v : Math.max(a.windMax, v);
      }
    }
    this.dayCache.set(i, acc);
    return acc;
  }

  /** Load every day a span touches. In 'day' mode that is one day; in
   *  'cumulative' it is 14 Aug through the selected day. */
  private async ensureSpan(d0: number, d1: number): Promise<void> {
    for (let i = d0; i <= d1; i++) await this.loadDay(i);
  }

  // ------------------------------------------------------------ derived measures
  /** Which days a chart spans in the current mode: [firstDay, lastDay]. */
  private span(d: number): [number, number] {
    return this.mode === 'cum' ? [0, d] : [d, d];
  }

  private rawSeries(id: string, key: 'rain' | 'wind' | 'gust', d0: number, d1: number): (number | null)[] {
    const out: (number | null)[] = [];
    for (let p = d0; p <= d1; p++) {
      const rec = this.dayCache.get(p)?.get(id);
      out.push(...(rec ? rec[key] : new Array(this.SLOTS).fill(null)));
    }
    return out;
  }

  /** Running rainfall total across the span, starting from a true zero at its
   *  first midnight — one point longer than the raw series, so index 0 is 0
   *  and the last index is 24:00. */
  private rainSeries(id: string, d0: number, d1: number) {
    const raw = this.rawSeries(id, 'rain', d0, d1);
    const out = new Array<number>(raw.length + 1);
    let run = 0;
    out[0] = 0;
    for (let i = 0; i < raw.length; i++) { run += raw[i] || 0; out[i + 1] = run; }
    return { values: out, total: run, gaps: raw.filter(v => v == null).length };
  }

  private windSeries(id: string, d0: number, d1: number) {
    const values = this.rawSeries(id, 'wind', d0, d1);
    const gusts = this.rawSeries(id, 'gust', d0, d1);
    let peakIdx = -1, peak = -Infinity, n = 0, sum = 0;
    values.forEach((v, i) => {
      if (v == null || !isFinite(v)) return;
      n++; sum += v;
      if (v > peak) { peak = v; peakIdx = i; }
    });
    let gPeak = -Infinity, gPeakIdx = -1, gn = 0;
    gusts.forEach((v, i) => {
      if (v == null || !isFinite(v)) return;
      gn++;
      if (v > gPeak) { gPeak = v; gPeakIdx = i; }
    });
    return {
      values,
      gusts: gn ? gusts : null,
      peak: n ? peak : null,
      peakIdx,
      gustPeak: gn ? gPeak : null,
      gustPeakIdx: gPeakIdx,
      mean: n ? sum / n : null,
      gaps: values.length - n
    };
  }

  private atIndex(i: number, d0: number) {
    return { day: d0 + Math.floor(i / this.SLOTS), slot: i % this.SLOTS };
  }

  private stampAt(i: number, d0: number, d1: number): string {
    const a = this.atIndex(i, d0);
    return this.hhmm(a.slot) + ' HST' + (d1 > d0 ? ', ' + this.dayLabel(this.DAYS[a.day]) : '');
  }

  /** What a marker/cell represents over the current span: rainfall
   *  accumulates, wind takes the running maximum — matching the day/ and
   *  cday/ rasters exactly, so markers and surface always mean the same thing. */
  private markerValue(kind: Kind | 'gust', id: string, d0: number, d1: number): number | null {
    let out: number | null = null;
    for (let p = d0; p <= d1; p++) {
      const rec = this.dayCache.get(p)?.get(id);
      if (!rec) continue;
      const v = kind === 'rain' ? rec.rainTot : (kind === 'gust' ? rec.gustMax : rec.windMax);
      if (v == null) continue;
      out = out == null ? v : (kind === 'rain' ? out + v : Math.max(out, v));
    }
    return out;
  }

  private windMeanOver(id: string, d0: number, d1: number): number | null {
    let sum = 0, n = 0;
    for (let p = d0; p <= d1; p++) {
      const rec = this.dayCache.get(p)?.get(id);
      if (rec) { sum += rec.windSum; n += rec.windN; }
    }
    return n ? sum / n : null;
  }

  // ---------------------------------------------------------------- colour
  private magScale(kind: Kind, v: number): number {
    const { domain, soft } = this.SCALE[kind];
    return Math.min(1, Math.log1p(Math.max(0, v) / soft) / Math.log1p(domain / soft));
  }

  private rampColorVar(kind: Kind, i: number): string {
    return this.css(`--${kind}-${i + 1}`);
  }

  private rampStops(kind: Kind): [number, number, number][] {
    const cached = this.rampStopsCache[kind];
    if (cached) return cached;
    const out: [number, number, number][] = [];
    for (let i = 0; i < 7; i++) {
      const h = this.rampColorVar(kind, i).replace('#', '');
      out.push([parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]);
    }
    this.rampStopsCache[kind] = out;
    return out;
  }

  /** Colour at normalised position t (0..1) — linear sRGB blend between
   *  stops, matching the CSS linear-gradient the legend bar uses. */
  private rampAtRgb(kind: Kind, t: number): [number, number, number] {
    const st = this.rampStops(kind);
    const x = Math.max(0, Math.min(1, t)) * (st.length - 1);
    const i = Math.min(st.length - 2, Math.floor(x));
    const f = x - i, a = st[i], b = st[i + 1];
    return [
      Math.round(a[0] + (b[0] - a[0]) * f),
      Math.round(a[1] + (b[1] - a[1]) * f),
      Math.round(a[2] + (b[2] - a[2]) * f)
    ];
  }

  private rampAt(kind: Kind, t: number): string {
    const [r, g, b] = this.rampAtRgb(kind, t);
    return `rgb(${r},${g},${b})`;
  }

  private rampFor(kind: Kind, v: number): string {
    return this.rampAt(kind, this.magScale(kind, v));
  }

  // ------------------------------------------------------------------ maps
  /** Leaflet dispatches its own internal events (tile load, viewreset, move)
   *  through zone.js-patched DOM listeners; constructing and wiring the maps
   *  outside Angular's zone stops those from triggering spurious extra change
   *  detection passes. Handlers below that actually need to update bound
   *  template state re-enter the zone explicitly via `this.zone.run`. */
  private initMaps() {
    this.zone.runOutsideAngular(() => this.buildMaps());
  }

  private buildMaps() {
    const attr = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>, ' +
      '&copy; <a href="https://carto.com/attributions">CARTO</a> &middot; data: ' +
      '<a href="https://www.hawaii.edu/climate-data-portal/">HCDP</a>';

    for (const kind of ['rain', 'wind'] as Kind[]) {
      const el = kind === 'rain' ? this.mapRainEl.nativeElement : this.mapWindEl.nativeElement;
      const m = L.map(el, {
        zoomControl: false,                    // added below, in the bottom corner
        attributionControl: kind === 'wind',
        // No zoom animation. The two maps mirror each other, and an animated
        // zoom reports its old level while running, so the partner echoed that
        // stale value back and cancelled the zoom outright — +/- did nothing.
        zoomAnimation: false,
        // the view is fenced to the statewide extent: you cannot drag off the
        // archipelago, and minZoom below stops you zooming out past it
        maxBounds: this.extents[0].bounds.pad(0.03),
        maxBoundsViscosity: 1.0
      }).setView([20.7, -157.3], 6);
      L.tileLayer(this.TILE_URL, { attribution: attr, subdomains: 'abcd', maxZoom: 18, zIndex: 1 } as any).addTo(m);
      this.layers[kind] = L.layerGroup().addTo(m);
      this.maps[kind] = m;

      // both maps get their own zoom buttons, low-left, clear of the attribution
      L.control.zoom({ position: 'bottomleft' }).addTo(m);

      m.on('mousemove', (ev: L.LeafletMouseEvent) => this.updateReadout(kind, ev.latlng));
      m.on('mouseout', () => this.clearReadout(kind));
      // a manual pan/zoom means we are no longer sitting on a named extent —
      // this only clears which button reads as pressed; the stats keep
      // describing the last-selected domain rather than going blank
      m.on('dragstart zoomstart', () => {
        if (this.fitting) return;
        this.zone.run(() => { this.activeExtentIdx = -1; });
      });
    }

    // Keep the pair locked together. The `syncingViews` flag stops synchronous
    // re-entry; the equality check stops an echo writing a stale view back if
    // the partner's events ever arrive a frame late.
    for (const [a, b] of [['rain', 'wind'], ['wind', 'rain']] as [Kind, Kind][]) {
      this.maps[a].on('move zoom', () => {
        if (this.syncingViews) return;
        const src = this.maps[a], dst = this.maps[b];
        const c = src.getCenter(), z = src.getZoom();
        const dc = dst.getCenter();
        if (dst.getZoom() === z && Math.abs(dc.lat - c.lat) < 1e-9 && Math.abs(dc.lng - c.lng) < 1e-9) return;
        this.syncingViews = true;
        dst.setView(c, z, { animate: false });
        this.syncingViews = false;
      });
    }
  }

  zoomTo(i: number) {
    const e = this.extents[i];
    if (!e) return;
    this.domainIdx = i;
    this.activeExtentIdx = i;
    this.renderAllStats();
    this.fitting = true;
    try {
      this.maps['rain'].fitBounds(e.bounds, { animate: false, padding: [6, 6] });
    } finally {
      this.fitting = false;
    }
  }

  private drawMarkers() {
    const [d0, d1] = this.span(this.dayIdx);
    const cum = d1 > d0;
    const when = cum ? 'since 14 Aug' : 'this day';
    for (const kind of ['rain', 'wind'] as Kind[]) {
      this.layers[kind].clearLayers();
      this.markers[kind].clear();
      for (const st of this.stations) {
        const v = this.markerValue(kind, st.id, d0, d1);
        if (v == null) continue;
        // one pseudo-log position drives both size and colour
        const t = this.magScale(kind, v);
        const mk = L.circleMarker([st.lat, st.lng], {
          radius: 5.5 + t * 5.4,
          fillColor: this.rampAt(kind, t),
          fillOpacity: 0.95,
          color: this.css('--surface-1'),
          weight: 2                                  // 2px surface ring so overlapping marks separate
        }).addTo(this.layers[kind]);
        mk.bindTooltip(
          `<b>${st.name}</b> (${st.id})<br>` + (kind === 'rain'
            ? `${this.fmt(v, 2)} in ${when}`
            : `${this.fmt(v, 1)} mph max ${when} &middot; ${this.fmt(this.windMeanOver(st.id, d0, d1), 1)} mph mean`),
          { direction: 'top', offset: [0, -4] });
        // Leaflet's vector-layer click dispatch is registered outside
        // Angular's zone (it happens at renderer-creation time, inside
        // initMaps' runOutsideAngular block), so this needs an explicit
        // re-entry for the selection to actually show up in the template.
        mk.on('click', () => this.zone.run(() => this.select(st.id)));
        this.markers[kind].set(st.id, mk);
      }
      this.highlight(kind);
      this.applyStationVisibility(kind);
    }
    this.renderAllStats();          // station rows are derived from these same values
  }

  private highlight(kind: Kind) {
    for (const [id, mk] of this.markers[kind]) {
      const on = id === this.selected;
      mk.setStyle({ color: on ? this.css('--text-primary') : this.css('--surface-1'), weight: on ? 3 : 2 });
      if (on) mk.bringToFront();
    }
  }

  applyStationVisibility(kind: Kind) {
    const layer = this.layers[kind];
    if (!layer) return;
    if (this.stationsOn[kind]) {
      if (!this.maps[kind].hasLayer(layer)) this.maps[kind].addLayer(layer);
    } else if (this.maps[kind].hasLayer(layer)) {
      this.maps[kind].removeLayer(layer);
    }
  }

  onStationsToggle(kind: Kind, ev: Event) {
    this.stationsOn[kind] = (ev.target as HTMLInputElement).checked;
    this.applyStationVisibility(kind);
  }

  onGridToggle(kind: Kind, ev: Event) {
    this.gridOn[kind] = (ev.target as HTMLInputElement).checked;
    this.refreshGrid(kind);
  }

  // ---------------------------------------------------------- gridded surfaces
  /* The statewide rasters, drawn under the station markers on both maps. Which
   * file is shown follows the Day / Cumulative toggle exactly as the charts
   * and the markers do:
   *   rain  day -> data/rf/day/      that day's total             (mm)
   *   rain  cum -> data/rf/cday/     running total since 14 Aug   (mm)
   *   wind  day -> data/wind/day/    that day's maximum           (m/s)
   *   wind  cum -> data/wind/cday/   running maximum since 14 Aug (m/s)
   * Pixels go through the same unit conversion and ramp as the markers, so one
   * legend per panel describes both. */
  private gridUrl(kind: Kind, d: number, per: Period): string {
    const g = this.GRID_SPEC[kind];
    return `${g.dir}/${per}/${g.stem}_${per}_statewide_${this.DAYS[d]}.tif`;
  }

  private activePeriod(): Period {
    return this.mode === 'cum' ? 'cday' : 'day';
  }

  /* Several callers ask for the same raster at once — the layer, the
   * statistics box and the boot sequence all want it the moment a day
   * changes. The result cache only fills after the parse, so without sharing
   * the in-flight promise each of them started its own fetch. */
  private async loadRaster(url: string): Promise<ParsedRaster> {
    if (this.rasterCache.has(url)) return this.rasterCache.get(url)!;
    if (this.rasterPending.has(url)) return this.rasterPending.get(url)!;
    const job = this.parseRaster(url).finally(() => this.rasterPending.delete(url));
    this.rasterPending.set(url, job);
    return job;
  }

  private async parseRaster(url: string): Promise<ParsedRaster> {
    let tiff: any;
    try {
      tiff = await GeoTIFF.fromUrl(url);
    } catch (e) {
      throw new Error(`could not reach ${url} — the COG for this day may be missing`);
    }
    const image = await tiff.getImage();
    const [xmin, ymin, xmax, ymax] = image.getBoundingBox() as [number, number, number, number];
    const width = image.getWidth();
    const height = image.getHeight();
    const band = (await image.readRasters({
      samples: [0], interleave: true, resampleMethod: 'nearest', pool: this.tiffPool
    })) as Float32Array;
    const raster: ParsedRaster = {
      band, width, height, xmin, ymin, xmax, ymax,
      pixelWidth: (xmax - xmin) / width,
      pixelHeight: (ymax - ymin) / height
    };
    this.rasterCache.set(url, raster);
    return raster;
  }

  /** A raster pixel is nodata if it fails this guard — rainfall nodata is
   *  -3.4e38, wind nodata is NaN; both fail here. */
  private isNoData(v: number): boolean {
    return v == null || !isFinite(v) || v < -1e30;
  }

  /** Colour the whole raster into an offscreen canvas once, matching exactly
   *  how a station marker holding the same value would be coloured. Cached by
   *  url, since the raster itself is cached and the colour ramp never changes. */
  private colorizeRaster(kind: Kind, url: string, raster: ParsedRaster): string {
    const cached = this.colorCache.get(url);
    if (cached) return cached;
    const { band, width, height } = raster;
    const unit = this.GRID_SPEC[kind].unit;
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d')!;
    const img = ctx.createImageData(width, height);
    for (let i = 0; i < band.length; i++) {
      const raw = band[i];
      const idx = i * 4;
      if (this.isNoData(raw)) { img.data[idx + 3] = 0; continue; }
      const [r, g, b] = this.rampAtRgb(kind, this.magScale(kind, unit(raw)));
      img.data[idx] = r; img.data[idx + 1] = g; img.data[idx + 2] = b; img.data[idx + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    const dataUrl = canvas.toDataURL('image/png');
    this.colorCache.set(url, dataUrl);
    return dataUrl;
  }

  async refreshGrid(kind: Kind): Promise<void> {
    if (this.gridOverlay[kind]) { this.maps[kind].removeLayer(this.gridOverlay[kind]!); this.gridOverlay[kind] = null; }
    if (!this.gridOn[kind]) return;
    const url = this.gridUrl(kind, this.dayIdx, this.activePeriod());
    try {
      const raster = await this.loadRaster(url);
      if (!this.gridOn[kind] || url !== this.gridUrl(kind, this.dayIdx, this.activePeriod())) return;  // changed while loading
      const dataUrl = this.colorizeRaster(kind, url, raster);
      const bounds = L.latLngBounds([[raster.ymin, raster.xmin], [raster.ymax, raster.xmax]]);
      const layer = L.imageOverlay(dataUrl, bounds, { opacity: 0.72, zIndex: 2 } as any);
      layer.addTo(this.maps[kind]);
      this.gridOverlay[kind] = layer;
      this.renderStats(kind);
    } catch (e: any) {
      this.setStatus(`${kind === 'rain' ? 'rainfall' : 'wind'} grid unavailable — ${e.message}`, true);
    }
  }

  private refreshGrids() {
    this.refreshGrid('rain');
    this.refreshGrid('wind');
  }

  // -------------------------------------------------------- grid spatial stats
  /** Min/mean/max of a raster over one named domain, straight from the pixels
   *  — restricted to the domain's bounding box and skipping nodata. Cached
   *  per raster+domain, since statewide walks all 287,983 valid cells. */
  private gridStatsPer(kind: Kind, di: number, per: Period): RasterStats | null | undefined {
    const url = this.gridUrl(kind, this.dayIdx, per);
    const key = `${url}|${di}`;
    if (this.statsCache.has(key)) return this.statsCache.get(key);
    const r = this.rasterCache.get(url);
    if (!r) return undefined;      // not loaded yet

    const b = this.extents[di]?.bounds;
    if (!b) return undefined;
    const c0 = Math.max(0, Math.floor((b.getWest() - r.xmin) / r.pixelWidth));
    const c1 = Math.min(r.width - 1, Math.ceil((b.getEast() - r.xmin) / r.pixelWidth));
    const y0 = Math.max(0, Math.floor((r.ymax - b.getNorth()) / r.pixelHeight));
    const y1 = Math.min(r.height - 1, Math.ceil((r.ymax - b.getSouth()) / r.pixelHeight));

    let min = Infinity, max = -Infinity, sum = 0, n = 0;
    for (let y = y0; y <= y1; y++) {
      const rowOff = y * r.width;
      for (let x = c0; x <= c1; x++) {
        const v = r.band[rowOff + x];
        if (this.isNoData(v)) continue;
        if (v < min) min = v;
        if (v > max) max = v;
        sum += v; n++;
      }
    }
    const conv = this.GRID_SPEC[kind].unit;
    const out: RasterStats | null = n ? { min: conv(min), mean: conv(sum / n), max: conv(max), n } : null;
    this.statsCache.set(key, out);
    return out;
  }

  /** Two-card stat block: the map grid's min/mean/max, daily on the left and
   *  cumulative on the right — independent of the Day/Cumulative map toggle,
   *  so both windows are always visible at once. */
  private renderStats(kind: Kind) {
    const target = kind === 'rain' ? this.statsRain : this.statsWind;
    target.day = this.gridStatsPer(kind, this.domainIdx, 'day');
    target.cum = this.gridStatsPer(kind, this.domainIdx, 'cday');
  }

  private renderAllStats() {
    this.renderStats('rain');
    this.renderStats('wind');
  }

  statCell(st: RasterStats | null | undefined, key: 'min' | 'mean' | 'max', dp: number): string {
    if (st === undefined) return '…';
    if (st === null) return '–';
    return st[key].toFixed(dp);
  }

  /** The statistics need both the daily and cumulative rasters loaded, even
   *  when only one of them is the active map overlay. */
  private async ensureGridLoaded(kind: Kind): Promise<void> {
    for (const per of ['day', 'cday'] as Period[]) {
      const url = this.gridUrl(kind, this.dayIdx, per);
      if (this.rasterCache.has(url)) continue;
      try { await this.loadRaster(url); } catch { /* refreshGrid reports the active overlay's own error */ }
    }
  }

  private async refreshStats() {
    this.renderAllStats();                       // show "loading" straight away
    await Promise.all((['rain', 'wind'] as Kind[]).map(k => this.ensureGridLoaded(k)));
    this.renderAllStats();
  }

  /** The gridded value under a point, in the map's own units, or null outside
   *  the raster, over the ocean, on nodata, or before the raster has parsed. */
  private sampleGrid(kind: Kind, latlng: L.LatLng): number | null {
    const url = this.gridUrl(kind, this.dayIdx, this.activePeriod());
    const r = this.rasterCache.get(url);
    if (!r) return null;
    const col = Math.floor((latlng.lng - r.xmin) / r.pixelWidth);
    const row = Math.floor((r.ymax - latlng.lat) / r.pixelHeight);
    if (col < 0 || row < 0 || col >= r.width || row >= r.height) return null;
    const raw = r.band[row * r.width + col];
    if (this.isNoData(raw)) return null;
    return this.GRID_SPEC[kind].unit(raw);
  }

  private coordText(ll: L.LatLng): string {
    return `${Math.abs(ll.lat).toFixed(3)}°${ll.lat >= 0 ? 'N' : 'S'} ${Math.abs(ll.lng).toFixed(3)}°${ll.lng >= 0 ? 'E' : 'W'}`;
  }

  /** The readout only exists when there is a value to report. Off the grid,
   *  over the ocean, on nodata, with the grid switched off, or before the
   *  raster has parsed, it is hidden outright rather than a placeholder. */
  private updateReadout(kind: Kind, latlng: L.LatLng) {
    const v = this.gridOn[kind] ? this.sampleGrid(kind, latlng) : null;
    const target = kind === 'rain' ? this.readoutRain : this.readoutWind;
    this.zone.run(() => {
      if (v == null) { target.show = false; return; }
      const unit = kind === 'rain' ? 'in' : 'mph';
      target.show = true;
      target.color = this.rampFor(kind, v);
      target.value = `${v.toFixed(kind === 'rain' ? 2 : 1)} ${unit}`;
      target.coord = this.coordText(latlng);
    });
  }

  private clearReadout(kind: Kind) {
    this.zone.run(() => { (kind === 'rain' ? this.readoutRain : this.readoutWind).show = false; });
  }

  // -------------------------------------------------------------- legend
  private buildRampCss(kind: Kind): string {
    const stops: string[] = [];
    for (let i = 0; i < 7; i++) stops.push(this.rampColorVar(kind, i));
    return `linear-gradient(to right,${stops.join(',')})`;
  }

  private buildTickLabels(kind: Kind) {
    const ticks = kind === 'rain' ? this.RAIN_TICKS : this.WIND_TICKS;
    return ticks.map(v => {
      const pct = this.magScale(kind, v) * 100;
      const shift = pct <= 0.01 ? '0' : (pct >= 99.99 ? '-100%' : '-50%');
      return { value: v, pct, shift };
    });
  }

  // -------------------------------------------------------------- the charts
  private readonly PAD = { l: 46, r: 12, t: 10, b: 22 };
  private readonly NS = 'http://www.w3.org/2000/svg';

  private svgEl(tag: string, attrs: Record<string, string | number>): SVGElement {
    const n = document.createElementNS(this.NS, tag);
    for (const k in attrs) n.setAttribute(k, String(attrs[k]));
    return n;
  }

  private niceTop(v: number): number {
    if (!isFinite(v) || v <= 0) return 1;
    const mag = Math.pow(10, Math.floor(Math.log10(v)));
    // mantissas whose quarter lands on at most two decimals, so the four
    // gridline labels are exact rather than rounded (0.6/1.2/1.8, not 0.6/1.3/1.9)
    for (const m of [1, 1.2, 1.6, 2, 2.4, 3.2, 4, 6, 8, 10]) if (v <= m * mag) return m * mag;
    return 10 * mag;
  }

  private tickDp(step: number): number {
    for (let d = 0; d <= 3; d++) {
      const scaled = step * Math.pow(10, d);
      if (Math.abs(scaled - Math.round(scaled)) < 1e-9) return d;
    }
    return 3;
  }

  private drawChart(kind: Kind, values: (number | null)[], opts: ChartOpts) {
    const svg = kind === 'rain' ? this.chartRainEl.nativeElement : this.chartWindEl.nativeElement;
    if (!svg.clientWidth) {
      // the svg can still be mid-layout (just unhidden by change detection
      // that hasn't painted yet) — retry next frame rather than locking the
      // chart's coordinate system to a stale fallback width.
      requestAnimationFrame(() => this.drawChart(kind, values, opts));
      return;
    }
    const W = svg.clientWidth, H = svg.clientHeight || 210;
    const n = values.length;
    const nDays = Math.max(1, Math.round(n / this.SLOTS));
    const padT = nDays > 1 ? 24 : this.PAD.t;
    const iw = W - this.PAD.l - this.PAD.r, ih = H - padT - this.PAD.b;
    const xMax = nDays * this.SLOTS;
    const finite = values.filter((v): v is number => v != null && isFinite(v));
    const finite2 = (opts.series2 || []).filter((v): v is number => v != null && isFinite(v));
    const peakOf = (a: number[]) => a.length ? Math.max(...a) : 0;
    const top = this.niceTop(Math.max(opts.minTop, peakOf(finite), peakOf(finite2)));
    const x = (i: number) => this.PAD.l + (i / xMax) * iw;
    const y = (v: number) => padT + ih - (v / top) * ih;
    const stroke = kind === 'rain' ? this.css('--accent-rain') : this.css('--accent-wind');

    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('aria-label', opts.aria);
    svg.innerHTML = '';

    const ydp = this.tickDp(top / 4);
    for (let k = 0; k <= 4; k++) {
      const v = top * k / 4, yy = y(v);
      svg.appendChild(this.svgEl('line', { x1: this.PAD.l, x2: W - this.PAD.r, y1: yy, y2: yy,
        stroke: k ? this.css('--grid') : this.css('--axis'), 'stroke-width': 1 }));
      const t = this.svgEl('text', { x: this.PAD.l - 7, y: yy + 3.5, 'text-anchor': 'end',
        fill: this.css('--muted'), 'font-size': 10.5, 'font-variant-numeric': 'tabular-nums' });
      t.textContent = v.toFixed(ydp);
      svg.appendChild(t);
    }
    const tickEvery = nDays === 1 ? 36 : nDays === 2 ? 72 : 144;
    for (let i = 0; i <= xMax; i += tickEvery) {
      const xx = x(i);
      const last = i === xMax;
      if (i > 0 && !last) svg.appendChild(this.svgEl('line', { x1: xx, x2: xx, y1: padT, y2: padT + ih,
        stroke: this.css('--grid'), 'stroke-width': 1 }));
      const t = this.svgEl('text', { x: xx, y: H - 6,
        'text-anchor': i === 0 ? 'start' : (last ? 'end' : 'middle'), fill: this.css('--muted'), 'font-size': 10.5 });
      t.textContent = last ? '24' : String(Math.floor((i % this.SLOTS) / 12)).padStart(2, '0');
      svg.appendChild(t);
    }
    if (nDays > 1) for (let k = 0; k < nDays; k++) {
      const i0 = k * this.SLOTS;
      if (k > 0) svg.appendChild(this.svgEl('line', { x1: x(i0), x2: x(i0), y1: padT, y2: padT + ih,
        stroke: this.css('--axis'), 'stroke-width': 1 }));
      const t = this.svgEl('text', { x: x(i0 + this.SLOTS / 2), y: padT - 8, 'text-anchor': 'middle',
        fill: this.css('--muted'), 'font-size': 10.5 });
      t.textContent = this.dayLabel(this.DAYS[opts.d0 + k]);
      svg.appendChild(t);
    }

    if (opts.series2) {
      const gruns: [number, number][][] = [];
      let gcur: [number, number][] | null = null;
      opts.series2.forEach((v, i) => {
        if (v == null || !isFinite(v)) { gcur = null; return; }
        if (!gcur) { gcur = []; gruns.push(gcur); }
        gcur.push([i, v]);
      });
      for (const run of gruns) {
        if (run.length < 2) continue;
        svg.appendChild(this.svgEl('path', {
          d: 'M' + run.map(pt => `${x(pt[0])},${y(pt[1])}`).join('L'),
          fill: 'none', stroke: this.css('--accent-gust'), 'stroke-width': 1.75,
          'stroke-linejoin': 'round', 'stroke-linecap': 'round'
        }));
      }
    }

    const runs: [number, number][][] = [];
    let cur: [number, number][] | null = null;
    values.forEach((v, i) => {
      if (v == null || !isFinite(v)) { cur = null; return; }
      if (!cur) { cur = []; runs.push(cur); }
      cur.push([i, v]);
    });
    if (opts.area) for (const run of runs) {
      if (run.length < 2) continue;
      const d = 'M' + x(run[0][0]) + ',' + y(0) +
        run.map(p => `L${x(p[0])},${y(p[1])}`).join('') +
        `L${x(run[run.length - 1][0])},${y(0)}Z`;
      svg.appendChild(this.svgEl('path', { d, fill: stroke, 'fill-opacity': 0.14 }));
    }
    for (const run of runs) {
      if (run.length === 1) {
        svg.appendChild(this.svgEl('circle', { cx: x(run[0][0]), cy: y(run[0][1]), r: 2, fill: stroke }));
        continue;
      }
      svg.appendChild(this.svgEl('path', {
        d: 'M' + run.map(p => `${x(p[0])},${y(p[1])}`).join('L'),
        fill: 'none', stroke, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round'
      }));
    }
    if (opts.markIndex != null && opts.markIndex >= 0) {
      const mi = opts.markIndex, mx = x(mi);
      const mv = (opts.markSeries || values)[mi] as number;
      const markCol = opts.markColor || stroke;
      svg.appendChild(this.svgEl('line', { x1: mx, x2: mx, y1: padT, y2: padT + ih, stroke: markCol, 'stroke-width': 2 }));
      svg.appendChild(this.svgEl('circle', { cx: mx, cy: y(mv), r: 3.5, fill: markCol, stroke: this.css('--surface-1'), 'stroke-width': 2 }));
      const right = mx < this.PAD.l + iw * 0.6;
      const t = this.svgEl('text', { x: mx + (right ? 6 : -6), y: padT + 11,
        'text-anchor': right ? 'start' : 'end', fill: this.css('--text-secondary'), 'font-size': 10.5, 'font-weight': 600 });
      t.textContent = `${opts.markWhat || 'max'} ${mv.toFixed(opts.dp)} ${opts.unit} · ${opts.markLabel}`;
      svg.appendChild(t);
    }

    const cross = this.svgEl('line', { y1: padT, y2: padT + ih, stroke: this.css('--axis'), 'stroke-width': 1, opacity: 0 });
    const dot = this.svgEl('circle', { r: 4, fill: stroke, stroke: this.css('--surface-1'), 'stroke-width': 2, opacity: 0 });
    const dot2 = opts.series2
      ? this.svgEl('circle', { r: 4, fill: this.css('--accent-gust'), stroke: this.css('--surface-1'), 'stroke-width': 2, opacity: 0 })
      : null;
    svg.appendChild(cross); svg.appendChild(dot);
    if (dot2) svg.appendChild(dot2);
    const hit = this.svgEl('rect', { x: this.PAD.l, y: padT, width: iw, height: ih, fill: 'transparent' });
    svg.appendChild(hit);
    const tip = this.tipEl.nativeElement;
    hit.addEventListener('pointermove', (ev: PointerEvent) => {
      const r = svg.getBoundingClientRect();
      const i = Math.max(0, Math.min(n - 1,
        Math.round((((ev.clientX - r.left) * (W / r.width)) - this.PAD.l) / iw * xMax)));
      const v = values[i];
      const when = this.stampAt(i, opts.d0, opts.d1);
      cross.setAttribute('x1', String(x(i))); cross.setAttribute('x2', String(x(i))); cross.setAttribute('opacity', '1');
      const g = opts.series2 ? opts.series2[i] : null;
      const gOk = g != null && isFinite(g);
      if (dot2) {
        if (gOk) { dot2.setAttribute('cx', String(x(i))); dot2.setAttribute('cy', String(y(g as number))); dot2.setAttribute('opacity', '1'); }
        else dot2.setAttribute('opacity', '0');
      }
      const vOk = v != null && isFinite(v);
      dot.setAttribute('opacity', vOk ? '1' : '0');
      if (vOk) { dot.setAttribute('cx', String(x(i))); dot.setAttribute('cy', String(y(v as number))); }
      const parts: string[] = [];
      if (gOk) parts.push(`gust ${(g as number).toFixed(opts.dp)} ${opts.unit}`);
      if (vOk) parts.push(`${opts.series2 ? 'sustained ' : ''}${(v as number).toFixed(opts.dp)} ${opts.unit}`);
      tip.innerHTML = `<b>${when}</b>` + (parts.length ? ` &middot; ${parts.join(' &middot; ')}` : ' — no data');
      tip.style.opacity = '1';
      tip.style.left = `${Math.min(ev.clientX + 14, innerWidth - tip.offsetWidth - 8)}px`;
      tip.style.top = `${ev.clientY - 38}px`;
    });
    hit.addEventListener('pointerleave', () => {
      cross.setAttribute('opacity', '0'); dot.setAttribute('opacity', '0');
      if (dot2) dot2.setAttribute('opacity', '0');
      tip.style.opacity = '0';
    });
  }

  // ----------------------------------------------------------- orchestration
  async select(id: string) {
    this.selected = id;
    this.highlight('rain'); this.highlight('wind');
    const st = this.stationById.get(id)!;
    this.selectedWho = `${st.name} (${id}) · ${st.elev} m`;
    try {
      const [d0, d1] = this.span(this.dayIdx);
      if (d1 > d0) await this.ensureSpan(d0, d1);      // cumulative mode needs every earlier day
      this.renderStation(id);
    } catch (e: any) {
      this.setStatus(e.message, true);
    }
  }

  private renderStation(id: string) {
    const [d0, d1] = this.span(this.dayIdx);
    if (!this.dayCache.get(this.dayIdx)?.get(id)) {
      this.setStatus(`${this.stationById.get(id)!.name} reported nothing on ${this.dayLabel(this.DAYS[this.dayIdx])}`, true);
      return;
    }
    const cum = this.mode === 'cum';
    const since = `since 00:00 HST ${this.dayLabel(this.DAYS[0])}`;

    // rainfall: a running total that starts at zero — at this day's midnight
    // in 'day' mode, at 14 Aug midnight in 'cumulative'
    const r = this.rainSeries(id, d0, d1);
    this.rainStatText = `${this.fmt(r.total, 2)} in total ${cum ? since : 'for ' + this.dayLabel(this.DAYS[this.dayIdx])}` +
      (r.gaps ? ` · ${r.gaps} gaps` : '');
    this.drawChart('rain', r.values, {
      area: true, unit: 'in', dp: 3, minTop: 0.05, d0, d1,
      aria: `Cumulative rainfall ${cum ? since : 'over ' + this.dayLabel(this.DAYS[this.dayIdx])}`
    });

    // wind: the 5-minute trace over the span, with its peak called out
    const w = this.windSeries(id, d0, d1);
    this.windStatText = w.peak == null
      ? `no wind data ${cum ? since : 'this day'}`
      : `max ${this.fmt(w.peak, 1)} mph at ${this.stampAt(w.peakIdx, d0, d1)} · mean ${this.fmt(w.mean, 1)}` +
        (w.gustPeak == null ? '' : ` · gust to ${this.fmt(w.gustPeak, 1)} at ${this.stampAt(w.gustPeakIdx, d0, d1)}`) +
        (w.gaps ? ` · ${w.gaps} gaps` : '');
    this.windLegendShow = w.gustPeak != null;
    const onGust = w.gustPeak != null;
    const markIdx = onGust ? w.gustPeakIdx : (w.peak == null ? null : w.peakIdx);
    this.drawChart('wind', w.values, {
      area: false, unit: 'mph', dp: 1, minTop: 5, d0, d1,
      series2: w.gusts,
      markIndex: markIdx,
      markSeries: onGust ? w.gusts : w.values,
      markWhat: onGust ? 'max gust' : 'max',
      markColor: this.css('--accent-mark'),
      markLabel: markIdx == null ? '' : this.stampAt(markIdx, d0, d1),
      aria: `Wind speed ${cum ? since : 'over ' + this.dayLabel(this.DAYS[this.dayIdx])}` +
        (w.peak == null ? '' : `, peaking at ${this.fmt(w.peak, 1)} mph`)
    });
  }

  async setDay(i: number) {
    this.dayIdx = i;
    this.daysLoading = true;
    try {
      const [d0, d1] = this.span(i);
      await this.ensureSpan(d0, d1);          // cumulative markers need the earlier days too
      this.drawMarkers();
      this.refreshGrids();                    // fire and forget; the grids trail the markers
      this.refreshStats();
      if (this.selected && this.dayCache.get(this.dayIdx)?.has(this.selected)) this.renderStation(this.selected);
    } catch (e: any) {
      this.setStatus(e.message, true);
    } finally {
      this.daysLoading = false;
    }
  }

  async onModeToggle(ev: Event) {
    const checked = (ev.target as HTMLInputElement).checked;
    const m: Mode = checked ? 'cum' : 'day';
    if (m === this.mode) return;
    this.mode = m;
    this.updateChartHints();
    try {
      const [d0, d1] = this.span(this.dayIdx);
      if (d1 > d0) await this.ensureSpan(d0, d1);
      this.drawMarkers();                     // markers follow the toggle as well
      this.refreshGrids();
      this.refreshStats();
      if (this.selected) this.renderStation(this.selected);
    } catch (e: any) {
      this.setStatus(e.message, true);
    }
  }

  /** Keep the empty-state prompts honest about what a click will show. */
  private updateChartHints() {
    this.emptyRainText = this.mode === 'cum'
      ? 'Click a station to load its cumulative rainfall since 00:00 HST 14 Aug.'
      : 'Click a station to load its rainfall accumulated over the selected day.';
    this.emptyWindText = this.mode === 'cum'
      ? 'Click a station to load its wind speed since 00:00 HST 14 Aug, with the peak marked.'
      : 'Click a station to load its 24-hour wind speed trace, with the peak marked.';
  }

  private bootProgress(frac: number, done = false) {
    this.bootPct = Math.round(Math.max(0, Math.min(1, frac)) * 100);
    if (done) {
      this.bootOpacity = 0;
      setTimeout(() => { this.bootVisible = false; }, 400);
    }
  }
}

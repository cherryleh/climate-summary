import { Component, ElementRef, AfterViewInit, OnDestroy, ViewChild, NgZone } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { firstValueFrom, timeout, retry } from 'rxjs';
import * as L from 'leaflet';
import * as Highcharts from 'highcharts';
import { HighchartsChartModule } from 'highcharts-angular';
import { environment } from '../../environments/environment';

Highcharts.setOptions({
  time: { timezone: 'Pacific/Honolulu' }
});

type Mode = 'rain' | 'wind';
type Island = 'kauai' | 'honolulu';

interface StationSeries {
  rain: [number, number][];   // [time, 5-min amount, in]
  wind: [number, number][];   // [time, avg speed, mph]
  gust: [number, number][];   // [time, max gust, mph]
}

interface RawStation {
  id: string;
  name: string;
  lat: number;
  lng: number;
}

interface StationChart {
  id: string;
  name: string;
  lat: number;
  lng: number;
  index: number;
  rainTotal: number;
  windMax: number;
  gustMax: number;
  rainOptions: Highcharts.Options;
  windOptions: Highcharts.Options;
  options: Highcharts.Options;
  updateFlag: boolean;
}

interface IslandConfig {
  key: Island;
  label: string;
  prefix: string;   // station ID prefix for this island's county
  bounds: L.LatLngBounds;
}

@Component({
  selector: 'app-lowell-focus',
  standalone: true,
  imports: [CommonModule, HighchartsChartModule],
  templateUrl: './lowell-focus.component.html',
  styleUrl: './lowell-focus.component.css'
})
export class LowellFocusComponent implements AfterViewInit, OnDestroy {
  Highcharts: typeof Highcharts = Highcharts;

  // ------------------------------------------------------------ config
  private readonly API = 'https://api.hcdp.ikewai.org/mesonet/db';
  private readonly LOC = 'hawaii';
  private readonly RAINV = 'RF_1_Tot300s';   // 5-minute rainfall total, mm
  private readonly WINDV = 'WS_1_Avg';       // 5-minute scalar-average wind speed, m/s
  private readonly GUSTV = 'WG_1_Max';       // 5-minute maximum gust, m/s
  private readonly MM_PER_IN = 25.4;
  private readonly MPH_PER_MS = 2.236936;
  private readonly WINDOW_START = Date.parse('2026-09-07T00:00:00-10:00');
  readonly WINDOW_LABEL = 'since Sep 7, 12:00 AM HST';

  // Same basemap as hurricane-lala: Esri's free, keyless World Street Map
  // (World Physical Map's tiles only go up to native zoom 8).
  private readonly TILE_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}';

  // Station IDs are 4-digit codes; the first two digits are a county code.
  readonly ISLANDS: IslandConfig[] = [
    { key: 'kauai', label: 'Kauaʻi', prefix: '06', bounds: L.latLngBounds([21.819, -159.816], [22.269, -159.25125]) },
    { key: 'honolulu', label: 'Oʻahu', prefix: '05', bounds: L.latLngBounds([21.18, -158.322], [21.7425, -157.602]) }
  ];

  readonly MODES: { key: Mode; label: string }[] = [
    { key: 'rain', label: 'Rainfall' },
    { key: 'wind', label: 'Wind & Gust' }
  ];

  // ------------------------------------------------------------- template refs
  @ViewChild('map') private mapEl!: ElementRef<HTMLDivElement>;

  // ------------------------------------------------------------- bound state
  loading = true;
  loadPct = 0;
  statusMsg = '';
  statusErr = false;
  charts: StationChart[] = [];
  highlightedId: string | null = null;
  mode: Mode = 'rain';
  island: Island = 'kauai';

  get islandLabel(): string {
    return this.ISLANDS.find(i => i.key === this.island)!.label;
  }

  // ------------------------------------------------------------- internal state
  private allStations: RawStation[] = [];
  private seriesByStation = new Map<string, StationSeries>();
  private map: L.Map | null = null;
  private markers = new Map<string, L.Marker>();
  private mapResizeObserver: ResizeObserver | null = null;

  constructor(private http: HttpClient, private zone: NgZone) {}

  ngAfterViewInit() {
    setTimeout(() => this.boot(), 0);
  }

  ngOnDestroy() {
    this.mapResizeObserver?.disconnect();
    this.map?.remove();
  }

  // --------------------------------------------------------------- API layer
  /** A bounded timeout plus a couple of retries means a slow or flaky mesonet
   *  response surfaces as an error (or quietly recovers) instead of leaving
   *  the loading screen stuck with nothing ever rendering. */
  private async apiGet<T>(path: string, params: Record<string, any>): Promise<T> {
    const headers = new HttpHeaders({ Authorization: `Bearer ${environment.apiToken}` });
    return firstValueFrom(this.http.get<T>(`${this.API}/${path}`, { headers, params }).pipe(
      timeout(30000),
      retry({ count: 2, delay: 1500 })
    ));
  }

  /** Rounds a value up to a "nice" axis maximum, same convention used across the app. */
  private niceTop(v: number): number {
    if (!isFinite(v) || v <= 0) return 1;
    const mag = Math.pow(10, Math.floor(Math.log10(v)));
    for (const m of [1, 1.2, 1.6, 2, 2.4, 3.2, 4, 6, 8, 10]) if (v <= m * mag) return m * mag;
    return 10 * mag;
  }

  private buildRainOptions(data: [number, number][], sharedMax: number): Highcharts.Options {
    return {
      chart: { height: 220 },
      title: { text: undefined },
      credits: { enabled: false },
      xAxis: { type: 'datetime', title: { text: undefined } },
      yAxis: { title: { text: 'Rainfall (in)' }, min: 0, max: sharedMax },
      tooltip: { xDateFormat: '%b %e, %I:%M %p', pointFormat: '<b>{point.y:.2f} in</b> accumulated' },
      legend: { enabled: false },
      plotOptions: {
        series: { marker: { enabled: false }, turboThreshold: 0, lineWidth: 2, animation: false }
      },
      series: [{ type: 'area', name: 'Rainfall', data, color: '#2563eb', fillOpacity: 0.15 }]
    };
  }

  private buildWindOptions(wind: [number, number][], gust: [number, number][], sharedMax: number): Highcharts.Options {
    return {
      chart: { height: 220 },
      title: { text: undefined },
      credits: { enabled: false },
      xAxis: { type: 'datetime', title: { text: undefined } },
      yAxis: { title: { text: 'Wind (mph)' }, min: 0, max: sharedMax },
      tooltip: {
        xDateFormat: '%b %e, %I:%M %p',
        shared: true,
        pointFormat: '<span style="color:{series.color}">●</span> {series.name}: <b>{point.y:.1f} mph</b><br/>'
      },
      legend: { enabled: false },
      plotOptions: {
        series: { marker: { enabled: false }, turboThreshold: 0, lineWidth: 1.5, animation: false }
      },
      series: [
        { type: 'line', name: 'Sustained', data: wind, color: '#d03b3b' },
        { type: 'line', name: 'Gust', data: gust, color: '#fb7744' }
      ]
    };
  }

  // ---------------------------------------------------------------- mode / island toggles
  setMode(mode: Mode) {
    if (this.mode === mode) return;
    this.mode = mode;
    for (const c of this.charts) {
      c.options = mode === 'rain' ? c.rainOptions : c.windOptions;
      c.updateFlag = true;
    }
  }

  selectIsland(island: Island) {
    if (this.island === island) return;
    this.island = island;
    this.highlight(null);
    this.buildCharts();
    this.rebuildMarkers();
  }

  // -------------------------------------------------------------------- the map
  private initMap() {
    // Deferred to the next frame so the container has already been laid out —
    // see lowell-tracker for why a same-tick fitBounds can pick zoom 0.
    this.zone.runOutsideAngular(() => requestAnimationFrame(() => this.buildMap()));
  }

  private buildMap() {
    if (!this.mapEl) return;
    const m = L.map(this.mapEl.nativeElement, { zoomControl: true, zoomSnap: 0 });
    L.tileLayer(this.TILE_URL, { maxZoom: 16, attribution: 'Esri &mdash; Sources: Esri' } as any).addTo(m);
    this.map = m;
    this.rebuildMarkers();

    // A stale initial size (slow font load, HMR, a backgrounded tab) would
    // otherwise leave tiles blank or mis-zoomed with no later correction.
    this.mapResizeObserver = new ResizeObserver(() => m.invalidateSize());
    this.mapResizeObserver.observe(this.mapEl.nativeElement);
  }

  private rebuildMarkers() {
    if (!this.map) return;
    for (const mk of this.markers.values()) this.map.removeLayer(mk);
    this.markers.clear();

    for (const c of this.charts) {
      const icon = L.divIcon({
        className: 'station-pin-wrap',
        html: `<div class="station-pin">${c.index}</div>`,
        iconSize: [26, 26],
        iconAnchor: [13, 13]
      });
      const mk = L.marker([c.lat, c.lng], { icon }).addTo(this.map);
      mk.bindTooltip(`<b>${c.index}. ${c.name}</b> (${c.id})`, { direction: 'top' });
      mk.on('click', () => this.zone.run(() => this.jumpTo(c.id)));
      this.markers.set(c.id, mk);
    }

    const bounds = this.ISLANDS.find(i => i.key === this.island)!.bounds;
    this.map.fitBounds(bounds, { animate: false, padding: [12, 12] });
  }

  // ---------------------------------------------------------------- map <-> chart linking
  jumpTo(id: string) {
    this.highlight(id);
    document.getElementById('station-' + id)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => { if (this.highlightedId === id) this.highlight(null); }, 1600);
  }

  highlight(id: string | null) {
    this.highlightedId = id;
    for (const [mid, mk] of this.markers) {
      mk.getElement()?.classList.toggle('is-active', mid === id);
    }
  }

  // ------------------------------------------------------------------ chart building
  /** Rebuilds `charts` for the currently selected island from the already-fetched
   *  statewide station/series data — no network round trip on an island switch. */
  private buildCharts() {
    const prefix = this.ISLANDS.find(i => i.key === this.island)!.prefix;
    const islandStations = this.allStations.filter(s => s.id.startsWith(prefix));

    let rainGlobalMax = 0;
    let windGlobalMax = 0;
    const accByStation = new Map<string, [number, number][]>();
    for (const st of islandStations) {
      const s = this.seriesByStation.get(st.id);
      if (!s || (!s.rain.length && !s.wind.length && !s.gust.length)) continue;
      let running = 0;
      const acc: [number, number][] = s.rain.map(([t, v]) => {
        running += v;
        return [t, +running.toFixed(3)];
      });
      accByStation.set(st.id, acc);
      rainGlobalMax = Math.max(rainGlobalMax, running);
      for (const [, v] of s.wind) windGlobalMax = Math.max(windGlobalMax, v);
      for (const [, v] of s.gust) windGlobalMax = Math.max(windGlobalMax, v);
    }

    const rainSharedMax = this.niceTop(rainGlobalMax);
    const windSharedMax = this.niceTop(windGlobalMax);
    let i = 0;
    this.charts = islandStations
      .filter(st => accByStation.has(st.id))
      .map(st => {
        const acc = accByStation.get(st.id)!;
        const s = this.seriesByStation.get(st.id)!;
        const windMax = s.wind.reduce((m, [, v]) => Math.max(m, v), 0);
        const gustMax = s.gust.reduce((m, [, v]) => Math.max(m, v), 0);
        i++;
        const rainOptions = this.buildRainOptions(acc, rainSharedMax);
        const windOptions = this.buildWindOptions(s.wind, s.gust, windSharedMax);
        return {
          id: st.id, name: st.name, lat: st.lat, lng: st.lng, index: i,
          rainTotal: acc.length ? acc[acc.length - 1][1] : 0,
          windMax, gustMax,
          rainOptions, windOptions,
          options: this.mode === 'rain' ? rainOptions : windOptions,
          updateFlag: false
        };
      });

    this.statusMsg = `${this.charts.length} ${this.islandLabel} Mesonet stations · ${this.WINDOW_LABEL}`;
  }

  private progress(frac: number) {
    this.loadPct = Math.round(Math.max(0, Math.min(1, frac)) * 100);
  }

  /** Re-runs start-up after a failed load — bound to the retry button. */
  retry() {
    this.loading = true;
    this.statusErr = false;
    this.progress(0);
    this.boot();
  }

  // ------------------------------------------------------------------ start-up
  private async boot() {
    this.progress(0.05);
    try {
      const stationRows = await this.apiGet<any[]>('stations', { location: this.LOC });
      this.allStations = stationRows
        .filter(s => s.lat && s.lng)
        .map(s => ({
          id: String(s.station_id),
          name: s.full_name || s.name || s.station_id,
          lat: +s.lat, lng: +s.lng
        }));
      this.progress(0.35);

      const rows = await this.apiGet<any[]>('measurements', {
        location: this.LOC,
        var_ids: `${this.RAINV},${this.WINDV},${this.GUSTV}`,
        start_date: new Date(this.WINDOW_START).toISOString(),
        end_date: new Date().toISOString(),
        row_mode: 'json',
        limit: 1000000
      });
      this.progress(0.8);

      for (const r of rows) {
        if (r.flag !== 0 || r.value == null || r.value === '') continue;
        const raw = +r.value;
        if (!isFinite(raw)) continue;
        let s = this.seriesByStation.get(r.station_id);
        if (!s) { s = { rain: [], wind: [], gust: [] }; this.seriesByStation.set(r.station_id, s); }
        const t = Date.parse(r.timestamp);
        if (r.variable === this.RAINV) s.rain.push([t, raw / this.MM_PER_IN]);
        else if (r.variable === this.WINDV) s.wind.push([t, raw * this.MPH_PER_MS]);
        else if (r.variable === this.GUSTV) s.gust.push([t, raw * this.MPH_PER_MS]);
      }
      for (const s of this.seriesByStation.values()) {
        s.rain.sort((a, b) => a[0] - b[0]);
        s.wind.sort((a, b) => a[0] - b[0]);
        s.gust.sort((a, b) => a[0] - b[0]);
      }

      this.buildCharts();
      this.initMap();
      this.progress(1);
    } catch (e: any) {
      this.statusErr = true;
      this.statusMsg = e?.message || 'Failed to load Hawaiʻi Mesonet data.';
      this.progress(1);
    } finally {
      this.loading = false;
    }
  }
}

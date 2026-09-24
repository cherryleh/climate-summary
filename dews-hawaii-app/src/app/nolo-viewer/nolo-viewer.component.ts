import { Component, ElementRef, AfterViewInit, OnDestroy, ViewChild, NgZone } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { firstValueFrom, timeout, retry } from 'rxjs';
import * as L from 'leaflet';
import * as Highcharts from 'highcharts';
import { HighchartsChartModule } from 'highcharts-angular';
import { environment } from '../../environments/environment';
import { NoloHourlyMapComponent } from './nolo-hourly-map.component';
import {
  County, CountyFilter, MapMode, MapKind, Station, StationSeries,
  compass, sizeScale, rampRGB, gustIcon, legendFor, LegendTick, RAIN_RAMP, WIND_RAMP, TILE_URL,
  STATEWIDE_BOUNDS, COUNTY_BOUNDS, COUNTIES, NODATA_COLOR
} from './nolo-map';

Highcharts.setOptions({
  time: { timezone: 'Pacific/Honolulu' }
});

@Component({
  selector: 'app-nolo-viewer',
  standalone: true,
  imports: [CommonModule, HighchartsChartModule, NoloHourlyMapComponent],
  templateUrl: './nolo-viewer.component.html',
  styleUrl: './nolo-viewer.component.css'
})
export class NoloViewerComponent implements AfterViewInit, OnDestroy {
  Highcharts: typeof Highcharts = Highcharts;

  // ------------------------------------------------------------ config
  private readonly API = 'https://api.hcdp.ikewai.org/mesonet/db';
  private readonly LOC = 'hawaii';
  private readonly RAINV = 'RF_1_Tot300s';   // 5-minute rainfall total, mm
  private readonly WINDV = 'WS_1_Avg';       // 5-minute scalar-average wind speed, m/s
  private readonly GUSTV = 'WG_1_Max';       // 5-minute maximum gust, m/s
  private readonly DIRV = 'WDrs_1_Avg';      // 5-minute vector-average wind direction, degrees from north the wind blew from
  private readonly MM_PER_IN = 25.4;
  private readonly MPH_PER_MS = 2.236936;
  readonly WINDOW_START = Date.parse('2026-09-22T22:00:00-10:00');
  readonly WINDOW_LABEL = 'since Sep 22, 10:00 PM HST';

  private readonly STATEWIDE_BOUNDS = STATEWIDE_BOUNDS;
  private readonly COUNTY_BOUNDS = COUNTY_BOUNDS;

  // Station IDs are 4-digit codes; the first two digits are a county code.
  // '01' Maui, '03' Lānaʻi, '04' Molokaʻi — all part of Maui County.
  private readonly COUNTY_PREFIXES: Record<string, County> = {
    '02': 'hawaii', '01': 'maui', '03': 'maui', '04': 'maui', '05': 'honolulu', '06': 'kauai'
  };
  readonly COUNTIES = COUNTIES;

  readonly MAP_KINDS: Record<MapMode, MapKind> = {
    rain: {
      label: 'Rainfall total', unit: 'inches, total (log)',
      domain: 15, soft: 0.1, ticks: [0, 0.25, 0.5, 1, 2, 4, 8, 15],
      ramp: RAIN_RAMP,
      fmt: v => v.toFixed(2) + ' in'
    },
    gust: {
      label: 'Max wind gust', unit: 'mph, max gust (log)',
      domain: 80, soft: 10, ticks: [0, 4, 9, 15, 25, 38, 55, 80],
      ramp: WIND_RAMP,
      fmt: v => v.toFixed(1) + ' mph'
    }
  };
  readonly MAP_MODES: MapMode[] = ['rain', 'gust'];

  // ------------------------------------------------------------- template refs
  @ViewChild('map') private mapEl!: ElementRef<HTMLDivElement>;

  // ------------------------------------------------------------- bound state
  loading = true;
  loadPct = 0;
  statusMsg = '';
  statusErr = false;

  selectedId: string | null = null;
  selectedName = 'No station selected';
  selectedMeta = '';
  hasSelection = false;
  selectedCounty: CountyFilter = 'all';
  selectedRainTotal = 0;
  selectedMaxWind = 0;
  selectedMaxGust = 0;
  selectedGustDir = '';

  mapMode: MapMode = 'rain';
  legendGradient = '';
  legendTicks: LegendTick[] = [];

  rainUpdateFlag = false;
  windUpdateFlag = false;

  // Direct chart references, captured once on creation. Switching stations
  // rebuilds `*ngOptions` and flips the update flag, which is normally
  // enough to make highcharts-angular redraw — but for one station (Lāwaʻi,
  // 0621) the wind chart was reported to sometimes keep showing the
  // previously-selected station's trace. Rather than trust the declarative
  // [options]/[(update)] binding's internal timing, updateCharts() also
  // calls chart.update() on these refs directly, which is synchronous and
  // unambiguous regardless of whatever caused the stale redraw.
  private rainChartRef?: Highcharts.Chart;
  private windChartRef?: Highcharts.Chart;
  rainChartCallback: Highcharts.ChartCallbackFunction = (chart) => { this.rainChartRef = chart; };
  windChartCallback: Highcharts.ChartCallbackFunction = (chart) => { this.windChartRef = chart; };

  rainChartOptions: Highcharts.Options = {
    chart: { height: 260, zooming: { type: 'x' } },
    title: { text: undefined },
    credits: { enabled: false },
    xAxis: { type: 'datetime', title: { text: undefined } },
    yAxis: { title: { text: 'Rainfall accumulated (in)' }, min: 0 },
    tooltip: { xDateFormat: '%b %e, %I:%M %p', pointFormat: '<b>{point.y:.2f} in</b> accumulated' },
    legend: { enabled: false },
    plotOptions: {
      series: { marker: { enabled: false }, turboThreshold: 0, lineWidth: 2, animation: false }
    },
    series: [{ type: 'area', name: 'Rainfall', data: [], color: '#2563eb', fillOpacity: 0.15 }]
  };

  windChartOptions: Highcharts.Options = {
    chart: { height: 260, zooming: { type: 'x' } },
    title: { text: undefined },
    credits: { enabled: false },
    xAxis: { type: 'datetime', title: { text: undefined } },
    yAxis: [
      { title: { text: 'Wind (mph)' }, min: 0 },
      {
        title: { text: 'Direction (from)' }, opposite: true, min: 0, max: 360, tickPositions: [0, 90, 180, 270, 360],
        gridLineWidth: 0,
        labels: { formatter() { return ['N', 'E', 'S', 'W', 'N'][Math.round(+this.value / 90)]; } }
      }
    ],
    tooltip: {
      xDateFormat: '%b %e, %I:%M %p',
      shared: true,
      pointFormatter() {
        const dir = this.series.name === 'Direction';
        const val = dir ? `${Math.round(this.y!)}° (${compass(this.y!)})` : `${this.y!.toFixed(1)} mph`;
        return `<span style="color:${this.color}">●</span> ${this.series.name}: <b>${val}</b><br/>`;
      }
    },
    legend: { enabled: true },
    plotOptions: {
      series: { marker: { enabled: false }, turboThreshold: 0, lineWidth: 1.5, animation: false }
    },
    series: [
      { type: 'line', name: 'Sustained', data: [], color: '#d03b3b' },
      { type: 'line', name: 'Gust', data: [], color: '#fb7744' },
      this.dirSeries([])
    ]
  };

  private dirSeries(data: [number, number][]): Highcharts.SeriesScatterOptions {
    return {
      type: 'scatter', name: 'Direction', data, yAxis: 1, color: 'rgba(71,85,105,.45)', lineWidth: 0,
      marker: { enabled: true, radius: 1.6, symbol: 'circle' }, stickyTracking: true
    };
  }

  // ------------------------------------------------------------- internal state
  stations: Station[] = [];
  private stationById = new Map<string, Station>();
  seriesByStation = new Map<string, StationSeries>();
  private rainMarkers = new Map<string, L.CircleMarker>();
  private gustMarkers = new Map<string, L.Marker>();
  private map: L.Map | null = null;
  private mapResizeObserver: ResizeObserver | null = null;

  constructor(private http: HttpClient, private zone: NgZone) {
    this.buildLegend();
  }

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

  private async loadStations(): Promise<void> {
    const rows = await this.apiGet<any[]>('stations', { location: this.LOC });
    this.stations = rows
      .filter(s => s.lat && s.lng)
      .map(s => ({
        id: s.station_id,
        name: s.full_name || s.name || s.station_id,
        lat: +s.lat, lng: +s.lng,
        county: this.COUNTY_PREFIXES[String(s.station_id).slice(0, 2)] ?? null,
        active: s.status === 'active'
      }));
  }

  /** Keep stations the mesonet lists as active (so they show before the storm
   *  window has any data) plus any that reported in the window, and index them. */
  private keepActiveStations(): void {
    this.stations = this.stations.filter(s => s.active || this.seriesByStation.has(s.id));
    this.stationById.clear();
    this.stations.forEach(s => this.stationById.set(s.id, s));
  }

  private visibleStations(): Station[] {
    if (this.selectedCounty === 'all') return this.stations;
    return this.stations.filter(s => s.county === this.selectedCounty);
  }

  private async loadLatest(): Promise<void> {
    const rows = await this.apiGet<any[]>('measurements', {
      location: this.LOC,
      var_ids: `${this.RAINV},${this.WINDV},${this.GUSTV},${this.DIRV}`,
      start_date: new Date(this.WINDOW_START).toISOString(),
      end_date: new Date().toISOString(),
      row_mode: 'json',
      local_tz: true,
      limit: 1000000
    });

    for (const r of rows) {
      if (r.flag !== 0 || r.value == null || r.value === '') continue;
      const raw = +r.value;
      if (!isFinite(raw)) continue;
      const t = Date.parse(r.timestamp);
      let s = this.seriesByStation.get(r.station_id);
      if (!s) { s = { rain: [], wind: [], gust: [], dir: [] }; this.seriesByStation.set(r.station_id, s); }
      if (r.variable === this.RAINV) s.rain.push([t, raw / this.MM_PER_IN]);
      else if (r.variable === this.WINDV) s.wind.push([t, raw * this.MPH_PER_MS]);
      else if (r.variable === this.GUSTV) s.gust.push([t, raw * this.MPH_PER_MS]);
      else if (r.variable === this.DIRV) s.dir.push([t, ((raw % 360) + 360) % 360]);
    }
    for (const s of this.seriesByStation.values()) {
      s.rain.sort((a, b) => a[0] - b[0]);
      s.wind.sort((a, b) => a[0] - b[0]);
      s.gust.sort((a, b) => a[0] - b[0]);
      s.dir.sort((a, b) => a[0] - b[0]);
    }
  }

  private totalRain(id: string): number {
    const s = this.seriesByStation.get(id);
    return s ? s.rain.reduce((sum, p) => sum + p[1], 0) : 0;
  }

  private maxOf(points: [number, number][]): number {
    return points.reduce((m, p) => Math.max(m, p[1]), 0);
  }

  /** Direction the wind blew from in the 5 minutes that held the station's peak gust. */
  private maxGustDir(id: string): number {
    const s = this.seriesByStation.get(id);
    if (!s?.gust.length) return NaN;
    const peak = s.gust.reduce((a, b) => (b[1] > a[1] ? b : a));
    return s.dir.find(d => d[0] === peak[0])?.[1] ?? NaN;
  }

  // -------------------------------------------------------------------- the map
  private initMap() {
    // The data can resolve before the browser has laid out the map container
    // (its size comes from an aspect-ratio on a CSS grid track), so a
    // same-tick fitBounds sees a zero-width box and picks zoom 0. Deferring
    // to the next frame guarantees layout has run first.
    this.zone.runOutsideAngular(() => requestAnimationFrame(() => this.buildMap()));
  }

  private buildMap() {
    const m = L.map(this.mapEl.nativeElement, { zoomControl: true, zoomSnap: 0 });
    L.tileLayer(TILE_URL, { maxZoom: 16, attribution: 'Esri &mdash; Sources: Esri' } as any).addTo(m);
    m.fitBounds(this.STATEWIDE_BOUNDS, { animate: false });
    this.map = m;
    this.drawMarkers();

    // Leaflet reads its container's size once at construction. The rAF this
    // runs on is a best effort, not a guarantee — a slow font load, dev-server
    // HMR, or a backgrounded tab delaying that frame can still leave it with
    // a stale (often zero) size, so tiles come in blank or at the wrong zoom.
    // A ResizeObserver catches that whenever the container's real size lands.
    this.mapResizeObserver = new ResizeObserver(() => m.invalidateSize());
    this.mapResizeObserver.observe(this.mapEl.nativeElement);
  }

  // ------------------------------------------------------------- colour scale
  private sizeScale(v: number): number { return sizeScale(v, this.MAP_KINDS[this.mapMode]); }

  private buildLegend() {
    ({ gradient: this.legendGradient, ticks: this.legendTicks } = legendFor(this.MAP_KINDS[this.mapMode]));
  }

  /** The station's value for the current map mode, or NaN when it has no data in the window. */
  private mapValue(id: string): number {
    const s = this.seriesByStation.get(id);
    if (this.mapMode === 'rain') return s?.rain.length ? this.totalRain(id) : NaN;
    return s?.gust.length ? this.maxOf(s.gust) : NaN;
  }

  private drawMarkers() {
    if (!this.map) return;
    for (const st of this.stations) {
      const mk = L.circleMarker([st.lat, st.lng], { radius: 5, fillOpacity: 0.9, opacity: 1 });
      const gm = L.marker([st.lat, st.lng], { keyboard: false });
      for (const m of [mk, gm] as L.Layer[]) {
        m.on('click', () => this.zone.run(() => this.select(st.id)));
      }
      this.rainMarkers.set(st.id, mk);
      this.gustMarkers.set(st.id, gm);
    }
    this.renderMarkers();
  }

  /** Puts the right marker for the current mode on the map for each visible
   *  station, coloured and sized by its value, with the selection outlined. */
  private renderMarkers() {
    const map = this.map;
    if (!map) return;
    const K = this.MAP_KINDS[this.mapMode];
    const visibleIds = new Set(this.visibleStations().map(s => s.id));
    const drop = (m?: L.Layer) => { if (m && map.hasLayer(m)) map.removeLayer(m); };

    // Draw no-data stations first and the biggest values last, so they sit on top.
    const order = this.stations
      .map(st => ({ st, v: this.mapValue(st.id) }))
      .sort((a, b) => (isFinite(a.v) ? a.v : -1) - (isFinite(b.v) ? b.v : -1));

    for (const { st, v } of order) {
      const mk = this.rainMarkers.get(st.id)!, gm = this.gustMarkers.get(st.id)!;
      if (!visibleIds.has(st.id)) { drop(mk); drop(gm); continue; }
      const picked = st.id === this.selectedId;
      const has = isFinite(v);
      const dir = this.mapMode === 'gust' && has ? this.maxGustDir(st.id) : NaN;
      const from = isFinite(dir) ? ` from ${Math.round(dir)}° (${compass(dir)})` : '';
      const tip = `<b>${st.name}</b> (${st.id})<br>${K.label}: ${has ? K.fmt(v) + from : 'no data'} ${this.WINDOW_LABEL}`;

      if (this.mapMode === 'gust' && has) {
        drop(mk);
        const t = this.sizeScale(v);
        gm.setIcon(gustIcon(v, dir, t, picked, K));
        gm.setZIndexOffset(picked ? 100000 : Math.round(Math.min(1, t) * 50000));
        gm.bindTooltip(tip, { direction: 'top' });
        if (!map.hasLayer(gm)) gm.addTo(map);
      } else {
        drop(gm);
        const t = has ? this.sizeScale(v) : 0;
        const [r, g, b] = rampRGB(t, K);
        mk.setRadius(has ? 4 + t * 16 : 3.5);
        mk.setStyle({
          fillColor: has ? `rgb(${r},${g},${b})` : NODATA_COLOR,
          fillOpacity: has ? 0.9 : 0.6,
          color: picked ? '#000' : '#fff',
          weight: picked ? 3 : 1.5
        });
        mk.bindTooltip(tip, { direction: 'top', sticky: true });
        if (!map.hasLayer(mk)) mk.addTo(map);
        mk.bringToFront();
      }
    }
  }

  setMapMode(mode: MapMode) {
    if (this.mapMode === mode) return;
    this.mapMode = mode;
    this.buildLegend();
    this.renderMarkers();
  }

  // -------------------------------------------------------------- county filter
  selectCounty(county: CountyFilter) {
    if (this.selectedCounty === county) return;
    this.selectedCounty = county;
    this.updateMarkerVisibility();
  }

  private updateMarkerVisibility() {
    if (!this.map) return;
    const visibleIds = new Set(this.visibleStations().map(s => s.id));
    if (this.selectedId && !visibleIds.has(this.selectedId)) {
      this.selectedId = null;
      this.selectedName = 'No station selected';
      this.selectedMeta = '';
      this.hasSelection = false;
    }
    this.renderMarkers();

    const bounds = this.selectedCounty === 'all' ? this.STATEWIDE_BOUNDS : this.COUNTY_BOUNDS[this.selectedCounty];
    this.map.fitBounds(bounds, { animate: true, padding: [12, 12] });
  }

  // ---------------------------------------------------------------- selection
  select(id: string) {
    const st = this.stationById.get(id);
    if (!st) return;
    this.selectedId = id;
    this.selectedName = st.name;
    this.selectedMeta = st.id;
    this.hasSelection = true;
    this.renderMarkers();
    this.updateCharts(id);
  }

  private updateCharts(id: string) {
    const s = this.seriesByStation.get(id);
    this.selectedRainTotal = this.totalRain(id);
    this.selectedMaxWind = this.maxOf(s?.wind ?? []);
    this.selectedMaxGust = this.maxOf(s?.gust ?? []);
    const gd = this.maxGustDir(id);
    this.selectedGustDir = isFinite(gd) ? `from ${compass(gd)}` : '';

    let running = 0;
    const rainData: [number, number][] = (s?.rain ?? []).map(([t, v]) => {
      running += v;
      return [t, +running.toFixed(3)];
    });
    this.rainChartOptions = {
      ...this.rainChartOptions,
      series: [{ type: 'area', name: 'Rainfall', data: rainData, color: '#2563eb', fillOpacity: 0.15 }]
    };
    this.rainUpdateFlag = true;

    const windData = s?.wind ?? [];
    const gustData = s?.gust ?? [];
    const dirData = s?.dir ?? [];
    this.windChartOptions = {
      ...this.windChartOptions,
      series: [
        { type: 'line', name: 'Sustained', data: windData, color: '#d03b3b' },
        { type: 'line', name: 'Gust', data: gustData, color: '#fb7744' },
        this.dirSeries(dirData)
      ]
    };
    this.windUpdateFlag = true;

    // Belt-and-suspenders: call setData directly on the live chart refs
    // instead of trusting the declarative [options]/[(update)] binding alone.
    if (this.rainChartRef?.series[0]) this.rainChartRef.series[0].setData(rainData, true, false, false);
    if (this.windChartRef?.series[0] && this.windChartRef.series[1] && this.windChartRef.series[2]) {
      this.windChartRef.series[0].setData(windData, false, false, false);
      this.windChartRef.series[1].setData(gustData, false, false, false);
      this.windChartRef.series[2].setData(dirData, true, false, false);
    }
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
      await this.loadStations();
      const total = this.stations.length;
      this.progress(0.35);
      await this.loadLatest();
      this.progress(0.85);
      this.keepActiveStations();
      this.initMap();
      this.progress(1);

      this.statusMsg = `${this.stations.length} of ${total} Hawaiʻi Mesonet stations active · ${this.WINDOW_LABEL}`;
    } catch (e: any) {
      this.statusErr = true;
      this.statusMsg = e?.message || 'Failed to load Hawaiʻi Mesonet data.';
      this.progress(1);
    } finally {
      this.loading = false;
    }
  }
}

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

type County = 'hawaii' | 'maui' | 'honolulu' | 'kauai';
type CountyFilter = 'all' | County;

interface Station {
  id: string;
  name: string;
  lat: number;
  lng: number;
  county: County | null;
}

interface StationSeries {
  rain: [number, number][];   // [time, 5-min amount, in]
  wind: [number, number][];   // [time, avg speed, mph]
  gust: [number, number][];   // [time, max gust, mph]
}

@Component({
  selector: 'app-lowell-tracker',
  standalone: true,
  imports: [CommonModule, HighchartsChartModule],
  templateUrl: './lowell-tracker.component.html',
  styleUrl: './lowell-tracker.component.css'
})
export class LowellTrackerComponent implements AfterViewInit, OnDestroy {
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
  private readonly STATEWIDE_BOUNDS = L.latLngBounds([18.849, -159.816], [22.269, -154.668]);

  // Fixed island/county extents (not derived from station positions, which
  // don't reach every coastline and were clipping Oʻahu and Kauaʻi).
  private readonly COUNTY_BOUNDS: Record<County, L.LatLngBounds> = {
    kauai: L.latLngBounds([21.819, -159.816], [22.269, -159.25125]),
    honolulu: L.latLngBounds([21.18, -158.322], [21.7425, -157.602]),
    maui: L.latLngBounds([20.343, -157.35], [21.32175, -155.92575]),
    hawaii: L.latLngBounds([18.849, -156.243], [20.334, -154.668])
  };

  // Station IDs are 4-digit codes; the first two digits are a county code.
  // '01' Maui, '03' Lānaʻi, '04' Molokaʻi — all part of Maui County.
  private readonly COUNTY_PREFIXES: Record<string, County> = {
    '02': 'hawaii', '01': 'maui', '03': 'maui', '04': 'maui', '05': 'honolulu', '06': 'kauai'
  };
  readonly COUNTIES: { key: CountyFilter; label: string }[] = [
    { key: 'all', label: 'Statewide' },
    { key: 'hawaii', label: 'Hawaiʻi' },
    { key: 'maui', label: 'Maui' },
    { key: 'honolulu', label: 'Oʻahu' },
    { key: 'kauai', label: 'Kauaʻi' }
  ];
  private readonly MARKER_COLOR = '#2563eb';

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
    yAxis: { title: { text: 'Wind (mph)' }, min: 0 },
    tooltip: {
      xDateFormat: '%b %e, %I:%M %p',
      shared: true,
      pointFormat: '<span style="color:{series.color}">●</span> {series.name}: <b>{point.y:.1f} mph</b><br/>'
    },
    legend: { enabled: true },
    plotOptions: {
      series: { marker: { enabled: false }, turboThreshold: 0, lineWidth: 1.5, animation: false }
    },
    series: [
      { type: 'line', name: 'Sustained', data: [], color: '#d03b3b' },
      { type: 'line', name: 'Gust', data: [], color: '#fb7744' }
    ]
  };

  // ------------------------------------------------------------- internal state
  private stations: Station[] = [];
  private stationById = new Map<string, Station>();
  private seriesByStation = new Map<string, StationSeries>();
  private markers = new Map<string, L.CircleMarker>();
  private map: L.Map | null = null;
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

  private async loadStations(): Promise<void> {
    const rows = await this.apiGet<any[]>('stations', { location: this.LOC });
    this.stations = rows
      .filter(s => s.lat && s.lng)
      .map(s => ({
        id: s.station_id,
        name: s.full_name || s.name || s.station_id,
        lat: +s.lat, lng: +s.lng,
        county: this.COUNTY_PREFIXES[String(s.station_id).slice(0, 2)] ?? null
      }));
  }

  /** Keep only stations that actually reported in the window, and index them. */
  private keepActiveStations(): void {
    this.stations = this.stations.filter(s => this.seriesByStation.has(s.id));
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
      var_ids: `${this.RAINV},${this.WINDV},${this.GUSTV}`,
      start_date: new Date(this.WINDOW_START).toISOString(),
      end_date: new Date().toISOString(),
      row_mode: 'json',
      limit: 1000000
    });

    for (const r of rows) {
      if (r.flag !== 0 || r.value == null || r.value === '') continue;
      const raw = +r.value;
      if (!isFinite(raw)) continue;
      const t = Date.parse(r.timestamp);
      let s = this.seriesByStation.get(r.station_id);
      if (!s) { s = { rain: [], wind: [], gust: [] }; this.seriesByStation.set(r.station_id, s); }
      if (r.variable === this.RAINV) s.rain.push([t, raw / this.MM_PER_IN]);
      else if (r.variable === this.WINDV) s.wind.push([t, raw * this.MPH_PER_MS]);
      else if (r.variable === this.GUSTV) s.gust.push([t, raw * this.MPH_PER_MS]);
    }
    for (const s of this.seriesByStation.values()) {
      s.rain.sort((a, b) => a[0] - b[0]);
      s.wind.sort((a, b) => a[0] - b[0]);
      s.gust.sort((a, b) => a[0] - b[0]);
    }
  }

  private totalRain(id: string): number {
    const s = this.seriesByStation.get(id);
    return s ? s.rain.reduce((sum, p) => sum + p[1], 0) : 0;
  }

  private maxOf(points: [number, number][]): number {
    return points.reduce((m, p) => Math.max(m, p[1]), 0);
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
    L.tileLayer(this.TILE_URL, { maxZoom: 16, attribution: 'Esri &mdash; Sources: Esri' } as any).addTo(m);
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

  private drawMarkers() {
    if (!this.map) return;
    for (const st of this.stations) {
      const mk = L.circleMarker([st.lat, st.lng], {
        radius: 5,
        fillColor: this.MARKER_COLOR,
        fillOpacity: 0.85,
        color: '#1d1d1d', weight: 1, opacity: 0.8
      }).addTo(this.map);
      const total = this.totalRain(st.id);
      mk.bindTooltip(
        `<b>${st.name}</b> (${st.id})<br>${total.toFixed(2)} in ${this.WINDOW_LABEL}`,
        { direction: 'top', sticky: true }
      );
      mk.on('click', () => this.zone.run(() => this.select(st.id)));
      this.markers.set(st.id, mk);
    }
  }

  // -------------------------------------------------------------- county filter
  selectCounty(county: CountyFilter) {
    if (this.selectedCounty === county) return;
    this.selectedCounty = county;
    this.updateMarkerVisibility();
  }

  private updateMarkerVisibility() {
    if (!this.map) return;
    const visible = this.visibleStations();
    const visibleIds = new Set(visible.map(s => s.id));

    for (const [id, mk] of this.markers) {
      const show = visibleIds.has(id);
      const onMap = this.map.hasLayer(mk);
      if (show && !onMap) mk.addTo(this.map);
      if (!show && onMap) this.map.removeLayer(mk);
    }

    const bounds = this.selectedCounty === 'all' ? this.STATEWIDE_BOUNDS : this.COUNTY_BOUNDS[this.selectedCounty];
    this.map.fitBounds(bounds, { animate: true, padding: [12, 12] });

    if (this.selectedId && !visibleIds.has(this.selectedId)) {
      this.selectedId = null;
      this.selectedName = 'No station selected';
      this.selectedMeta = '';
      this.hasSelection = false;
    }
  }

  private highlight() {
    for (const [id, mk] of this.markers) {
      const on = id === this.selectedId;
      mk.setStyle({ color: on ? '#000' : '#1d1d1d', weight: on ? 3 : 1, radius: on ? 7 : 5 });
      if (on) mk.bringToFront();
    }
  }

  // ---------------------------------------------------------------- selection
  select(id: string) {
    const st = this.stationById.get(id);
    if (!st) return;
    this.selectedId = id;
    this.selectedName = st.name;
    this.selectedMeta = st.id;
    this.hasSelection = true;
    this.highlight();
    this.updateCharts(id);
  }

  private updateCharts(id: string) {
    const s = this.seriesByStation.get(id);
    this.selectedRainTotal = this.totalRain(id);
    this.selectedMaxWind = this.maxOf(s?.wind ?? []);
    this.selectedMaxGust = this.maxOf(s?.gust ?? []);

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
    this.windChartOptions = {
      ...this.windChartOptions,
      series: [
        { type: 'line', name: 'Sustained', data: windData, color: '#d03b3b' },
        { type: 'line', name: 'Gust', data: gustData, color: '#fb7744' }
      ]
    };
    this.windUpdateFlag = true;

    // Belt-and-suspenders: call setData directly on the live chart refs
    // instead of trusting the declarative [options]/[(update)] binding alone.
    if (this.rainChartRef?.series[0]) this.rainChartRef.series[0].setData(rainData, true, false, false);
    if (this.windChartRef?.series[0] && this.windChartRef.series[1]) {
      this.windChartRef.series[0].setData(windData, false, false, false);
      this.windChartRef.series[1].setData(gustData, true, false, false);
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

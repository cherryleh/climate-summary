import { Component, ElementRef, AfterViewInit, OnDestroy, ViewChild, NgZone } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import * as L from 'leaflet';
import * as GeoTIFF from 'geotiff';
import { Pool } from 'geotiff';
import { environment } from '../../../../environments/environment';

interface Station { id: string; name: string; lat: number; lng: number; five: (number | null)[]; reported: number; }
interface ParsedRaster {
  band: Float32Array;
  width: number; height: number;
  xmin: number; ymin: number; xmax: number; ymax: number;
  pixelWidth: number; pixelHeight: number;
  noData: number | null;
}

@Component({
  selector: 'app-wettest-hour',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './wettest-hour.component.html',
  styleUrl: './wettest-hour.component.css'
})
export class WettestHourComponent implements AfterViewInit, OnDestroy {
  // ------------------------------------------------------------ config
  private readonly API = 'https://api.hcdp.ikewai.org/mesonet/db';
  private readonly LOC = 'hawaii';
  private readonly RAINV = 'RF_1_Tot300s';
  private readonly MM_PER_IN = 25.4;
  private readonly SLOT_MS = 5 * 60 * 1000;

  private readonly DAY_START = Date.parse('2026-08-15T00:00:00-10:00');
  private readonly DAY_END = this.DAY_START + 24 * 60 * 60 * 1000;
  private readonly N_PTS = 289;
  private ptTime(k: number): number { return this.DAY_START + k * this.SLOT_MS; }

  private readonly HOUR_END = Date.parse('2026-08-15T20:30:00-10:00');
  private readonly HOUR_START = this.HOUR_END - 60 * 60 * 1000;
  private readonly K0 = Math.round((this.HOUR_START - this.DAY_START) / this.SLOT_MS);   // 234
  private readonly K1 = Math.round((this.HOUR_END - this.DAY_START) / this.SLOT_MS);     // 246

  // Hawaii County, matching the extent the radar crop and the coastline are cut to
  private readonly BOX = { w: -156.243, e: -154.668, s: 18.849, n: 20.334 };
  private readonly BOUNDS = L.latLngBounds([this.BOX.s, this.BOX.w], [this.BOX.n, this.BOX.e]);

  private readonly MRMS_URL = 'data/hurricane-lala/wettest-hour/mrms_qpe01h_20260816T0700Z_hawaii_cog.tif';
  private readonly COAST_URL = 'data/hurricane-lala/wettest-hour/coastline_hawaii.geojson';
  private readonly MRMS_CREDIT = 'MRMS 8pm–9pm HST — Radar Derived Hourly Rainfall Rates';
  private readonly MRMS_PROJECT = 'https://www.nssl.noaa.gov/projects/mrms/';

  private readonly OPEN_WITH = '0231';   // Kaiholena — the gauge that owns this hour

  private readonly DOMAIN = 4;
  private readonly SOFT = 0.05;
  readonly TICKS = [0, 0.05, 0.12, 0.3, 0.6, 1.2, 2.2, 4];

  // CARTO's basemap tiles now require an API key; Esri's Light Gray Canvas
  // is the free, keyless equivalent of "light_all".
  private readonly TILE_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}';

  // low -> high: pale green through green, yellow, orange and red to purple and magenta
  private readonly RAD_STOPS = ['#cdefb0', '#6ece4a', '#1f9c2a', '#f2f043', '#f9a72b', '#ef4423', '#c01111', '#8e2f9e', '#ef7ff0'];

  // ------------------------------------------------------------- template refs
  @ViewChild('map') private mapEl!: ElementRef<HTMLDivElement>;
  @ViewChild('chart') private chartEl!: ElementRef<SVGSVGElement>;
  @ViewChild('tip') private tipEl!: ElementRef<HTMLDivElement>;

  // ------------------------------------------------------------- bound state
  loading = true;
  loadPct = 0;
  statusMsg = '';
  statusErr = false;

  rampStyle = '';
  tickLabels: { value: number; pct: number; shift: string }[] = [];
  credit = '';
  note = '';

  readout: { show: boolean; color: string; value: string; coord: string } = { show: false, color: '', value: '', coord: '' };

  selected: string | null = null;
  who = 'No gauge selected';
  stat = '';
  showPair = false;
  vGauge = '—'; vRadar = '—'; vRank = '—'; vDay = '—';
  chartNote = '';

  // ------------------------------------------------------------- internal state
  private stations: Station[] = [];
  private series = new Map<string, Float64Array>();
  private hourly = new Map<string, number>();
  private markers = new Map<string, L.CircleMarker>();

  private map: L.Map | null = null;
  private rampStopsRgb: [number, number, number][] | null = null;
  private raster: ParsedRaster | null = null;
  private tiffPool = new Pool(Math.min(4, navigator.hardwareConcurrency || 4));

  constructor(private http: HttpClient, private zone: NgZone) {}

  ngAfterViewInit() {
    setTimeout(() => this.boot(), 0);
  }

  ngOnDestroy() {
    this.map?.remove();
    (this.tiffPool as any)?.destroy?.();
  }

  // ---------------------------------------------------------------- helpers
  private setStatus(msg: string, err = false) {
    this.statusMsg = msg;
    this.statusErr = err;
  }

  private fmtHM(ms: number): string {
    return new Date(ms).toLocaleString('en-US', {
      timeZone: 'Pacific/Honolulu', hour: '2-digit', minute: '2-digit', hour12: false
    });
  }

  // --------------------------------------------------------------- the scale
  private magScale(v: number): number {
    return Math.min(1, Math.log1p(Math.max(0, v) / this.SOFT) / Math.log1p(this.DOMAIN / this.SOFT));
  }

  private rampStopsRgbList(): [number, number, number][] {
    if (this.rampStopsRgb) return this.rampStopsRgb;
    const out: [number, number, number][] = this.RAD_STOPS.map(hex => {
      const h = hex.replace('#', '');
      return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
    });
    this.rampStopsRgb = out;
    return out;
  }

  private rampAtRgb(t: number): [number, number, number] {
    const st = this.rampStopsRgbList();
    const x = Math.max(0, Math.min(1, t)) * (st.length - 1);
    const i = Math.min(st.length - 2, Math.floor(x));
    const f = x - i, a = st[i], b = st[i + 1];
    return [
      Math.round(a[0] + (b[0] - a[0]) * f),
      Math.round(a[1] + (b[1] - a[1]) * f),
      Math.round(a[2] + (b[2] - a[2]) * f)
    ];
  }

  private rampAt(t: number): string {
    const [r, g, b] = this.rampAtRgb(t);
    return `rgb(${r},${g},${b})`;
  }

  private colourFor(v: number): string {
    return this.rampAt(this.magScale(v));
  }

  // --------------------------------------------------------------- API layer
  /** Bearer token is read straight from the build's own environment config —
   *  the same source every other panel in this app authenticates against —
   *  rather than prompting the visitor for one. */
  private async apiGet<T>(path: string, params: Record<string, any>): Promise<T> {
    const headers = new HttpHeaders({ Authorization: `Bearer ${environment.apiToken}` });
    return firstValueFrom(this.http.get<T>(`${this.API}/${path}`, { headers, params }));
  }

  private async loadGauges(): Promise<number> {
    const all = await this.apiGet<any[]>('stations', { location: this.LOC });
    const inBox = all.filter(s => s.lat && s.lng &&
      +s.lat >= this.BOX.s && +s.lat <= this.BOX.n && +s.lng >= this.BOX.w && +s.lng <= this.BOX.e);

    const rows = await this.apiGet<any[]>('measurements', {
      location: this.LOC, var_ids: this.RAINV,
      start_date: new Date(this.DAY_START).toISOString(),
      end_date: new Date(this.DAY_END).toISOString(),
      row_mode: 'json', limit: 500000
    });

    const grid = new Map<string, (number | null)[]>();
    for (const r of rows) {
      if (r.flag !== 0 || r.value == null || r.value === '') continue;
      const v = +r.value;
      if (!isFinite(v)) continue;
      const k = Math.round((Date.parse(r.timestamp) - this.DAY_START) / this.SLOT_MS);
      if (k < 0 || k >= this.N_PTS) continue;
      let arr = grid.get(r.station_id);
      if (!arr) grid.set(r.station_id, arr = new Array(this.N_PTS).fill(null));
      arr[k] = v / this.MM_PER_IN;
    }

    this.stations = [];
    for (const s of inBox) {
      const arr = grid.get(s.station_id);
      if (!arr) continue;
      let run = 0, reported = 0;
      const acc = new Float64Array(this.N_PTS);
      for (let k = 0; k < this.N_PTS; k++) {
        if (k > 0 && arr[k] != null) { run += arr[k] as number; if (k > this.K0 && k <= this.K1) reported++; }
        acc[k] = run;
      }
      if (!reported) continue;   // present, but silent through the hour on show
      this.stations.push({ id: s.station_id, name: s.full_name || s.name || s.station_id,
        lat: +s.lat, lng: +s.lng, five: arr, reported });
      this.series.set(s.station_id, acc);
      this.hourly.set(s.station_id, acc[this.K1] - acc[this.K0]);
    }
    this.stations.sort((a, b) => this.hourly.get(a.id)! - this.hourly.get(b.id)!);   // heaviest drawn last
    return rows.length;
  }

  // ------------------------------------------------------------ the radar field
  private async loadRadar(): Promise<void> {
    let tiff: any;
    try {
      tiff = await GeoTIFF.fromUrl(this.MRMS_URL);
    } catch (e) {
      throw new Error(`could not reach ${this.MRMS_URL} — the radar field for this hour may be missing`);
    }
    const image = await tiff.getImage();
    const [xmin, ymin, xmax, ymax] = image.getBoundingBox() as [number, number, number, number];
    const width = image.getWidth();
    const height = image.getHeight();
    const band = (await image.readRasters({
      samples: [0], interleave: true, resampleMethod: 'nearest', pool: this.tiffPool
    })) as Float32Array;
    const noData = image.getGDALNoData();
    this.raster = {
      band, width, height, xmin, ymin, xmax, ymax,
      pixelWidth: (xmax - xmin) / width,
      pixelHeight: (ymax - ymin) / height,
      noData
    };
  }

  private isNoData(v: number): boolean {
    if (v == null || !isFinite(v) || v < -1e30) return true;
    const nd = this.raster?.noData;
    return nd != null && Math.abs(v - nd) < 1e-3;
  }

  /** Radar value under a point, in inches per hour, or null off the field. */
  private sampleRadar(lat: number, lng: number): number | null {
    const r = this.raster;
    if (!r) return null;
    const col = Math.floor((lng - r.xmin) / r.pixelWidth);
    const row = Math.floor((r.ymax - lat) / r.pixelHeight);
    if (col < 0 || row < 0 || col >= r.width || row >= r.height) return null;
    const raw = r.band[row * r.width + col];
    if (this.isNoData(raw)) return null;
    return raw / this.MM_PER_IN;
  }

  /** Colour the raster into an offscreen canvas once, at the same ramp the
   *  gauges use, so the field and the markers always agree. */
  private colorizeRaster(): string {
    const r = this.raster!;
    const canvas = document.createElement('canvas');
    canvas.width = r.width; canvas.height = r.height;
    const ctx = canvas.getContext('2d')!;
    const img = ctx.createImageData(r.width, r.height);
    for (let i = 0; i < r.band.length; i++) {
      const raw = r.band[i];
      const idx = i * 4;
      if (this.isNoData(raw)) { img.data[idx + 3] = 0; continue; }
      const [red, g, b] = this.rampAtRgb(this.magScale(raw / this.MM_PER_IN));
      img.data[idx] = red; img.data[idx + 1] = g; img.data[idx + 2] = b; img.data[idx + 3] = 191;   // 75% opacity
    }
    ctx.putImageData(img, 0, 0);
    return canvas.toDataURL('image/png');
  }

  // -------------------------------------------------------------------- the map
  private initMap() {
    this.zone.runOutsideAngular(() => this.buildMap());
  }

  private buildMap() {
    const m = L.map(this.mapEl.nativeElement, {
      zoomControl: false, attributionControl: false, zoomSnap: 0,
      maxBounds: this.BOUNDS, maxBoundsViscosity: 1.0
    });
    L.control.zoom({ position: 'bottomleft' }).addTo(m);
    L.tileLayer(this.TILE_URL, { maxZoom: 16 } as any).addTo(m);
    m.fitBounds(this.BOUNDS, { animate: false });
    m.setMinZoom(m.getBoundsZoom(this.BOUNDS));
    this.map = m;

    // the coastline sits above the radar tile layer (z-index 200) but below
    // the gauge markers (overlay pane, 400)
    m.createPane('coast');
    m.getPane('coast')!.style.zIndex = '350';
    m.getPane('coast')!.style.pointerEvents = 'none';

    if (this.raster) {
      const dataUrl = this.colorizeRaster();
      const r = this.raster;
      const bounds = L.latLngBounds([[r.ymin, r.xmin], [r.ymax, r.xmax]]);
      L.imageOverlay(dataUrl, bounds, { opacity: 1, zIndex: 2 } as any).addTo(m);
    }

    this.drawCoast();

    m.on('mousemove', (ev: L.LeafletMouseEvent) => this.updateReadout(ev.latlng));
    m.on('mouseout', () => this.clearReadout());

    this.drawGauges();
  }

  private async drawCoast(): Promise<void> {
    try {
      const gj = await firstValueFrom(this.http.get<any>(this.COAST_URL));
      if (!gj?.features?.length || !this.map) return;
      L.geoJSON(gj, {
        pane: 'coast', interactive: false,
        style: { color: '#000', weight: 1, opacity: 0.9, fill: false }
      }).addTo(this.map);
    } catch { /* the field and gauges still work without the coastline overlay */ }
  }

  private drawGauges() {
    if (!this.map) return;
    for (const st of this.stations) {
      const v = this.hourly.get(st.id)!;
      const mk = L.circleMarker([st.lat, st.lng], {
        radius: 4 + this.magScale(v) * 18,
        fillColor: this.colourFor(v), fillOpacity: 0.95,
        color: '#1d1d1d', weight: 1, opacity: 0.85
      }).addTo(this.map);
      mk.bindTooltip(`<b>${st.name}</b> (${st.id})<br>${v.toFixed(2)} in/hr, gauge`, { direction: 'top', sticky: true });
      mk.on('click', () => this.zone.run(() => this.select(st.id)));
      this.markers.set(st.id, mk);
    }
  }

  private highlight() {
    for (const [id, mk] of this.markers) {
      const on = id === this.selected;
      mk.setStyle({ color: on ? '#000' : '#1d1d1d', weight: on ? 3 : 1, opacity: on ? 1 : 0.85 });
      if (on) mk.bringToFront();
    }
  }

  private coordText(lat: number, lng: number): string {
    return `${Math.abs(lat).toFixed(3)}°${lat >= 0 ? 'N' : 'S'} ${Math.abs(lng).toFixed(3)}°${lng >= 0 ? 'E' : 'W'}`;
  }

  private updateReadout(ll: L.LatLng) {
    const v = this.sampleRadar(ll.lat, ll.lng);
    this.zone.run(() => {
      if (v == null) { this.readout.show = false; return; }
      this.readout.show = true;
      this.readout.color = this.colourFor(v);
      this.readout.value = `${v.toFixed(2)} in/hr`;
      this.readout.coord = this.coordText(ll.lat, ll.lng);
    });
  }

  private clearReadout() {
    this.zone.run(() => { this.readout.show = false; });
  }

  // -------------------------------------------------------- the gauge's own hour
  select(id: string) {
    this.selected = id;
    this.highlight();
    this.drawChart();
  }

  private niceTop(v: number): number {
    if (!isFinite(v) || v <= 0) return 0.1;
    const mag = Math.pow(10, Math.floor(Math.log10(v)));
    for (const m of [1, 1.2, 1.6, 2, 2.4, 3.2, 4, 6, 8, 10]) if (v <= m * mag) return m * mag;
    return 10 * mag;
  }

  private readonly NS = 'http://www.w3.org/2000/svg';
  private svgEl(tag: string, attrs: Record<string, string | number>): SVGElement {
    const n = document.createElementNS(this.NS, tag);
    for (const k in attrs) n.setAttribute(k, String(attrs[k]));
    return n;
  }

  private drawChart() {
    const svg = this.chartEl.nativeElement;
    const st = this.stations.find(s => s.id === this.selected);
    if (!st) { this.showPair = false; return; }

    const acc = this.series.get(st.id)!;
    const day = acc[this.N_PTS - 1], rate = this.hourly.get(st.id)!;
    const radar = this.sampleRadar(st.lat, st.lng);
    const rank = this.stations.filter(s => this.hourly.get(s.id)! > rate).length + 1;

    this.who = `${st.name} (${st.id})`;
    this.stat = `all of 15 Aug · ${st.reported} of 12 five-minute catches reported in the banded hour`;
    this.showPair = true;
    this.vGauge = `${rate.toFixed(2)} in/hr`;
    this.vRadar = radar == null ? 'off field' : `${radar.toFixed(2)} in/hr`;
    this.vRank = `${rank} of ${this.stations.length}`;
    this.vDay = `${day.toFixed(2)} in`;
    this.chartNote = 'Rain accumulated across the whole day, so the line only climbs; the blue band is the ' +
      'hour the map is drawn from, and the rise across it is the rate the marker is coloured by. Hover for ' +
      'the running total and the instantaneous rate — one five-minute catch scaled to an hour.';

    if (!svg.clientWidth) {
      requestAnimationFrame(() => this.drawChart());
      return;
    }
    const W = svg.clientWidth, H = svg.clientHeight || 210;
    const P = { l: 46, r: 12, t: 42, b: 24 };
    const iw = W - P.l - P.r, ih = H - P.t - P.b;
    const top = this.niceTop(Math.max(0.05, day));
    const x = (k: number) => P.l + (k / (this.N_PTS - 1)) * iw;
    const y = (v: number) => P.t + ih - (v / top) * ih;

    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('aria-label', `Rainfall accumulated at ${st.name} across 15 Aug, with ` +
      `${this.fmtHM(this.HOUR_START)}–${this.fmtHM(this.HOUR_END)} HST highlighted`);
    svg.innerHTML = '';

    for (let i = 0; i <= 4; i++) {
      const v = top * i / 4, yy = y(v);
      svg.appendChild(this.svgEl('line', { x1: P.l, x2: W - P.r, y1: yy, y2: yy,
        stroke: i ? 'var(--grid)' : 'var(--axis)', 'stroke-width': 1 }));
      const lab = this.svgEl('text', { x: P.l - 7, y: yy + 3.5, 'text-anchor': 'end',
        fill: 'var(--muted)', 'font-size': 10.5 });
      lab.textContent = v.toFixed(top < 1 ? 2 : 1);
      svg.appendChild(lab);
    }
    for (let k = 0; k < this.N_PTS; k += 36) {
      const xx = x(k);
      if (k > 0) svg.appendChild(this.svgEl('line', { x1: xx, x2: xx, y1: P.t, y2: P.t + ih,
        stroke: 'var(--grid)', 'stroke-width': 1 }));
      const lab = this.svgEl('text', { x: xx, y: H - 7,
        'text-anchor': k === 0 ? 'start' : (k === this.N_PTS - 1 ? 'end' : 'middle'),
        fill: 'var(--muted)', 'font-size': 10.5 });
      lab.textContent = this.fmtHM(this.ptTime(k));
      svg.appendChild(lab);
    }

    const colour = this.colourFor(rate);
    svg.appendChild(this.svgEl('path', {
      d: 'M' + x(0) + ',' + y(0) + Array.from(acc, (v, k) => 'L' + x(k) + ',' + y(v)).join('') +
         'L' + x(this.N_PTS - 1) + ',' + y(0) + 'Z',
      fill: colour, 'fill-opacity': 0.18
    }));
    svg.appendChild(this.svgEl('path', {
      d: 'M' + Array.from(acc, (v, k) => x(k) + ',' + y(v)).join('L'),
      fill: 'none', stroke: colour, 'stroke-width': 2.4,
      'stroke-linejoin': 'round', 'stroke-linecap': 'round'
    }));

    const bx = x(this.K0), bw = Math.max(2, x(this.K1) - x(this.K0));
    const hl = 'var(--accent)';
    svg.appendChild(this.svgEl('rect', { x: bx, y: P.t, width: bw, height: ih, fill: hl, 'fill-opacity': 0.13 }));
    svg.appendChild(this.svgEl('line', { x1: bx, x2: bx, y1: P.t, y2: P.t + ih, stroke: hl, 'stroke-width': 1, 'stroke-opacity': 0.55 }));
    svg.appendChild(this.svgEl('line', { x1: x(this.K1), x2: x(this.K1), y1: P.t, y2: P.t + ih, stroke: hl, 'stroke-width': 1.5 }));

    const mid = (bx + x(this.K1)) / 2, near = 116;
    const anchor = mid < P.l + near ? 'start' : (mid > W - P.r - near ? 'end' : 'middle');
    const lx = anchor === 'start' ? P.l : (anchor === 'end' ? W - P.r : mid);
    const lab = this.svgEl('text', { x: lx, y: P.t - 24, 'text-anchor': anchor, fill: hl, 'font-size': 11, 'font-weight': 600 });
    lab.textContent = `hourly rate ${rate.toFixed(2)} in/hr  ·  ${this.fmtHM(this.HOUR_START)}–${this.fmtHM(this.HOUR_END)}`;
    svg.appendChild(lab);
    const sub = this.svgEl('text', { x: lx, y: P.t - 9, 'text-anchor': anchor, fill: 'var(--muted)', 'font-size': 10.5 });
    sub.textContent = `${acc[this.K1].toFixed(2)} in accumulated by ${this.fmtHM(this.HOUR_END)}  ·  ${day.toFixed(2)} in for the day`;
    svg.appendChild(sub);

    svg.appendChild(this.svgEl('circle', { cx: x(this.K1), cy: y(acc[this.K1]), r: 3.5, fill: colour, stroke: 'var(--surface-1)', 'stroke-width': 2 }));

    const cross = this.svgEl('line', { y1: P.t, y2: P.t + ih, stroke: 'var(--axis)', 'stroke-width': 1, opacity: 0 });
    const dot = this.svgEl('circle', { r: 4, fill: colour, stroke: 'var(--surface-1)', 'stroke-width': 2, opacity: 0 });
    svg.appendChild(cross); svg.appendChild(dot);
    const hit = this.svgEl('rect', { x: P.l, y: P.t, width: iw, height: ih, fill: 'transparent' });
    svg.appendChild(hit);
    const tip = this.tipEl.nativeElement;
    hit.addEventListener('pointermove', (ev: PointerEvent) => {
      const r = svg.getBoundingClientRect();
      const k = Math.max(0, Math.min(this.N_PTS - 1,
        Math.round((((ev.clientX - r.left) * (W / r.width)) - P.l) / iw * (this.N_PTS - 1))));
      cross.setAttribute('x1', String(x(k))); cross.setAttribute('x2', String(x(k))); cross.setAttribute('opacity', '1');
      dot.setAttribute('cx', String(x(k))); dot.setAttribute('cy', String(y(acc[k]))); dot.setAttribute('opacity', '1');
      const five = st.five[k];
      tip.innerHTML = `<b>${this.fmtHM(this.ptTime(k))} HST</b> &middot; ${acc[k].toFixed(2)} in accumulated &middot; ` +
        (k === 0 ? 'start of the day' : (five == null ? 'no reading' : `${(five * 12).toFixed(2)} in/hr instantaneous`));
      tip.style.opacity = '1';
      tip.style.left = `${Math.min(ev.clientX + 14, innerWidth - tip.offsetWidth - 8)}px`;
      tip.style.top = `${ev.clientY - 38}px`;
    });
    hit.addEventListener('pointerleave', () => {
      cross.setAttribute('opacity', '0'); dot.setAttribute('opacity', '0'); tip.style.opacity = '0';
    });
  }

  // -------------------------------------------------------------- the legend
  private renderLegend() {
    const stops: string[] = [];
    for (let i = 0; i < 9; i++) stops.push(this.RAD_STOPS[i]);
    this.rampStyle = `linear-gradient(to right,${stops.join(',')})`;
    this.tickLabels = this.TICKS.map(v => {
      const pct = this.magScale(v) * 100;
      const shift = pct <= 0.01 ? '0' : (pct >= 99.99 ? '-100%' : '-50%');
      return { value: v, pct, shift };
    });
  }

  private renderCredit() {
    this.credit = this.MRMS_CREDIT;
    this.note = 'Pan and zoom in freely; the map will not zoom out or pan past Hawaiʻi County. The radar ' +
      'field is drawn at 75% opacity beneath the gauges, with the coastline over it in black; field and ' +
      'gauges share the same log-spaced 0–4 in/hr radar ramp.';
  }

  // ------------------------------------------------------------------ start-up
  private progress(frac: number) {
    this.loadPct = Math.round(Math.max(0, Math.min(1, frac)) * 100);
  }

  private async boot() {
    this.renderLegend();
    this.progress(0.1);
    try {
      const n = await this.loadGauges();
      this.progress(0.5);
      let radarErr: string | null = null;
      try {
        await this.loadRadar();
      } catch (e: any) {
        radarErr = e.message;   // the gauges still work without the surface
      }
      this.progress(0.85);
      this.initMap();
      this.renderCredit();
      if (!this.stations.length) throw new Error('no gauges reported through this hour');
      const top = this.stations[this.stations.length - 1];
      this.select(this.stations.some(s => s.id === this.OPEN_WITH) ? this.OPEN_WITH : top.id);
      this.setStatus(radarErr ? radarErr
        : `${this.stations.length} gauges on Hawaiʻi Island · ${n.toLocaleString()} five-minute ` +
          `records · heaviest ${this.hourly.get(top.id)!.toFixed(2)} in/hr at ${top.name} (${top.id})`, !!radarErr);
      this.progress(1);
    } catch (e: any) {
      this.setStatus(e.message, true);
      this.progress(1);
    } finally {
      this.loading = false;
    }
  }
}

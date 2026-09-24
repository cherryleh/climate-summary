import {
  Component, ElementRef, AfterViewInit, OnChanges, OnDestroy, ViewChild, NgZone,
  Input, Output, EventEmitter, SimpleChanges
} from '@angular/core';
import { CommonModule } from '@angular/common';
import * as L from 'leaflet';
import {
  CountyFilter, MapMode, MapKind, Station, StationSeries, LegendTick,
  compass, sizeScale, rampRGB, gustIcon, legendFor,
  RAIN_RAMP, WIND_RAMP, STATEWIDE_BOUNDS, COUNTY_BOUNDS, COUNTIES, TILE_URL, MAP_OPTIONS, markerScale
} from './nolo-map';

const SLOT_MS = 5 * 60 * 1000;             // the Mesonet's native cadence, and one animation step
const WINDOW_MS = 60 * 60 * 1000;          // the trailing window each frame covers
const WIN_SLOTS = WINDOW_MS / SLOT_MS;     // 12 five-minute readings make an hour

/** Per-station values for every frame, NaN where the station did not report in
 *  that frame's trailing hour. */
interface FrameData {
  rain: Map<string, Float32Array>;   // rain summed over the past hour, in
  gust: Map<string, Float32Array>;   // strongest 5-minute gust in the past hour, mph
  dir: Map<string, Float32Array>;    // direction that gust blew from, degrees
}

/**
 * Replay map of the storm, after mesonet_live.html: every 5 minutes, the rain that
 * fell over the past hour (or the strongest gust in it) at each Hawaiʻi Mesonet
 * station, stepped or played through the whole window.
 */
@Component({
  selector: 'app-nolo-hourly-map',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './nolo-hourly-map.component.html',
  styleUrl: './nolo-hourly-map.component.css'
})
export class NoloHourlyMapComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input() stations: Station[] = [];
  @Input() series = new Map<string, StationSeries>();
  @Input() windowStart = 0;
  @Input() selectedId: string | null = null;
  @Output() stationClick = new EventEmitter<string>();

  @ViewChild('map') private mapEl!: ElementRef<HTMLDivElement>;

  readonly COUNTIES = COUNTIES;
  readonly MAP_MODES: MapMode[] = ['rain', 'gust'];
  readonly MAP_KINDS: Record<MapMode, MapKind> = {
    rain: {
      label: 'Past-hour rain', unit: 'inches, past hour (log)',
      domain: 5, soft: 0.05, ticks: [0, 0.05, 0.12, 0.3, 0.6, 1.3, 2.5, 5],
      ramp: RAIN_RAMP, fmt: v => v.toFixed(2) + ' in'
    },
    gust: {
      label: 'Past-hour gust', unit: 'mph, past-hour max gust (log)',
      domain: 80, soft: 10, ticks: [0, 4, 9, 15, 25, 38, 55, 80],
      ramp: WIND_RAMP, fmt: v => v.toFixed(1) + ' mph'
    }
  };
  readonly SPEEDS = [{ label: 'Slow', ms: 300 }, { label: 'Normal', ms: 120 }, { label: 'Fast', ms: 45 }];

  mode: MapMode = 'rain';
  county: CountyFilter = 'all';
  frameTimes: number[] = [];      // the end of each frame's trailing hour, ms
  frame = 0;
  playing = false;
  speedMs = 120;
  legendGradient = '';
  legendTicks: LegendTick[] = [];
  frameLabel = '—';
  frameSub = '';
  frameSummary = '';

  private map: L.Map | null = null;
  private rainMarkers = new Map<string, L.CircleMarker>();
  private gustMarkers = new Map<string, L.Marker>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private resizeObserver: ResizeObserver | null = null;

  private readonly fmtDay = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Pacific/Honolulu', weekday: 'short', month: 'short', day: 'numeric'
  });
  private data: FrameData = { rain: new Map(), gust: new Map(), dir: new Map() };

  private readonly fmtHM = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Pacific/Honolulu', hour: 'numeric', minute: '2-digit'
  });

  constructor(private zone: NgZone) {
    this.buildLegend();
  }

  ngOnChanges(ch: SimpleChanges) {
    if (ch['series'] || ch['stations'] || ch['windowStart']) {
      const atEnd = !this.frameTimes.length || this.frame >= this.frameTimes.length - 1;
      this.buildFrames();
      this.frame = atEnd ? this.frameTimes.length - 1 : Math.min(this.frame, this.frameTimes.length - 1);
      this.render();
    } else if (ch['selectedId']) {
      this.render();
    }
  }

  ngAfterViewInit() {
    // Same deferral as the storm-total map: let layout give the container a size first.
    this.zone.runOutsideAngular(() => requestAnimationFrame(() => this.buildMap()));
  }

  ngOnDestroy() {
    this.stop();
    this.resizeObserver?.disconnect();
    this.map?.remove();
  }

  // ----------------------------------------------------------------- the frames
  private buildFrames() {
    // Slot k holds the 5-minute reading stamped windowStart + k*5 min (k >= 1).
    const slotOf = (t: number) => Math.round((t - this.windowStart) / SLOT_MS);
    let lastSlot = 0;
    for (const s of this.series.values()) {
      for (const arr of [s.rain, s.gust]) if (arr.length) lastSlot = Math.max(lastSlot, slotOf(arr[arr.length - 1][0]));
    }
    // Frame f ends at slot firstEnd + f and covers the 12 slots up to it. The
    // first frame is the first full hour of the window (or the latest slot, if
    // there isn't an hour of data yet).
    const firstEnd = Math.max(1, Math.min(WIN_SLOTS, lastSlot));
    const n = Math.max(1, lastSlot - firstEnd + 1);
    this.frameTimes = Array.from({ length: n }, (_, f) => this.windowStart + (firstEnd + f) * SLOT_MS);

    const grid = (pts: [number, number][]) => {
      const g = new Float32Array(lastSlot + 1).fill(NaN);
      for (const [t, v] of pts) {
        const k = slotOf(t);
        if (k >= 1 && k <= lastSlot) g[k] = v;
      }
      return g;
    };
    const data: FrameData = { rain: new Map(), gust: new Map(), dir: new Map() };
    for (const [id, s] of this.series) {
      const rg = grid(s.rain), gg = grid(s.gust), dg = grid(s.dir);
      const rain = new Float32Array(n).fill(NaN);
      const gust = new Float32Array(n).fill(NaN);
      const dir = new Float32Array(n).fill(NaN);
      for (let f = 0; f < n; f++) {
        const end = firstEnd + f;
        let sum = 0, seen = 0, gmax = -Infinity, gdir = NaN;
        for (let k = Math.max(1, end - WIN_SLOTS + 1); k <= end; k++) {
          if (isFinite(rg[k])) { sum += rg[k]; seen++; }
          if (isFinite(gg[k]) && gg[k] > gmax) { gmax = gg[k]; gdir = dg[k]; }
        }
        if (seen) rain[f] = sum;
        if (gmax > -Infinity) { gust[f] = gmax; dir[f] = gdir; }
      }
      data.rain.set(id, rain);
      data.gust.set(id, gust);
      data.dir.set(id, dir);
    }
    this.data = data;
  }

  // -------------------------------------------------------------------- the map
  private buildMap() {
    const el = this.mapEl.nativeElement;
    const m = L.map(el, MAP_OPTIONS);
    L.tileLayer(TILE_URL, { maxZoom: 16, attribution: 'Esri &mdash; Sources: Esri' } as any).addTo(m);
    // A container with no size yet (e.g. a background tab) makes fitBounds pick
    // zoom 0, so the first fit waits until the box has real dimensions.
    let fitted = false;
    const fit = () => {
      if (fitted || !el.clientWidth || !el.clientHeight) return;
      m.fitBounds(STATEWIDE_BOUNDS, { animate: false });
      fitted = true;
    };
    m.setView(STATEWIDE_BOUNDS.getCenter(), 7);
    fit();
    this.map = m;
    for (const st of this.stations) {
      const mk = L.circleMarker([st.lat, st.lng], { radius: 5, fillOpacity: 0.9, opacity: 1 });
      const gm = L.marker([st.lat, st.lng], { keyboard: false });
      for (const layer of [mk, gm] as L.Layer[]) {
        layer.on('click', () => this.zone.run(() => this.stationClick.emit(st.id)));
      }
      this.rainMarkers.set(st.id, mk);
      this.gustMarkers.set(st.id, gm);
    }
    this.resizeObserver = new ResizeObserver(() => { m.invalidateSize(); fit(); });
    this.resizeObserver.observe(this.mapEl.nativeElement);
    this.zone.run(() => this.render());
  }

  private render() {
    const f = this.frame;
    const end = this.frameTimes[f];
    const K = this.MAP_KINDS[this.mode];
    if (end === undefined) return;
    const atEnd = f >= this.frameTimes.length - 1;
    this.frameLabel = `${this.fmtDay.format(end)} · ${this.fmtHM.format(end)} HST`;
    this.frameSub = `past hour, ${this.fmtHM.format(end - WINDOW_MS)} – ${this.fmtHM.format(end)}` + (atEnd ? ' · latest' : '');
    const map = this.map;
    if (!map) return;
    const scale = markerScale(map);

    const visible = new Set(
      (this.county === 'all' ? this.stations : this.stations.filter(s => s.county === this.county)).map(s => s.id)
    );
    const drop = (layer?: L.Layer) => { if (layer && map.hasLayer(layer)) map.removeLayer(layer); };
    const value = (id: string) => this.data[this.mode].get(id)?.[f] ?? NaN;

    // Smallest first, so the biggest values sit on top.
    const order = this.stations
      .map(st => ({ st, v: value(st.id) }))
      .sort((a, b) => (isFinite(a.v) ? a.v : -1) - (isFinite(b.v) ? b.v : -1));

    let reporting = 0, top: { st: Station; v: number } | null = null;
    for (const { st, v } of order) {
      const mk = this.rainMarkers.get(st.id), gm = this.gustMarkers.get(st.id);
      if (!mk || !gm) continue;
      if (!visible.has(st.id) || !isFinite(v)) { drop(mk); drop(gm); continue; }
      reporting++;
      if (!top || v >= top.v) top = { st, v };
      const picked = st.id === this.selectedId;
      const t = sizeScale(v, K);

      if (this.mode === 'gust') {
        drop(mk);
        const dir = this.data.dir.get(st.id)?.[f] ?? NaN;
        const from = isFinite(dir) ? ` from ${Math.round(dir)}° (${compass(dir)})` : '';
        gm.setIcon(gustIcon(v, dir, t, picked, K, scale));
        gm.setZIndexOffset(picked ? 100000 : Math.round(Math.min(1, t) * 50000));
        gm.bindTooltip(`<b>${st.name}</b> (${st.id})<br>${K.label}: ${K.fmt(v)}${from}`, { direction: 'top' });
        if (!map.hasLayer(gm)) gm.addTo(map);
      } else {
        drop(gm);
        const [r, g, b] = rampRGB(t, K);
        mk.setRadius((4 + t * 18) * scale);
        mk.setStyle({ fillColor: `rgb(${r},${g},${b})`, color: picked ? '#000' : '#fff', weight: picked ? 3 : (v > 0 ? 1.5 : 1) });
        mk.bindTooltip(`<b>${st.name}</b> (${st.id})<br>${K.label}: ${K.fmt(v)}`, { direction: 'top', sticky: true });
        if (!map.hasLayer(mk)) mk.addTo(map);
        mk.bringToFront();
      }
    }
    this.frameSummary = reporting
      ? `${reporting} station${reporting === 1 ? '' : 's'} reporting` + (top ? ` · ${this.mode === 'rain' ? 'wettest' : 'gustiest'}: ${top.st.name}, ${K.fmt(top.v)}` : '')
      : 'No stations reported in this hour';
  }

  private buildLegend() {
    ({ gradient: this.legendGradient, ticks: this.legendTicks } = legendFor(this.MAP_KINDS[this.mode]));
  }

  // ---------------------------------------------------------------- controls
  setMode(mode: MapMode) {
    if (this.mode === mode) return;
    this.mode = mode;
    this.buildLegend();
    this.render();
  }

  setCounty(county: CountyFilter) {
    if (this.county === county) return;
    this.county = county;
    this.render();
    this.map?.fitBounds(county === 'all' ? STATEWIDE_BOUNDS : COUNTY_BOUNDS[county], { animate: true, padding: [12, 12] });
  }

  goto(i: number) {
    this.frame = Math.max(0, Math.min(this.frameTimes.length - 1, i));
    this.render();
  }

  onSlider(e: Event) {
    this.stop();
    this.goto(+(e.target as HTMLInputElement).value);
  }

  step(d: number) {
    this.stop();
    this.goto(this.frame + d);
  }

  togglePlay() {
    if (this.playing) { this.stop(); return; }
    if (this.frame >= this.frameTimes.length - 1) this.goto(0);   // at the end: start the storm over
    this.start();
  }

  setSpeed(ms: number) {
    this.speedMs = ms;
    if (this.playing) { this.stop(); this.start(); }
  }

  private start() {
    this.playing = true;
    this.timer = setInterval(() => {
      if (this.frame >= this.frameTimes.length - 1) { this.stop(); return; }
      this.goto(this.frame + 1);
    }, this.speedMs);
  }

  private stop() {
    this.playing = false;
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  get sliderFill(): string {
    const pct = this.frameTimes.length > 1 ? this.frame / (this.frameTimes.length - 1) * 100 : 100;
    return `linear-gradient(to right, var(--accent) ${pct}%, var(--border) ${pct}%)`;
  }
}

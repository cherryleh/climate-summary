import {
  Component, ElementRef, AfterViewInit, OnChanges, OnDestroy, ViewChild, NgZone,
  Input, Output, EventEmitter, SimpleChanges
} from '@angular/core';
import { CommonModule } from '@angular/common';
import * as L from 'leaflet';
import {
  CountyFilter, MapMode, MapKind, Station, StationSeries, LegendTick,
  compass, sizeScale, rampRGB, gustIcon, legendFor,
  RAIN_RAMP, WIND_RAMP, STATEWIDE_BOUNDS, COUNTY_BOUNDS, COUNTIES, TILE_URL
} from './nolo-map';

const HOUR = 3600000;

/** One clock hour's value per station: rain summed, gust maxed (with the direction
 *  of the 5-minute interval that held it). A station is absent from an hour it
 *  did not report in. */
interface HourFrame {
  end: number;                                   // hour-ending time, ms
  partial: boolean;                              // the current, still-filling hour
  rain: Map<string, number>;
  gust: Map<string, { v: number; dir: number }>;
}

/**
 * Hour-by-hour map of the storm, after the flip-book figures in the Lala and
 * Lowell after-event reports: 1-hour rainfall or the hourly maximum gust at each
 * Hawaiʻi Mesonet station, stepped or played through every hour of the window.
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
      label: '1-hour rainfall', unit: 'inches / hour (log)',
      domain: 5, soft: 0.05, ticks: [0, 0.05, 0.12, 0.3, 0.6, 1.3, 2.5, 5],
      ramp: RAIN_RAMP, fmt: v => v.toFixed(2) + ' in'
    },
    gust: {
      label: 'Hourly max gust', unit: 'mph, hourly max gust (log)',
      domain: 80, soft: 10, ticks: [0, 4, 9, 15, 25, 38, 55, 80],
      ramp: WIND_RAMP, fmt: v => v.toFixed(1) + ' mph'
    }
  };
  readonly SPEEDS = [{ label: 'Slow', ms: 1200 }, { label: 'Normal', ms: 600 }, { label: 'Fast', ms: 250 }];

  mode: MapMode = 'rain';
  county: CountyFilter = 'all';
  frames: HourFrame[] = [];
  frame = 0;
  playing = false;
  speedMs = 600;
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
  private readonly fmtHM = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Pacific/Honolulu', hour: 'numeric', minute: '2-digit'
  });

  constructor(private zone: NgZone) {
    this.buildLegend();
  }

  ngOnChanges(ch: SimpleChanges) {
    if (ch['series'] || ch['stations'] || ch['windowStart']) {
      const atEnd = !this.frames.length || this.frame >= this.frames.length - 1;
      this.buildFrames();
      this.frame = atEnd ? this.frames.length - 1 : Math.min(this.frame, this.frames.length - 1);
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
    let last = this.windowStart;
    for (const s of this.series.values()) {
      for (const arr of [s.rain, s.gust]) if (arr.length) last = Math.max(last, arr[arr.length - 1][0]);
    }
    // Hours end on the clock hour; a 5-minute reading stamped t belongs to the
    // hour (end - 1 h, end]. The last hour may still be filling.
    const firstEnd = Math.floor(this.windowStart / HOUR) * HOUR + HOUR;
    const lastEnd = Math.max(firstEnd, Math.ceil(last / HOUR) * HOUR);
    const frames: HourFrame[] = [];
    for (let end = firstEnd; end <= lastEnd; end += HOUR) {
      frames.push({ end, partial: end > last, rain: new Map(), gust: new Map() });
    }
    const idx = (t: number) => (Math.ceil(t / HOUR) * HOUR - firstEnd) / HOUR;

    for (const [id, s] of this.series) {
      for (const [t, v] of s.rain) {
        if (t <= this.windowStart) continue;
        const f = frames[idx(t)];
        if (f) f.rain.set(id, (f.rain.get(id) ?? 0) + v);
      }
      const dirAt = new Map(s.dir);
      for (const [t, v] of s.gust) {
        if (t <= this.windowStart) continue;
        const f = frames[idx(t)];
        if (!f) continue;
        const cur = f.gust.get(id);
        if (!cur || v > cur.v) f.gust.set(id, { v, dir: dirAt.get(t) ?? NaN });
      }
    }
    this.frames = frames;
  }

  // -------------------------------------------------------------------- the map
  private buildMap() {
    const el = this.mapEl.nativeElement;
    const m = L.map(el, { zoomControl: true, zoomSnap: 0 });
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
    const f = this.frames[this.frame];
    const K = this.MAP_KINDS[this.mode];
    if (f) {
      this.frameLabel = `${this.fmtDay.format(f.end - HOUR)} · ${this.fmtHM.format(f.end - HOUR)} – ${this.fmtHM.format(f.end)} HST`;
      this.frameSub = f.partial ? 'current hour, still filling' : `hour ${this.frame + 1} of ${this.frames.length}`;
    }
    const map = this.map;
    if (!map || !f) return;

    const visible = new Set(
      (this.county === 'all' ? this.stations : this.stations.filter(s => s.county === this.county)).map(s => s.id)
    );
    const drop = (layer?: L.Layer) => { if (layer && map.hasLayer(layer)) map.removeLayer(layer); };
    const value = (id: string) => this.mode === 'rain' ? f.rain.get(id) ?? NaN : f.gust.get(id)?.v ?? NaN;

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
        const dir = f.gust.get(st.id)?.dir ?? NaN;
        const from = isFinite(dir) ? ` from ${Math.round(dir)}° (${compass(dir)})` : '';
        gm.setIcon(gustIcon(v, dir, t, picked, K));
        gm.setZIndexOffset(picked ? 100000 : Math.round(Math.min(1, t) * 50000));
        gm.bindTooltip(`<b>${st.name}</b> (${st.id})<br>${K.label}: ${K.fmt(v)}${from}`, { direction: 'top' });
        if (!map.hasLayer(gm)) gm.addTo(map);
      } else {
        drop(gm);
        const [r, g, b] = rampRGB(t, K);
        mk.setRadius(4 + t * 18);
        mk.setStyle({ fillColor: `rgb(${r},${g},${b})`, color: picked ? '#000' : '#fff', weight: picked ? 3 : (v > 0 ? 1.5 : 1) });
        mk.bindTooltip(`<b>${st.name}</b> (${st.id})<br>${K.label}: ${K.fmt(v)}`, { direction: 'top', sticky: true });
        if (!map.hasLayer(mk)) mk.addTo(map);
        mk.bringToFront();
      }
    }
    this.frameSummary = reporting
      ? `${reporting} stations reporting` + (top ? ` · ${this.mode === 'rain' ? 'wettest' : 'gustiest'}: ${top.st.name}, ${K.fmt(top.v)}` : '')
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
    this.frame = Math.max(0, Math.min(this.frames.length - 1, i));
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
    if (this.frame >= this.frames.length - 1) this.goto(0);   // at the end: start the storm over
    this.start();
  }

  setSpeed(ms: number) {
    this.speedMs = ms;
    if (this.playing) { this.stop(); this.start(); }
  }

  private start() {
    this.playing = true;
    this.timer = setInterval(() => {
      if (this.frame >= this.frames.length - 1) { this.stop(); return; }
      this.goto(this.frame + 1);
    }, this.speedMs);
  }

  private stop() {
    this.playing = false;
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  get sliderFill(): string {
    const pct = this.frames.length > 1 ? this.frame / (this.frames.length - 1) * 100 : 100;
    return `linear-gradient(to right, var(--accent) ${pct}%, var(--border) ${pct}%)`;
  }
}

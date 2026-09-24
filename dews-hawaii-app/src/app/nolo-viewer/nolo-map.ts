// Shared by the Nolo viewer's storm-total map and its hour-by-hour map: station
// types, the fixed pseudo-log colour scales, and the gust pill marker.
import * as L from 'leaflet';

export type County = 'hawaii' | 'maui' | 'honolulu' | 'kauai';
export type CountyFilter = 'all' | County;
export type MapMode = 'rain' | 'gust';

export interface Station {
  id: string;
  name: string;
  lat: number;
  lng: number;
  county: County | null;
  active: boolean;
}

export interface StationSeries {
  rain: [number, number][];   // [time, 5-min amount, in]
  wind: [number, number][];   // [time, avg speed, mph]
  gust: [number, number][];   // [time, max gust, mph]
  dir: [number, number][];    // [time, direction the wind blew from, degrees]
}

/** One quantity a map can show, on a fixed pseudo-log scale so a colour means
 *  the same magnitude at every station, in every frame and after every refresh. */
export interface MapKind {
  label: string;
  unit: string;
  domain: number;       // top of the colour ramp
  soft: number;         // below this the scale is roughly linear, above it logarithmic
  ticks: number[];
  ramp: string[];       // low -> high
  fmt: (v: number) => string;
}

export interface LegendTick { label: number; left: number; shift: string; }

// Spectral ramps: rain runs red (little) -> violet (a lot); wind the other way.
export const RAIN_RAMP = ['#ff0000', '#ff8000', '#ffff00', '#00ff00', '#00ffff', '#0000ff', '#8b00ff'];
export const WIND_RAMP = [...RAIN_RAMP].reverse();
export const NODATA_COLOR = '#9ca3af';

export const STATEWIDE_BOUNDS = L.latLngBounds([18.849, -159.816], [22.269, -154.668]);

// Fixed island/county extents (not derived from station positions, which
// don't reach every coastline and were clipping Oʻahu and Kauaʻi).
export const COUNTY_BOUNDS: Record<County, L.LatLngBounds> = {
  kauai: L.latLngBounds([21.819, -159.816], [22.269, -159.25125]),
  honolulu: L.latLngBounds([21.18, -158.322], [21.7425, -157.602]),
  maui: L.latLngBounds([20.343, -157.35], [21.32175, -155.92575]),
  hawaii: L.latLngBounds([18.849, -156.243], [20.334, -154.668])
};

export const COUNTIES: { key: CountyFilter; label: string }[] = [
  { key: 'all', label: 'Statewide' },
  { key: 'hawaii', label: 'Hawaiʻi' },
  { key: 'maui', label: 'Maui' },
  { key: 'honolulu', label: 'Oʻahu' },
  { key: 'kauai', label: 'Kauaʻi' }
];

// Same basemap as hurricane-lala: Esri's free, keyless World Street Map
// (World Physical Map's tiles only go up to native zoom 8).
export const TILE_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}';

/** 16-point compass name for a bearing in degrees. */
export function compass(deg: number): string {
  const pts = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return pts[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];
}

/** Pseudo-log position of v on the kind's ramp, 0..1 at the domain, and
 *  uncapped above it (circles keep growing past the top colour). */
export function sizeScale(v: number, kind: MapKind): number {
  return Math.log1p(Math.max(0, v) / kind.soft) / Math.log1p(kind.domain / kind.soft);
}

export function rampRGB(t: number, kind: MapKind): [number, number, number] {
  const st = kind.ramp.map(h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)));
  const x = Math.max(0, Math.min(1, t)) * (st.length - 1);
  const i = Math.min(st.length - 2, Math.floor(x));
  const f = x - i, a = st[i], b = st[i + 1];
  return [0, 1, 2].map(k => Math.round(a[k] + (b[k] - a[k]) * f)) as [number, number, number];
}

export function legendFor(kind: MapKind): { gradient: string; ticks: LegendTick[] } {
  return {
    gradient: `linear-gradient(to right, ${kind.ramp.join(', ')})`,
    ticks: kind.ticks.map(v => {
      const left = Math.min(1, sizeScale(v, kind)) * 100;
      return { label: v, left, shift: left <= 0.01 ? '0' : left >= 99.99 ? '-100%' : '-50%' };
    })
  };
}

/** The gust marker: a pill in the ramp colour with an arrowhead pointing the way the
 *  wind blew during the gust and the mph beside it, scaled with the magnitude. */
export function gustIcon(v: number, dir: number, t: number, picked: boolean, kind: MapKind): L.DivIcon {
  const k = 0.85 + 0.6 * Math.min(1, t);
  const h = 18 * k, fs = 11 * k, pad = 5 * k, glyph = 9 * k, gap = 3 * k;
  const label = v.toFixed(0);
  const tw = label.length * fs * 0.62;
  const hasDir = isFinite(dir);
  const w = pad * 2 + tw + (hasDir ? glyph + gap : 0);
  const [r, g, b] = rampRGB(t, kind);
  const ink = (0.299 * r + 0.587 * g + 0.114 * b) > 150 ? '#000' : '#fff';
  const ring = picked ? 'stroke="#000" stroke-width="2.5"' : 'stroke="rgba(255,255,255,.9)" stroke-width="1"';
  const m = 3, W = w + 2 * m, H = h + 2 * m;
  const f1 = (n: number) => n.toFixed(1);
  const cy = m + h / 2;
  let arrow = '';
  if (hasDir) {
    const a = glyph / 2, cx = m + pad + a;
    const d = `M0,${f1(-a)}L${f1(a * 0.8)},${f1(a)}L0,${f1(a * 0.45)}L${f1(-a * 0.8)},${f1(a)}Z`;
    arrow = `<path d="${d}" fill="${ink}" transform="translate(${f1(cx)} ${f1(cy)}) rotate(${f1((dir + 180) % 360)})"/>`;
  }
  const tx = m + pad + (hasDir ? glyph + gap : 0) + tw / 2;
  const html =
    `<svg width="${f1(W)}" height="${f1(H)}" viewBox="0 0 ${f1(W)} ${f1(H)}" style="display:block;overflow:visible">` +
    `<rect x="${m}" y="${m}" width="${f1(w)}" height="${f1(h)}" rx="${f1(h / 2)}" fill="rgb(${r},${g},${b})" ${ring}/>` + arrow +
    `<text x="${f1(tx)}" y="${f1(cy + fs * 0.36)}" text-anchor="middle" font-size="${f1(fs)}" ` +
    `font-weight="700" font-family="system-ui, sans-serif" fill="${ink}">${label}</text></svg>`;
  return L.divIcon({ className: 'gust-icon', html, iconSize: [W, H], iconAnchor: [W / 2, H / 2], tooltipAnchor: [0, -H / 2] });
}

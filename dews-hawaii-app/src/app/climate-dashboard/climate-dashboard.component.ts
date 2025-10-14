import { Component, computed, signal, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient, HttpClientModule } from '@angular/common/http';
import { geoIdentity, geoPath } from 'd3-geo';
import type { FeatureCollection} from 'geojson';
import * as d3 from 'd3';
import { firstValueFrom } from 'rxjs';
import { StatBoxComponent } from '../stat-box/stat-box.component';
import { DataHighchartComponent } from '../data-highchart/data-highchart.component';
import { FooterComponent } from '../footer/footer.component';

import * as GeoTIFF from 'geotiff';
import { Pool } from 'geotiff';
import { interpolateViridis, interpolateRdBu } from 'd3-scale-chromatic';
import { NgZone } from '@angular/core';


type Scope = 'divisions' | 'moku' | 'ahupuaa' | 'watershed';
type Dataset = 'Rainfall' | 'Temperature' | 'Drought';

interface Island {
  id: string;
  name: string;
  short: string;
  divisions: string[];
  feature: any;
  key: string;
  island?: string;
}

// Island → County (only what we need)
const COUNTY_BY_ISLAND: Record<string, string> = {
  'Kauaʻi': 'Kauaʻi',
  'Oʻahu': 'Honolulu',
  'Molokaʻi': 'Maui',
  'Lānaʻi': 'Maui',
  'Maui': 'Maui',
  'Kahoʻolawe': 'Maui',
  'Hawaiʻi': 'Hawaiʻi'
};

interface County {
  id: string;
  name: string;   // e.g. "Maui"
  short: string;  // e.g. "Maui"
  feature: any;
  key: string;
}


// County → list of islands
const COUNTY_GROUPS: Record<string, string[]> = {
  'Kauaʻi': ['Kauaʻi'],
  'Honolulu': ['Oʻahu'],
  'Maui': ['Maui', 'Molokaʻi', 'Lānaʻi', 'Kahoʻolawe'],
  'Hawaiʻi': ['Hawaiʻi']
};

const DIVISIONS: Record<string, string[]> = {
  'Kauaʻi': ['North Kauaʻi', 'South Kauaʻi'],
  'Oʻahu': ['Windward Oʻahu', 'Leeward Oʻahu', 'Honolulu'],
  'Molokaʻi': ['West Molokaʻi', 'East Molokaʻi'],
  'Lānaʻi': ['Central Lānaʻi'],
  'Maui': ['West Maui', 'Central Maui', 'East Maui'],
  'Kahoʻolawe': ['Kahoʻolawe'],
  'Hawaiʻi': ['Hawaiʻi Mauka', 'Windward Kohala', 'Kaʻu', 'Hilo', 'Leeward Kohala', 'Kona'],
};

function getCountyForIsland(islandName: string): string {
  return COUNTY_BY_ISLAND[islandName] ?? islandName;
}

function getIslandsInSameCounty(islandName: string): string[] {
  const c = getCountyForIsland(islandName);
  return COUNTY_GROUPS[c] ?? [islandName];
}

function canonIsland(name: string): string {
  if (!name) return '';
  return name
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/['’ʻ`]/g, '')
    .toLowerCase()
    .trim();
}

@Component({
  selector: 'app-climate-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule, HttpClientModule, StatBoxComponent, DataHighchartComponent, FooterComponent],
  templateUrl: './climate-dashboard.component.html',
  styleUrls: ['./climate-dashboard.component.css']
})
export class ClimateDashboardComponent implements OnDestroy {
  constructor(private http: HttpClient, private ngZone: NgZone) {}

  // ===== Map data/state =====
  islands = signal<Island[]>([]);
  pathById = signal<Record<string, string>>({});
  centroidById = signal<Record<string, [number, number]>>({});
  trackByIsle = (_: number, isle: { id: string | number }) => isle.id;
  trackByDivision = (_: number, d: string) => d;
  hoveredFeature = signal<string | null>(null);
  hoveredLabel = signal<{ name: string; x: number; y: number } | null>(null);

  selectedDivision = signal<string | null>(null);
  viewMode = signal<'islands' | 'divisions'>('islands');
  selectedCounty = signal<string | null>(null);

  getCountyForIsland = getCountyForIsland;

  dataset = signal<Dataset>('Rainfall');
  selectedDataset() { return this.dataset(); }

  pickDataset(d: Dataset) {
    this.dataset.set(d);
    this.loadRasterOnce(d);

    if (d === 'Rainfall') {
      this.loadRainfallData();
    } else if (d === 'Temperature') {
      this.loadTemperatureData();
    } else if (d === 'Drought') {
      this.loadAllSPIData();  
    }
  }

  private normalizeKey(name: string): string {
    return name
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .replace(/['’ʻ`]/g, '')
      .toLowerCase()
      .trim();
  }


  colorbarMin = 0;
  colorbarMax = 1;
  colorbarMid: number | null = null;


  allDivisions: any;
  statewideSPI: any[] = [];
  islandSPI: any[] = [];
  divisionSPI: any[] = [];

  divisionSPIByScale: Record<number, any[]> = {};


  // ===== Scope selection =====
  selectedScope = signal<Scope | null>(null);
  setScope(scope: Scope | null) {
    this.selectedScope.set(scope);
    if (this.selectedCounty()) {
      this.pickCounty(getCountyForIsland(this.selectedCounty()!));
    }

  }
  
  selectedDivisionName = computed(() => {
    const sel = this.selectedDivision();
    if (!sel) return null;

    // split 'molokai::Kona' → ['molokai', 'Kona']
    const parts = sel.split('::');
    const name = parts.length === 2 ? parts[1].trim() : sel.trim();
    const scope = this.selectedScope();

    // append scope label for clarity
    if (scope === 'moku') return `${name} Moku`;
    if (scope === 'divisions') return `${name} Climate Division`;
    if (scope === 'ahupuaa') return `${name} Ahupuaʻa`;
    if (scope === 'watershed') return `${name} Watershed`;

    // plain for 'divisions'
    return name;
  });

  countyLabel = computed(() => {
    const county = this.selectedCounty();
    if (!county) return null;
    return `${county} County`;
  });


  private islandStubForCounty(county: string): Island | null {
    const members = COUNTY_GROUPS[county];
    if (!members || !members.length) return null;
    const name = members[0];
    const id = name.toLowerCase().replace(/\s+/g, '-');
    return { id, name, short: name, divisions: DIVISIONS[name] || [], feature: null, key: id };
  }

  pickCounty(county: string) {
    this.selectedCounty.set(county);
    this.selectedDivision.set(null);

    const members = COUNTY_GROUPS[county] || [county];
    const groupCanon = new Set(members.map(canonIsland));
    const scope = this.selectedScope();

    if (!scope) {
      // --- County outlines only ---
      this.viewMode.set('islands');
      this.http.get<any>('hawaii_islands_simplified.geojson').subscribe(fc => {
        const fcCounty: FeatureCollection = {
          type: 'FeatureCollection',
          features: fc.features.filter((f: any) => {
            const name = this.getProp(f.properties, ['isle','island','name']) || '';
            return groupCanon.has(canonIsland(name));
          })
        };

        const projection = geoIdentity().reflectY(true).fitExtent(
          [[-130, 10], [560, 320]],
          fcCounty
        );

        const path = geoPath(projection as any);
        this.project = (projection as any);
        this.updateRasterRect();

        const features = fcCounty.features.map((f: any) => {
          const name = this.getProp(f.properties, ['isle','island','name']) || county;
          const id = canonIsland(name);
          return { id, key: id, name, short: name, divisions: DIVISIONS[name] || [], feature: f } as Island;
        });

        const pathById: Record<string, string> = {};
        const centroidById: Record<string, [number, number]> = {};
        for (const d of features) {
          pathById[d.id] = path(d.feature)!;
          centroidById[d.id] = path.centroid(d.feature) as [number, number];
        }
        this.islands.set(features);
        this.pathById.set(pathById);
        this.centroidById.set(centroidById);
      });
    } else {
      // --- Scoped polygons (division/moku/ahupuaʻa) ---
      this.viewMode.set('divisions');

      const file = scope === 'moku'
      ? 'moku.geojson'
      : scope === 'ahupuaa'
        ? 'ahupuaa.geojson'
        : scope === 'watershed'
          ? 'watershed.geojson'
          : 'hawaii_islands_divisions.geojson';


      this.http.get<any>(file).subscribe(fc => {
        const fcCounty: FeatureCollection = {
          type: 'FeatureCollection',
          features: fc.features.filter((f: any) => {
            const featureIslandRaw = this.getProp(f.properties, ['mokupuni','island','isle','Island','ISLAND']);
            return groupCanon.has(canonIsland(String(featureIslandRaw)));
          })
        };

        const projection = geoIdentity().reflectY(true).fitExtent(
          [[-130, 10], [560, 320]],
          fcCounty
        );

        const path = geoPath(projection as any);
        this.project = (projection as any);
        this.updateRasterRect();

        const features = fcCounty.features.map((f: any) => {
          const p = f.properties || {};
          const name =
          scope === 'ahupuaa'
            ? (this.getProp(p, ['ahupuaa','Ahupuaʻa','Ahupuaa','AHUPUAA','AHUPUAA_N']) || 'Ahupuaʻa')
            : scope === 'moku'
              ? (this.getProp(p, ['moku','Moku','MOKU']) || 'Moku')
              : scope === 'watershed'
                ? (this.getProp(p, ['watershed','Watershed','WATERSHED','name']) || 'Watershed')
                : (this.getProp(p, ['division','Division','name','NAME']) || 'Division');


          const islandRaw = this.getProp(p, ['mokupuni','island','isle','Island','ISLAND']) || county;
          const islandCanon = canonIsland(String(islandRaw));
          const key = `${islandCanon}::${name}`;
          const id  = `${islandCanon}-${name}`.toLowerCase().replace(/\s+/g, '-');

          return { id, key, name, short: name, island: islandCanon, divisions: [], feature: f } as Island;
        });

        const pathById: Record<string, string> = {};
        const centroidById: Record<string, [number, number]> = {};
        for (const d of features) {
          pathById[d.id] = path(d.feature)!;
          centroidById[d.id] = path.centroid(d.feature) as [number, number];
        }
        this.islands.set(features);
        this.pathById.set(pathById);
        this.centroidById.set(centroidById);
      });
    }

    // Chart data
    if (this.selectedDataset() === 'Drought') {
      this.loadAllSPIData();
    }

    if (this.selectedDataset() === 'Rainfall') {
      this.loadRainfallData();
    } else if (this.selectedDataset() === 'Temperature') {
      this.loadTemperatureData();
    } else if (this.selectedDataset() === 'Drought') {
      this.loadAllSPIData();
    }
  }


  // ===== Chart data (sidebar) =====
  tsData = signal<{ month: string; value: number }[]>([]);

  // ===== Email form =====
  email = signal<string>('');
  private emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  isEmailValid = computed(() => this.emailRegex.test(this.email().trim()));
  subscribe() {
    if (!this.isEmailValid()) return;
    const label = this.selectedDivision() || this.selectedCounty() || 'Statewide';
    alert(`Subscribed ${this.email()} to monthly ${this.selectedDataset()} updates for ${label}.`);
  }

  chartVisible = signal(true);
  chartFullscreen = signal(false);
  toggleChartFullscreen() {
    this.chartFullscreen.set(!this.chartFullscreen());
    if (!this.chartFullscreen()) {
      // Delay rendering until after panel has collapsed
      this.chartVisible.set(false);
      setTimeout(() => this.chartVisible.set(true), 300); // match your CSS transition duration
    }
  }


  // ===== Raster (GeoTIFF) =====
  rasterHref = signal<string | null>(null); // Object URL to a PNG/WEBP
  rasterRect = signal<{ x: number; y: number; width: number; height: number } | null>(null);
  private rasterBBox: [number, number, number, number] | null = null; // [minX, minY, maxX, maxY]
  private project: ((p: [number, number]) => [number, number]) | null = null;

  private tiffPool = new Pool(Math.min(4, (navigator.hardwareConcurrency || 4))); // worker pool
  private rasterScaleFactor = 1.5; // 1 = fastest; 1.5–2 = sharper
  private objectUrl: string | null = null; // for cleanup

  // Project bbox → SVG coords; computes <image> x/y/width/height
  private updateRasterRect() {
    if (!this.project || !this.rasterBBox) return;
    const [minX, minY, maxX, maxY] = this.rasterBBox;
    const pTL = this.project([minX, maxY]); // top-left
    const pBR = this.project([maxX, minY]); // bottom-right
    const x = Math.min(pTL[0], pBR[0]);
    const y = Math.min(pTL[1], pBR[1]);
    const width = Math.abs(pBR[0] - pTL[0]);
    const height = Math.abs(pBR[1] - pTL[1]);
    this.rasterRect.set({ x, y, width, height });
  }

  private colorScale: d3.ScaleSequential<string> | d3.ScaleDiverging<string> | null = null;


  private async loadRasterOnce(dataset: Dataset) {
    try {
      // --- Select file ---
      let file = '';
      if (dataset === 'Rainfall') file = 'tifs/rainfall_2025_08.tif';
      else if (dataset === 'Temperature') file = 'tifs/tmean_2025_08.tif';
      else if (dataset === 'Drought') file = 'tifs/spi3_2025_08_category.tif';

      // --- Open the GeoTIFF ---
      const tiff = await GeoTIFF.fromUrl(file);
      const image = await tiff.getImage();
      this.rasterBBox = image.getBoundingBox() as [number, number, number, number];

      // --- Use full resolution (no resampling) ---
      const srcW = image.getWidth();
      const srcH = image.getHeight();

      const isCategorical = dataset === 'Drought';

      const band = await image.readRasters({
        samples: [0],
        interleave: true,
        resampleMethod: 'nearest', // pixel-perfect; no bilinear blending
        pool: this.tiffPool
      }) as Float32Array | Uint16Array | Uint8Array;

      // --- Create a canvas the same size as the source raster ---
      const canvas = document.createElement('canvas');
      canvas.width = srcW;
      canvas.height = srcH;
      const ctx = canvas.getContext('2d')!;
      ctx.imageSmoothingEnabled = false;
      ctx.imageSmoothingQuality = 'low';
      const dpr = window.devicePixelRatio || 1;
      canvas.width = srcW * dpr;
      canvas.height = srcH * dpr;
      ctx.scale(dpr, dpr);


      // --- Handle NoData ---
      const nodata = this.getNoDataValue(image);
      const isNoData = (v: number) =>
        (nodata !== undefined && v === nodata) ||
        !Number.isFinite(v) ||
        Math.abs(v) > 1e20;

      // --- Compute min/max ---
      let min = Number.POSITIVE_INFINITY;
      let max = Number.NEGATIVE_INFINITY;
      for (let i = 0; i < band.length; i++) {
        const v = Number(band[i]);
        if (isNoData(v)) continue;
        if (v < min) min = v;
        if (v > max) max = v;
      }
      if (!Number.isFinite(min) || !Number.isFinite(max)) {
        min = 0; max = 1;
      }

      // --- Override for categorical drought ---
      if (isCategorical) {
        min = 0;
        max = 10;
      }

      // --- Define drought palette ---
      const droughtColors = [
        "#730000", "#FF0000", "#FF9900", "#FFD37F", "#FFFF00",
        "#FFFFFF", "#99CCFF", "#3399FF", "#0066CC", "#003366", "#001933"
      ];

      // --- Color scale for continuous datasets ---
      if (dataset === 'Rainfall') {
        this.colorScale = d3.scaleSequential(interpolateViridis).domain([max, min]);
      } else if (dataset === 'Temperature') {
        this.colorScale = d3.scaleSequential(interpolateViridis).domain([min, max]);
      } else if (dataset === 'Drought') {
        const absMax = Math.max(Math.abs(min), Math.abs(max));
        this.colorScale = d3.scaleDiverging(interpolateRdBu).domain([-absMax, 0, absMax]);
      } else {
        this.colorScale = d3.scaleSequential(interpolateViridis).domain([min, max]);
      }

      // --- Draw image pixel by pixel ---
      const imgData = ctx.createImageData(srcW, srcH);
      for (let i = 0; i < band.length; i++) {
        const v = Number(band[i]);
        const idx = i * 4;
        if (isNoData(v)) { imgData.data[idx + 3] = 0; continue; }

        let r = 255, g = 255, b = 255, a = 255;

        if (isCategorical) {
          const cat = Math.round(v);
          if (!isNoData(v) && cat >= 0 && cat < droughtColors.length) {
            const c = d3.rgb(droughtColors[cat]);
            r = c.r; g = c.g; b = c.b;
          } else {
            a = 0;
          }
        } else {
          const c = d3.rgb(this.colorScale(v));
          r = c.r; g = c.g; b = c.b;
        }

        imgData.data[idx + 0] = r;
        imgData.data[idx + 1] = g;
        imgData.data[idx + 2] = b;
        imgData.data[idx + 3] = a;
      }
      ctx.putImageData(imgData, 0, 0);

      // --- Export image blob ---
      const blob: Blob = await new Promise(resolve => {
        canvas.toBlob(b => resolve(b || new Blob()), 'image/webp', 0.95);
      });

      // --- Apply to app ---
      this.colorbarMin = min;
      this.colorbarMax = max;
      this.colorbarMid = isCategorical ? 0 : (min + max) / 2;
      this.drawColorbar(dataset);

      if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = URL.createObjectURL(blob);
      this.rasterHref.set(this.objectUrl);
      this.updateRasterRect();

    } catch (err) {
      console.error(`Failed to load raster for ${dataset}`, err);
    }

    this.drawColorbar(dataset);
  }

  private getNoDataValue(image: any): number | undefined {
    const candidates = [
      image?.fileDirectory?.GDAL_NODATA,
      image?.fileDirectory?.NoData,
      image?.getGDALNoData?.()
    ];
    for (const tag of candidates) {
      if (tag != null) {
        const n = Number(tag);
        if (Number.isFinite(n)) return n;
      }
    }
    return undefined;
  }

  // ===== Lifecycle =====
  ngOnInit(): void {
    // Base islands
    this.http.get<any>('hawaii_islands_simplified.geojson').subscribe(fc => {
      const projection = geoIdentity().reflectY(true).fitExtent(
        [[-130, 10], [560, 310]],
        fc
      );
      const path = geoPath(projection as any);

      // keep projection for raster placement
      this.project = (projection as any);

      const features = fc.features.map((f: any) => {
        const name = f.properties?.isle || f.properties?.island || f.properties?.name || 'Unknown';
        const id = name.toLowerCase().replace(/\s+/g, '-');
        return <Island>{ id, name, short: name, divisions: DIVISIONS[name] || [], feature: f, key: id };
      });

      const pathById: Record<string, string> = {};
      const centroidById: Record<string, [number, number]> = {};
      for (const is of features) {
        pathById[is.id] = path(is.feature)!;
        centroidById[is.id] = path.centroid(is.feature) as [number, number];
      }

      this.islands.set(features);
      this.pathById.set(pathById);
      this.centroidById.set(centroidById);

      // initial raster placement; raster loads lazily when dataset === 'Rainfall'
      this.updateRasterRect();
      if (this.selectedDataset() === 'Rainfall') this.loadRasterOnce('Rainfall');

    });

    // Divisions metadata (optional)
    this.http.get<any>('hawaii_islands_divisions.geojson').subscribe(fc => this.allDivisions = fc);

    const d = this.selectedDataset();
    this.loadRasterOnce(d);

    if (d === 'Rainfall') {
      this.loadRainfallData();
    } else if (d === 'Drought') {
      this.loadAllSPIData();
    }
  }

  // ===== Chart time-range filter =====
  timeRange = signal<number>(12); // default = last 12 months

  setTimeRange(months: number) {
    this.timeRange.set(months);
  }

  // Filtered time series based on selected range
  filteredTsData = computed(() => {
    const data = this.tsData();
    const months = this.timeRange();
    if (!data || data.length === 0) return [];

    return data.slice(-months); // take last N entries
  });

  private drawColorbar(dataset: Dataset) {
    requestAnimationFrame(() => {
      const canvas = document.getElementById('colorbarCanvas') as HTMLCanvasElement | null;
      const legendDiv = document.getElementById('colorbarLegend') as HTMLDivElement | null;

      // If categorical (Drought)
      if (dataset === 'Drought') {
        if (canvas) canvas.style.display = 'none'; // hide gradient
        if (!legendDiv) return;

        // Clear existing legend
        legendDiv.innerHTML = '';

        const droughtColors = [
          "#730000",  // 0 D4 Exceptional Drought
          "#FF0000",  // 1 D3 Extreme Drought
          "#FF9900",  // 2 D2 Severe Drought
          "#FFD37F",  // 3 D1 Moderate Drought
          "#FFFF00",  // 4 D0 Abnormally Dry
          "#FFFFFF",  // 5 Near Normal
          "#99CCFF",  // 6 W0 Abnormally Wet
          "#3399FF",  // 7 W1 Moderately Wet
          "#0066CC",  // 8 W2 Very Wet
          "#003366",  // 9 W3 Extremely Wet
          "#001933",  // 10 W4 Exceptionally Wet
        ];

        const droughtLabels = [
          "D4 Exceptional Drought",
          "D3 Extreme Drought",
          "D2 Severe Drought",
          "D1 Moderate Drought",
          "D0 Abnormally Dry",
          "Near Normal",
          "W0 Abnormally Wet",
          "W1 Moderately Wet",
          "W2 Very Wet",
          "W3 Extremely Wet",
          "W4 Exceptionally Wet"
        ];

        droughtColors.forEach((color, i) => {
          const item = document.createElement('div');
          item.style.display = 'flex';
          item.style.alignItems = 'center';
          item.style.gap = '6px';
          item.style.marginBottom = '4px';

          const swatch = document.createElement('span');
          swatch.style.display = 'inline-block';
          swatch.style.width = '18px';
          swatch.style.height = '18px';
          swatch.style.border = '1px solid #ccc';
          swatch.style.backgroundColor = color;
          swatch.style.flexShrink = '0';

          const label = document.createElement('span');
          label.textContent = droughtLabels[i];
          label.style.fontSize = '0.85rem';
          label.style.color = '#333';

          item.appendChild(swatch);
          item.appendChild(label);
          legendDiv.appendChild(item);
        });

        return;
      }

      // === Default continuous gradient for rainfall/temperature ===
      if (!canvas || !this.colorScale) return;
      canvas.style.display = 'block';
      if (legendDiv) legendDiv.innerHTML = '';

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const w = canvas.width;
      const h = canvas.height;
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      const steps = 50;
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const reversed =
          this.selectedDataset() === 'Rainfall' ||
          this.selectedDataset() === 'Temperature';

        const val = reversed
          ? this.colorbarMax - t * (this.colorbarMax - this.colorbarMin)
          : this.colorbarMin + t * (this.colorbarMax - this.colorbarMin);

        grad.addColorStop(t, this.colorScale(val));
      }

      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
    });
  }



  ngOnDestroy(): void {
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    // Pool will auto-end with page lifecycle; no explicit destroy needed
  }

  // ===== Helpers =====
  private getProp(o: any, keys: string[]) {
    for (const k of keys) {
      const v = o?.[k];
      if (v !== undefined && v !== null && String(v).trim() !== '') return v;
    }
    return null;
  }

  private parseCsv(
    csvData: string,
    labelKey: 'state' | 'island' | 'division' | 'moku' | 'ahupuaa' | 'county' | 'watershed'
  ) {
    const rows = csvData.split('\n').map(r => r.split(','));
    const headers = rows[0];
    const data: any[] = [];
    for (let i = 1; i < rows.length; i++) {
      if (!rows[i][0]) continue;
      const label = rows[i][0].trim();
      for (let j = 1; j < headers.length; j++) {
        data.push({ [labelKey]: label, month: headers[j], value: +rows[i][j] });
      }
    }
    return data;
  }

  private loadRainfallData() {
    const county = this.selectedCounty();
    const file = county ? 'county_rainfall.csv' : 'statewide_rf.csv';

    this.http.get(file, { responseType: 'text' }).subscribe(csv => {
      const data = this.parseCsv(csv, county ? 'county' : 'state');

      if (county) {
        const filtered = data
          .filter(r => r.county?.trim().toLowerCase() === county.trim().toLowerCase())
          .map(r => ({ month: r.month, value: r.value }));
        this.tsData.set(filtered);
      } else {
        const statewide = data
          .filter(r => r.state?.toLowerCase() === 'statewide')
          .map(r => ({ month: r.month, value: r.value }));
        this.tsData.set(statewide);
      }
    });
  }

  private loadTemperatureData() {
    const county = this.selectedCounty();
    const file = county ? 'county_temperature.csv' : 'statewide_temp.csv';

    this.http.get(file, { responseType: 'text' }).subscribe(csv => {
      const data = this.parseCsv(csv, county ? 'county' : 'state');

      if (county) {
        const filtered = data
          .filter(r => r.county?.trim().toLowerCase() === county.trim().toLowerCase())
          .map(r => ({ month: r.month, value: r.value }));
        this.tsData.set(filtered);
      } else {
        const statewide = data
          .filter(r => r.state?.toLowerCase() === 'statewide')
          .map(r => ({ month: r.month, value: r.value }));
        this.tsData.set(statewide);
      }
    });
  }



  private loadSPIData(scale: number) {
    // Island-level (always)
    this.http.get(`island_spi${scale}.csv`, { responseType: 'text' })
      .subscribe(csv => {
        this.islandSPI = this.parseCsv(csv, 'island');
        if (this.selectedCounty()) this.pickCounty(this.selectedCounty()!);

      });

    // Scope-specific (if selected)
    const scope = this.selectedScope();
    if (scope) {
      let file = '';
      let labelKey: 'division' | 'moku' | 'ahupuaa';
      if (scope === 'divisions') { file = `climate_spi${scale}.csv`; labelKey = 'division'; }
      else if (scope === 'moku') { file = `moku_spi${scale}.csv`; labelKey = 'moku'; }
      else { file = `ahupuaa_spi${scale}.csv`; labelKey = 'ahupuaa'; }

      this.http.get(file, { responseType: 'text' })
        .subscribe(csv => {
          this.divisionSPI = this.parseCsv(csv, labelKey);
          if (this.selectedDivision()) this.pickDivision(this.selectedDivision()!);
        });
    } else {
      this.divisionSPI = [];
      this.selectedDivision.set(null);
    }

    // Statewide (always)
    this.http.get(`statewide_spi${scale}.csv`, { responseType: 'text' })
      .subscribe(csv => {
        this.statewideSPI = this.parseCsv(csv, 'state');
        if (!this.selectedCounty() && !this.selectedDivision()) {
          const stateData = this.statewideSPI
            .filter(r => r.state.toLowerCase() === 'statewide')
            .map(r => ({ month: r.month, value: r.value }));
          this.tsData.set(stateData);
        }
      });
  }

  onHover(feature: any, event: MouseEvent) {
    const scope = this.selectedScope();
    if (scope === 'ahupuaa' || scope === 'watershed') {
      const svg = (event.target as SVGPathElement).ownerSVGElement!;
      const pt = svg.createSVGPoint();
      pt.x = event.clientX;
      pt.y = event.clientY;
      const screenCTM = svg.getScreenCTM();
      if (screenCTM) {
        const svgP = pt.matrixTransform(screenCTM.inverse());
        this.hoveredLabel.set({ name: feature.name, x: svgP.x, y: svgP.y });
      }
    }
    // Highlight the polygon
    this.hoveredFeature.set(feature.name);
  }

  onLeave() {
    this.hoveredFeature.set(null);
    this.hoveredLabel.set(null);
  }


  unit = computed(() => {
    if (this.selectedDataset() === 'Rainfall') return 'in';
    if (this.selectedDataset() === 'Temperature') return '°F';
    if (this.selectedDataset() === 'Drought') return 'SPI';
    return '';
  });

  // Keep original
  spiSeries = signal<{ scale: number; data: { month: string; value: number }[] }[]>([]);

  // Add a filtered version
  filteredSpiSeries = computed(() => {
    const months = this.timeRange();
    return this.spiSeries().map(s => ({
      scale: s.scale,
      data: s.data.slice(-months)   // last N months per scale
    }));
  });


  private async loadAllSPIData() {
    const scales = [1, 6, 12];
    const county = this.selectedCounty();
    const div = this.selectedDivision();
    const scope = this.selectedScope();

    const requests = scales.map(async scale => {
      let file = '';
      let labelKey: 'state' | 'division' | 'moku' | 'ahupuaa' | 'watershed' | 'county' = 'state';

      if (scope === 'divisions') {
        file = `climate_spi${scale}.csv`; labelKey = 'division';
      } else if (scope === 'moku') {
        file = `moku_spi${scale}.csv`; labelKey = 'moku';
      } else if (scope === 'ahupuaa') {
        file = `ahupuaa_spi${scale}.csv`; labelKey = 'ahupuaa';
      } else if (scope === 'watershed') {
        file = `watershed_spi${scale}.csv`; labelKey = 'watershed';
      } else if (county) {
        file = `county_spi${scale}.csv`; labelKey = 'county';
      } else {
        file = `statewide_spi${scale}.csv`; labelKey = 'state';
      }


      const csv = await firstValueFrom(this.http.get(file, { responseType: 'text' }));
      const parsed = this.parseCsv(csv, labelKey);

      this.divisionSPIByScale[scale] = parsed;

      let data: { month: string; value: number }[] = [];

      if (div) {
        // Specific division selected
        const divKey = div.trim().toLowerCase(); // keep full island::division key
        data = parsed
          .filter(r => this.normalizeKey(r[labelKey] || '') === this.normalizeKey(div))
          .map(r => ({ month: r.month, value: r.value }));

      } else if (county) {
        data = parsed
          .filter(r => r[labelKey]?.trim().toLowerCase() === county.trim().toLowerCase())
          .map(r => ({ month: r.month, value: r.value }));
      } else {
        // Fallback to statewide
        data = parsed
          .filter(r => r.state?.toLowerCase() === 'statewide')
          .map(r => ({ month: r.month, value: r.value }));
      }

      return { scale, data };
    });

    Promise.all(requests).then(results => this.spiSeries.set(results));
  }

  pickDivision(d: string | null) {
    if (!d) {
      // If no division was chosen, fallback to county/statewide
      const county = this.selectedCounty();
      if (county && this.selectedDataset() === 'Drought') {
        const newSeries = this.spiSeries().map(s => {
          const parsed = this.divisionSPIByScale[s.scale] || [];
          return {
            scale: s.scale,
            data: parsed
              .filter((r: any) => r['county']?.trim().toLowerCase() === county.trim().toLowerCase())
              .map((r: any) => ({ month: r.month, value: r.value }))
          };
        });
        this.spiSeries.set(newSeries);
      }
      return;
    }

    this.selectedDivision.set(d);
    const divKey = d.trim().toLowerCase(); 
    const scope = this.selectedScope();
    const dataset = this.selectedDataset();

    // Map to label key
    let labelKey: 'division' | 'moku' | 'ahupuaa' | 'watershed' = 'division';
    if (scope === 'moku') labelKey = 'moku';
    else if (scope === 'ahupuaa') labelKey = 'ahupuaa';
    else if (scope === 'watershed') labelKey = 'watershed';

    if (dataset === 'Drought') {
      // Drought — load all SPI scales
      const scales = [1, 6, 12];
      const promises = scales.map(scale =>
        firstValueFrom(this.http.get(`${scope}_spi${scale}.csv`, { responseType: 'text' }))
          .then(csv => {
            const parsed = this.parseCsv(csv, labelKey);
            this.divisionSPIByScale[scale] = parsed;
            const data = parsed
              .filter(r => this.normalizeKey(r[labelKey] || '') === this.normalizeKey(d))
              .map(r => ({ month: r.month, value: r.value }));
            return { scale, data };
          })
      );

      Promise.all(promises).then(results => this.spiSeries.set(results));
      return;
    }

    // Rainfall / Temperature
    const file = `${scope === 'divisions' ? 'climate' : scope}_${dataset.toLowerCase()}.csv`;

    this.http.get(file, { responseType: 'text' }).subscribe(csv => {
      const parsed = this.parseCsv(csv, labelKey);

      const filtered = parsed
        .filter(r => this.normalizeKey(r[labelKey] || '') === this.normalizeKey(d))
        .map(r => ({ month: r.month, value: r.value }));

      this.tsData.set(filtered);
      console.log('Filtered records set to tsData:', this.tsData());


    });
  }

  reset() {
    this.selectedCounty.set(null);
    this.selectedDivision.set(null);
    this.viewMode.set('islands');

    // reload map outlines
    this.http.get<any>('hawaii_islands_simplified.geojson').subscribe(fc => {
      const projection = geoIdentity().reflectY(true).fitExtent([[-130, 10], [560, 310]], fc);
      const path = geoPath(projection as any);
      this.project = projection as any;
      this.updateRasterRect();

      const features = fc.features.map((f: any) => {
        const name = f.properties?.isle || 'Island';
        const id = name.toLowerCase().replace(/\s+/g, '-');
        return { id, name, short: name, divisions: [], feature: f, key: id } as Island;
      });

      const pathById: Record<string, string> = {};
      const centroidById: Record<string, [number, number]> = {};
      for (const is of features) {
        pathById[is.id] = path(is.feature)!;
        centroidById[is.id] = path.centroid(is.feature) as [number, number];
      }

      this.islands.set(features);
      this.pathById.set(pathById);
      this.centroidById.set(centroidById);
    });

    const dataset = this.selectedDataset();

    // reload data normally
    if (dataset === 'Drought') this.loadAllSPIData();
    else if (dataset === 'Rainfall') this.loadRainfallData();
    else if (dataset === 'Temperature') this.loadTemperatureData();

    // === smooth transition ===
    // small helper to animate once data is ready
    const applyStatewide = () => {
      const stateData = this.statewideSPI
        .filter((r: any) => r.state?.toLowerCase() === 'statewide')
        .map((r: any) => ({ month: r.month, value: r.value }));

      if (!stateData.length) return false; // still not ready
      const old = this.tsData();

      if (!old || !old.length) {
        this.tsData.set(stateData);
        return true;
      }

      // trigger animation
      const intermediate = stateData.map((d, i) => ({
        month: d.month,
        value: old[i] ? old[i].value : 0
      }));
      this.tsData.set(intermediate);
      setTimeout(() => this.tsData.set(stateData), 50);
      return true;
    };

    // try immediately; if data not ready yet, retry shortly
    if (!applyStatewide()) {
      const check = setInterval(() => {
        if (applyStatewide()) clearInterval(check);
      }, 100);
    }
  }



}

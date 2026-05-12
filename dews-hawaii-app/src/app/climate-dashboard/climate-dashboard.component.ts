import { Component, computed, signal, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient, HttpClientModule } from '@angular/common/http';
import { geoIdentity, geoPath } from 'd3-geo';
import type { FeatureCollection } from 'geojson';
import * as d3 from 'd3';
import { firstValueFrom, forkJoin, of, throwError } from 'rxjs';
import { StatBoxComponent } from '../stat-box/stat-box.component';
import { DataHighchartComponent } from '../data-highchart/data-highchart.component';
import { FooterComponent } from '../footer/footer.component';

import * as GeoTIFF from 'geotiff';
import { Pool } from 'geotiff';
import { NgZone } from '@angular/core';
import { MapPanelComponent } from '../map-panel/map-panel.component';

import { EmailSubscriptionService } from '../services/email-subscription.service';

import { catchError, map, switchMap } from 'rxjs/operators';

export type Scope = 'divisions' | 'moku' | 'ahupuaa' | 'watershed';

type Dataset = 'Rainfall' | 'Temperature' | 'Drought';

type ScopedOption = { label: string; value: string };

interface Island {
  id: string;
  name: string;
  short: string;
  divisions: string[];
  feature: any;
  key: string;
  island?: string;
}


// County → list of islands
const COUNTY_GROUPS: Record<string, string[]> = {
  'Kauaʻi': ['Kauaʻi'],
  'Honolulu': ['Oʻahu'],
  'Maui': ['Maui', 'Molokaʻi', 'Lānaʻi', 'Kahoʻolawe'],
  'Hawaiʻi': ['Hawaiʻi']
};

function canonIsland(name: string): string {
  if (!name) return '';
  return name
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/['‘’ʻ`]/gu, '')
    .toLowerCase()
    .trim();
}

@Component({
  selector: 'app-climate-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule, HttpClientModule, StatBoxComponent, DataHighchartComponent, FooterComponent, MapPanelComponent],
  templateUrl: './climate-dashboard.component.html',
  styleUrls: ['./climate-dashboard.component.css']
})
export class ClimateDashboardComponent implements OnDestroy {
  constructor(private http: HttpClient, private ngZone: NgZone,private emailSvc: EmailSubscriptionService) { }

  islands = signal<Island[]>([]);
  pathById = signal<Record<string, string>>({});
  centroidById = signal<Record<string, [number, number]>>({});
  trackByIsle = (_: number, isle: { id: string | number }) => isle.id;
  trackByDivision = (_: number, d: string) => d;
  hoveredFeature = signal<string | null>(null);
  hoveredLabel = signal<{ name: string; x: number; y: number } | null>(null);

  selectedDivision = signal<string | null>(null);
  viewMode = signal<'islands' | 'divisions'>('islands');
  selectedIsland = signal<string | null>(null);
  stats = signal<{
    mean?: number;
    anomaly?: number;
    pchange?: number;
    rank?: number;
    ytd_pnormal?: number;
    d0?: number; d1?: number; d2?: number; d3?: number; d4?: number;
    w0?: number; w1?: number; w2?: number; w3?: number; w4?: number;
    near_normal?: number;
  } | null>(null);
  dataset = signal<Dataset>('Rainfall');
  selectedDataset() { return this.dataset(); }

  pickDataset(d: Dataset) {
    this.dataset.set(d);
    this.loadRasterOnce(d);
    this.loadStats();

    if (d === 'Rainfall') this.loadRainfallData();
    else if (d === 'Temperature') this.loadTemperatureData();
    else if (d === 'Drought') this.loadDroughtDistribution(); // <--- Use the new loader
  }

  normalizeKey(str: string): string {
    if (!str) return '';
    return str
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/['ʻ‘`’]/g, '')
      .trim();
  }

  allDivisions: any;
  statewideSPI: any[] = [];
  islandSPI: any[] = [];
  divisionSPI: any[] = [];

  divisionSPIByScale: Record<number, any[]> = {};


  // ===== Scope selection =====
  selectedScope = signal<Scope | null>(null);
  setScope(scope: Scope | null) {
    this.selectedScope.set(scope);
    if (this.selectedIsland()) {
      // Redraw boundaries but don't refresh stats unless a division is already selected
      const island = this.selectedIsland()!;
      const prevDivision = this.selectedDivision();
      this.pickIsland(island);
      if (prevDivision) this.loadStats();
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

  islandLabel = computed(() => {
    const island = this.selectedIsland();
    if (!island) return null;
    return `${island} Island`;
  });


  // private islandStubForCounty(county: string): Island | null {
  //   const members = COUNTY_GROUPS[county];
  //   if (!members || !members.length) return null;
  //   const name = members[0];
  //   const id = name.toLowerCase().replace(/\s+/g, '-');
  //   return { id, name, short: name, divisions: [], feature: null, key: id };
  // }

  pickIsland(island: string) {
    this.selectedIsland.set(island);
    this.selectedDivision.set(null);

    const islandCanon = canonIsland(island);
    const scope = this.selectedScope();

    if (!scope) {
      // --- Single island outline ---
      this.viewMode.set('islands');

      this.http.get<any>('hawaii_islands_simplified.geojson').subscribe(fc => {
        const fcIsland: FeatureCollection = {
          type: 'FeatureCollection',
          features: fc.features.filter((f: any) => {
            const name = this.getProp(f.properties, ['isle', 'island', 'name']) || '';
            return canonIsland(name) === islandCanon;
          })
        };

        const projection = geoIdentity().reflectY(true).fitExtent(
          [[-130, 10], [560, 320]],
          fcIsland
        );

        const path = geoPath(projection as any);
        this.project = projection as any;
        this.updateRasterRect();

        const features = fcIsland.features.map((f: any) => {
          const name = this.getProp(f.properties, ['isle', 'island', 'name']) || island;
          const id = canonIsland(name);
          return {
            id,
            key: id,
            name,
            short: name,
            divisions: [],
            feature: f
          } as Island;
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
      // --- Scoped polygons (moku, ahupuaa, etc.) ---
      this.viewMode.set('divisions');

      const file =
        scope === 'moku' ? 'moku.geojson' :
        scope === 'ahupuaa' ? 'ahupuaa.geojson' :
        scope === 'watershed' ? 'watershed.geojson' :
        'hawaii_islands_divisions.geojson';

      forkJoin({
        baseIslands: this.http.get<any>('hawaii_islands_simplified.geojson'),
        divisions: this.http.get<any>(file)
      }).subscribe(({ baseIslands, divisions }) => {
        const fcIslandBase: FeatureCollection = {
          type: 'FeatureCollection',
          features: baseIslands.features.filter((f: any) => {
            const name = this.getProp(f.properties, ['isle', 'island', 'name']) || '';
            return canonIsland(name) === islandCanon;
          })
        };

        const projection = geoIdentity().reflectY(true).fitExtent(
          [[-130, 10], [560, 320]],
          fcIslandBase
        );

        const fcDivisions: FeatureCollection = {
          type: 'FeatureCollection',
          features: divisions.features.filter((f: any) => {
            const p = f.properties || {};
            const featureIsland = String(this.getProp(p, ['mokupuni', 'island', 'isle', 'Island', 'ISLAND']) || '');
            const canonF = canonIsland(featureIsland);

            let isMatch = canonF === islandCanon || canonF.includes(islandCanon);
            if (!isMatch && scope === 'divisions') {
              const isMauiNui = ['kahoolawe', 'lanai', 'molokai', 'maui'].includes(islandCanon);
              const regionCanon = isMauiNui ? 'maui' : islandCanon;

              isMatch = canonF === regionCanon || canonF.includes(regionCanon);
            }

            if (islandCanon === 'maui') {
              const featureName = String(this.getProp(p, ['division', 'Division', 'name', 'NAME', 'moku', 'Moku', 'MOKU', 'ahupuaa', 'Ahupuaʻa', 'wuname', 'watershed']) || '');
              if (canonIsland(featureName) === 'hilo') {
                isMatch = true; // Keep Hilo!
              }
            }

            return isMatch;
          })
        };

        const path = geoPath(projection as any);
        this.project = projection as any;
        this.updateRasterRect();

        const features = fcDivisions.features.map((f: any) => {
          const p = f.properties || {};

          const name =
            scope === 'ahupuaa'
              ? this.getProp(p, ['ahupuaa', 'Ahupuaʻa', 'Ahupuaa', 'AHUPUAA', 'AHUPUAA_N'])
              : scope === 'moku'
              ? this.getProp(p, ['moku', 'Moku', 'MOKU'])
              : scope === 'watershed'
              ? this.getProp(p, ['wuname', 'name_hwn', 'watershed', 'Watershed', 'WATERSHED', 'name'])
              : this.getProp(p, ['division', 'Division', 'name', 'NAME']);

          let prefixCanon = islandCanon;
          let displayIsland = island;

          if (scope === 'divisions') {
            const isMauiNui = ['kahoolawe', 'lanai', 'molokai', 'maui'].includes(islandCanon);

            if (isMauiNui) {
              if (canonIsland(name) === 'hilo') {
                prefixCanon = 'hawaii';
                displayIsland = 'Hawaiʻi';
              } else {
                prefixCanon = 'maui';
                displayIsland = 'Maui';
              }
            }
          }

          const key = `${prefixCanon}::${name}`;
          const id = `${prefixCanon}-${name}`.toLowerCase().replace(/\s+/g, '-');

          return {
            id,
            key,
            name,
            short: name,
            island: displayIsland,
            divisions: [],
            feature: f
          } as Island;
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

    // reload data
    this.loadStats();
    this.loadRainfallData();
  }


  tsData = signal<{ month: string; value: number }[]>([]);

  email = signal<string>('');
  private emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  isEmailValid = computed(() => this.emailRegex.test(this.email().trim()));
  subscribe() {
    const email = this.email().trim();
    if (!this.isEmailValid()) return;

    // your existing "new_body" construction
    const newBody: any = { email };

    const islandSel = this.selectedIsland();
    const scope = this.selectedScope();
    const divisionKey = this.selectedDivision();

    if (islandSel) newBody.island = [this.islandToApi(islandSel)];
    else newBody.island = ['hawaii', 'honolulu', 'kauai', 'maui'];

    if (scope && divisionKey) {
      const name = this.extractScopedName(divisionKey);
      if (scope === 'moku') newBody.moku = [name];
      else if (scope === 'ahupuaa') newBody.ahupuaa = [name];
      else if (scope === 'watershed') newBody.watershed = [name];

      if (islandSel) {
        const islandKey = this.slugifySelection(islandSel);
        newBody.county = [this.ISLAND_CANONICAL[islandKey] ?? islandSel];
      }
    }

    this.emailSvc.emailLookup(email).pipe(
      switchMap(({ userID }) => {
        // New user -> create
        if (!userID) {
          return this.emailSvc.createSubscription(newBody).pipe(
            map(() => ({ mode: 'created' as const }))
          );
        }

        // Existing user -> fetch existing subscription, merge, update
        return this.emailSvc.getSubscription(userID).pipe(
          switchMap(existing => {
            const updatedBody = this.buildUpdatedBody(existing, newBody);
            return this.emailSvc.updateSubscription(userID, updatedBody).pipe(
              map(() => ({ mode: 'updated' as const }))
            );
          })
        );
      }),
      catchError(err => {
        console.error('Subscription error:', err);
        // show the API error details if present
        const msg =
          typeof err?.error === 'string'
            ? err.error
            : JSON.stringify(err?.error ?? err, null, 2);
        alert(msg);
        return throwError(() => err);
      })
    ).subscribe(({ mode }) => {
      const label = this.selectedDivisionName() || this.islandLabel() || 'Statewide';
      alert(`${mode === 'created' ? 'Subscribed' : 'Updated subscription'} for ${this.selectedDataset()} — ${label}.`);
    });
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


  private async loadStats(divisionArg?: string | null) {
    const dataset = this.selectedDataset();
    const island = this.selectedIsland();
    const division = divisionArg || this.selectedDivision();
    const scope = this.selectedScope();

    let prefix = 'statewide';
    if (scope === 'ahupuaa') prefix = 'ahupuaa';
    else if (scope === 'moku') prefix = 'moku';
    else if (scope === 'watershed') prefix = 'watershed';
    else if (scope === 'divisions') prefix = 'climate';
    else if (island) prefix = 'island';

    const folder = dataset === 'Drought' ? 'spi' : dataset.toLowerCase();
    const suffix = dataset.toLowerCase();

    // This forces the path to 'spi/statewide_drought_stats.csv'
    const file = `${folder}/${prefix}_${suffix}_stats.csv`;

    const csv = await firstValueFrom(this.http.get(file, { responseType: 'text' }));
    const rows = d3.csvParse(csv);

    let record: any = null;

    if (division) {
      const parts = division.split('::');
      const baseDiv = parts.length === 2 ? parts[1].trim() : division.trim();

      record = rows.find(r => {
        const csvLabel = this.normalizeKey(r['division_full'] || r['Division'] || r['name'] || '');
        // Check if the CSV matches either the full key OR the base division name
        return csvLabel === this.normalizeKey(division) || csvLabel === this.normalizeKey(baseDiv);
      });
    }

    if (!record && island) {
      const iso = this.normalizeKey(island);

      record = rows.find(r => {
        const fullValue = r['division_full'] || r['Division'] || '';
        const normalizedCSV = this.normalizeKey(fullValue);

        if (fullValue.includes('::')) {
          const parts = fullValue.split('::').map(p => this.normalizeKey(p));
          return parts.includes(iso);
        }

        return normalizedCSV === iso;
      });
    }

    if (!record) {
      record = rows.find(r =>
        this.normalizeKey(r['division_full'] || '') === 'statewide'
      );
    }

    this.stats.set(record ? {
      mean: +record.mean,
      anomaly: +record.anomaly,
      pchange: +record.pchange,
      rank: +record.rank,
      ytd_pnormal: +record.ytd_pnormal,
      d4: +record.D4, d3: +record.D3, d2: +record.D2, d1: +record.D1, d0: +record.D0,
      w4: +record.W4, w3: +record.W3, w2: +record.W2, w1: +record.W1, w0: +record.W0,
      near_normal: +record['Near Normal']
    } : null);
  }


  private async loadRasterOnce(dataset: Dataset) {
    try {
      let file = '';
      if (dataset === 'Rainfall') file = 'tifs/rainfall_pdiff_cat.tif';
      else if (dataset === 'Temperature') file = 'tifs/temperature_diff_cat.tif';
      else if (dataset === 'Drought') file = 'tifs/spi3_cat.tif';

      // --- Open the GeoTIFF ---
      const tiff = await GeoTIFF.fromUrl(file);
      const image = await tiff.getImage();
      this.rasterBBox = image.getBoundingBox() as [number, number, number, number];

      // --- Use full resolution (no resampling) ---
      const srcW = image.getWidth();
      const srcH = image.getHeight();

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
      canvas.width = srcW;
      canvas.height = srcH;



      // --- Handle NoData ---
      const nodata = this.getNoDataValue(image);
      const isNoData = (v: number) =>
        (nodata !== undefined && v === nodata) ||
        !Number.isFinite(v) ||
        Math.abs(v) > 1e20;


      const config = this.rainfallConfig();
      const palettes: Record<Dataset, string[]> = {
        Drought: [/* ... */],
        Temperature: [/* ... */],
        Rainfall: config ? config.items.map((item: any) => item.color) : [
          "#730000", "#FF0000", "#FF6600", "#FFCC66", "#FFFFFF",
          "#CCE5FF", "#99CCFF", "#0066CC", "#001933"
        ]
      };


      // --- Draw image pixel by pixel ---
      const imgData = ctx.createImageData(srcW, srcH);
      for (let i = 0; i < band.length; i++) {
        const v = Number(band[i]);
        const idx = i * 4;
        if (isNoData(v)) { imgData.data[idx + 3] = 0; continue; }

        let r = 255, g = 255, b = 255, a = 255;

        const palettes: Record<Dataset, string[]> = {
          Drought: [
            "#730000", "#FF0000", "#FF9900", "#FFD37F", "#FFFF00",
            "#FFFFFF", "#99CCFF", "#3399FF", "#0066CC", "#003366", "#001933"
          ],
          Rainfall: [
            "#730000", // Index 0: < -70%
            "#FF0000", // Index 1: -70 to -50
            "#FF6600", // Index 2: -50 to -30
            "#FFCC66", // Index 3: -30 to -10
            "#FFFFFF", // Index 4: -10 to +10
            "#CCE5FF", // Index 5: +10 to +30
            "#99CCFF", // Index 6: +30 to +50
            "#0066CC", // Index 7: +50 to +70
            "#001933"  // Index 8: > +70
          ],
          Temperature: [
            "#001933", "#0066CC", "#99CCFF", "#FFFFFF",
            "#FF9900", "#FF0000", "#730000"
          ]
        };

        const palette = palettes[dataset];
        const cat = Math.round(v);

        if (!isNoData(v) && cat >= 0 && cat < palette.length) {
          const c = d3.rgb(palette[cat]);
          r = c.r; g = c.g; b = c.b;
        } else {
          a = 0;
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

  rainfallConfig = signal<any>(null);

  private async loadRainfallDataConfig() {
    const config = await firstValueFrom(this.http.get<any>('tifs/rainfall_legend.json'));
    this.rainfallConfig.set(config);
    return config;
  }

  private drawDynamicRainfallLegend(config: any) {
    const legendDiv = document.getElementById('colorbarLegend') as HTMLDivElement | null;
    if (!legendDiv) return;

    legendDiv.innerHTML = '';
    const items = [...config.items];

    const colors = items.map(i => i.color);
    const labels = items.map(i => i.label);

    this.buildLegend(legendDiv, colors, labels);
  }

  currentDateLabel = signal<string>('');
  rainfallYears = signal<number>(-999);
  temperatureYears = signal<number>(-999);

  async ngOnInit(): Promise<void> {
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
        return <Island>{ id, name, short: name, divisions: [], feature: f, key: id };
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
      this.loadDroughtDistribution();
    }

    this.loadStats();

    await this.loadRainfallDataConfig();

    this.http.get<any>('hawaii_islands_simplified.geojson').subscribe(fc => {
      if (this.selectedDataset() === 'Rainfall') {
        this.loadRasterOnce('Rainfall');
      }
    });

    this.http.get<any>('metadata.json').subscribe({
      next: (metadata) => {
        if (metadata && metadata.date) {
          const dateObj = new Date(metadata.date);
          const formattedDate = dateObj.toLocaleDateString('en-US', {
            month: 'long',
            year: 'numeric',
            timeZone: 'Pacific/Honolulu'
          });
          this.currentDateLabel.set(formattedDate);
          if (metadata.num_rows_rainfall) {
            this.rainfallYears.set(metadata.num_rows_rainfall);
          }
          if (metadata.num_rows_temperature) {
            this.temperatureYears.set(metadata.num_rows_temperature);
          }
        }
      },
      error: (err) => {
        // This will print the exact error to your browser's F12 Developer Console
        console.error('Failed to load metadata.json:', err);

        // Optional: Set a fallback label if the fetch fails
        this.currentDateLabel.set('Date Unavailable');
      }
    });

  }

  // Existing Drought Stats
  currentDroughtStats = computed(() => {
    const data = this.stats();
    if (!data) return null;

    const d4 = Number(data.d4) || 0;
    const d3 = Number(data.d3) || 0;
    const d2 = Number(data.d2) || 0;
    const d1 = Number(data.d1) || 0;
    const d0 = Number(data.d0) || 0;

    const totalDry = d0 + d1 + d2 + d3 + d4;

    return {
      d4: Math.round(d4),
      d3: Math.round(d3 + d4),
      d2: Math.round(d2 + d3 + d4),
      d1: Math.round(d1 + d2 + d3 + d4),
      d0: Math.round(totalDry),
      totalBase: totalDry // Raw unrounded sum for precise comparison
    };
  });

  // New Wet Stats
  currentWetStats = computed(() => {
    const data = this.stats();
    if (!data) return null;

    const w4 = Number(data.w4) || 0;
    const w3 = Number(data.w3) || 0;
    const w2 = Number(data.w2) || 0;
    const w1 = Number(data.w1) || 0;
    const w0 = Number(data.w0) || 0;

    const totalWet = w0 + w1 + w2 + w3 + w4;

    return {
      w4: Math.round(w4),
      w3: Math.round(w3 + w4),
      w2: Math.round(w2 + w3 + w4),
      w1: Math.round(w1 + w2 + w3 + w4),
      w0: Math.round(totalWet),
      totalBase: totalWet // Raw unrounded sum for precise comparison
    };
  });

  // Determines which condition is currently heavier
  dominantCondition = computed<'drought' | 'wet'>(() => {
    const dStats = this.currentDroughtStats();
    const wStats = this.currentWetStats();

    if (!dStats || !wStats) return 'drought'; // default fallback

    // If wet area is strictly greater than dry area, show wet stats
    if (wStats.totalBase > dStats.totalBase) {
      return 'wet';
    }

    return 'drought';
  });

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
      if (!legendDiv) return;

      // --- Drought ---
      if (dataset === 'Drought') {
        if (canvas) canvas.style.display = 'none';
        legendDiv.innerHTML = '';
        const droughtColors = [
          "#730000", "#FF0000", "#FF9900", "#FFD37F", "#FFFF00",
          "#FFFFFF", "#99CCFF", "#3399FF", "#0066CC", "#003366", "#001933"
        ];
        const droughtLabels = [
          "D4 Exceptional Drought", "D3 Extreme Drought", "D2 Severe Drought",
          "D1 Moderate Drought", "D0 Abnormally Dry", "Near Normal",
          "W0 Abnormally Wet", "W1 Moderately Wet", "W2 Very Wet",
          "W3 Extremely Wet", "W4 Exceptionally Wet"
        ];
        this.buildLegend(legendDiv, droughtColors, droughtLabels);
        return;
      }

      if (dataset === 'Rainfall') {
        if (canvas) canvas.style.display = 'none';
        const config = this.rainfallConfig();

        if (config) {
          this.drawDynamicRainfallLegend(config);
        } else {
          const rainfallColors = [
            "#730000", "#FF0000", "#FF6600", "#FFCC66", "#FFFFFF",
            "#CCE5FF", "#99CCFF", "#0066CC", "#001933"
          ];
          const rainfallLabels = [
            "< -70%", "-70% to -50%", "-50% to -30%", "-30% to -10%",
            "-10% to +10%", "+10% to +30%", "+30% to +50%", "+50% to +70%", "> +70%"
          ];
          this.buildLegend(legendDiv, rainfallColors, rainfallLabels);
        }
        return;
      }

      //Temperature
      if (dataset === 'Temperature') {
        if (canvas) canvas.style.display = 'none';
        legendDiv.innerHTML = '';
        const tempColors = [
          "#001933", "#0066CC", "#99CCFF", "#FFFFFF",
          "#FF9900", "#FF0000", "#730000"
        ];
        const tempLabels = [
          "< -1°F", "-1 to -0.6°F", "-0.6 to -0.2°F",
          "-0.2 to 0.2°F", "0.2 to 0.6°F", "0.6 to 1°F", "> 1°F"
        ];
        this.buildLegend(legendDiv, tempColors, tempLabels);
        return;
      }

    });
  }

  getRankSentiment(rank: number | undefined, totalYears: number): 'high' | 'low' {
    if (rank == null || totalYears <= 0) return 'low';
    // Top half (e.g., 1-15 out of 30)
    return rank <= (totalYears / 2) ? 'high' : 'low';
  }

  // Helper to draw categorical legends consistently
  private buildLegend(container: HTMLDivElement, colors: string[], labels: string[]) {
    container.innerHTML = '';
    colors.forEach((color, i) => {
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
      label.textContent = labels[i];
      label.style.fontSize = '0.85rem';
      label.style.color = '#333';

      item.appendChild(swatch);
      item.appendChild(label);
      container.appendChild(item);
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
    const island = this.selectedIsland();
    const file = island ? 'rainfall/island_rainfall.csv' : 'rainfall/statewide_rainfall.csv';

    this.http.get(file, { responseType: 'text' }).subscribe(csv => {
      const data = this.parseCsv(csv, island ? 'island' : 'state');

      if (island) {
        const filtered = data
          .filter(r => this.normalizeKey(r.island || '') === this.normalizeKey(island))
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
    const island = this.selectedIsland();
    const file = island ? 'temperature/island_temperature.csv' : 'temperature/statewide_temperature.csv';

    this.http.get(file, { responseType: 'text' }).subscribe(csv => {
      const data = this.parseCsv(csv, island ? 'island' : 'state');

      if (island) {
        const filtered = data
          .filter(r => r.island?.trim().toLowerCase() === island.trim().toLowerCase())
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
    this.http.get(`spi/island_spi${scale}.csv`, { responseType: 'text' })
      .subscribe(csv => {
        this.islandSPI = this.parseCsv(csv, 'island');
        if (this.selectedIsland()) this.pickIsland(this.selectedIsland()!);

      });

    // Scope-specific (if selected)
    const scope = this.selectedScope();
    if (scope) {
      let file = '';
      let labelKey: 'division' | 'moku' | 'ahupuaa';
      if (scope === 'divisions') { file = `spi/climate_spi${scale}.csv`; labelKey = 'division'; }
      else if (scope === 'moku') { file = `spi/moku_spi${scale}.csv`; labelKey = 'moku'; }
      else { file = `spi/ahupuaa_spi${scale}.csv`; labelKey = 'ahupuaa'; }

      this.http.get(file, { responseType: 'text' })
        .subscribe(csv => {
          this.divisionSPI = this.parseCsv(csv, labelKey);
          if (this.selectedDivision()) this.pickDivision(this.selectedDivision()!);
        });
    } else {
      this.divisionSPI = [];
      this.selectedDivision.set(null);
    }

    // Statewide
    this.http.get(`spi/statewide_spi${scale}.csv`, { responseType: 'text' })
      .subscribe(csv => {
        this.statewideSPI = this.parseCsv(csv, 'state');
        if (!this.selectedIsland() && !this.selectedDivision()) {
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
  private async loadDroughtDistribution() {
    // Path to the CSV generated by your Python script
    const file = 'spi/statewide_spi3_distribution.csv';

    try {
      const csv = await firstValueFrom(this.http.get(file, { responseType: 'text' }));
      const rows = d3.csvParse(csv);

      // Convert string values from CSV to numbers
      const formattedData = rows.map(row => {
        const obj: any = { month: row['month'] };
        Object.keys(row).forEach(key => {
          if (key !== 'month') obj[key] = parseFloat(row[key] || '0');
        });
        return obj;
      });

      this.tsData.set(formattedData);
    } catch (err) {
      console.error('Could not load drought distribution CSV', err);
    }
  }

  // private async loadAllSPIData() {
  //   const scales = [1, 6, 12];
  //   const county = this.selectedCounty();
  //   const div = this.selectedDivision();
  //   const scope = this.selectedScope();

  //   const requests = scales.map(async scale => {
  //     let file = '';
  //     let labelKey: 'state' | 'division' | 'moku' | 'ahupuaa' | 'watershed' | 'county' = 'state';

  //     if (scope === 'divisions') {
  //       file = `spi/climate_spi${scale}.csv`; labelKey = 'division';
  //     } else if (scope === 'moku') {
  //       file = `spi/moku_spi${scale}.csv`; labelKey = 'moku';
  //     } else if (scope === 'ahupuaa') {
  //       file = `spi/ahupuaa_spi${scale}.csv`; labelKey = 'ahupuaa';
  //     } else if (scope === 'watershed') {
  //       file = `spi/watershed_spi${scale}.csv`; labelKey = 'watershed';
  //     } else if (county) {
  //       file = `spi/county_spi${scale}.csv`; labelKey = 'county';
  //     } else {
  //       file = `spi/statewide_spi${scale}.csv`; labelKey = 'state';
  //     }


  //     const csv = await firstValueFrom(this.http.get(file, { responseType: 'text' }));
  //     const parsed = this.parseCsv(csv, labelKey);

  //     this.divisionSPIByScale[scale] = parsed;

  //     let data: { month: string; value: number }[] = [];

  //     if (div) {
  //       // Specific division selected
  //       const divKey = div.trim().toLowerCase(); // keep full island::division key
  //       data = parsed
  //         .filter(r => this.normalizeKey(r[labelKey] || '') === this.normalizeKey(div))
  //         .map(r => ({ month: r.month, value: r.value }));

  //     } else if (county) {
  //       data = parsed
  //         .filter(r => r[labelKey]?.trim().toLowerCase() === county.trim().toLowerCase())
  //         .map(r => ({ month: r.month, value: r.value }));
  //     } else {
  //       // Fallback to statewide
  //       data = parsed
  //         .filter(r => r.state?.toLowerCase() === 'statewide')
  //         .map(r => ({ month: r.month, value: r.value }));
  //     }

  //     return { scale, data };
  //   });

  //   Promise.all(requests).then(results => this.spiSeries.set(results));
  // }

  pickDivision(d: string | null) {
    this.selectedDivision.set(d);
    this.loadStats(d);

    if (!d) {
      // If no division was chosen, fallback to island/statewide
      const island = this.selectedIsland();
      if (island && this.selectedDataset() === 'Drought') {
        const newSeries = this.spiSeries().map(s => {
          const parsed = this.divisionSPIByScale[s.scale] || [];
          return {
            scale: s.scale,
            data: parsed
              .filter((r: any) => r['island']?.trim().toLowerCase() === island.trim().toLowerCase())
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
      const parts = d.split('::');
      const baseDiv = parts.length === 2 ? parts[1].trim() : d.trim();

      const promises = scales.map(scale =>
        firstValueFrom(this.http.get(`spi/${scope}_spi${scale}.csv`, { responseType: 'text' }))
          .then(csv => {
            const parsed = this.parseCsv(csv, labelKey);
            this.divisionSPIByScale[scale] = parsed;
            const data = parsed
              .filter(r => {
                const csvLabel = this.normalizeKey(r[labelKey] || '');
                return csvLabel === this.normalizeKey(d) || csvLabel === this.normalizeKey(baseDiv);
              })
              .map(r => ({ month: r.month, value: r.value }));
            return { scale, data };
          })
      );

      Promise.all(promises).then(results => this.spiSeries.set(results));
      return;
    }

    // Rainfall / Temperature
    const datasetFolder = dataset.toLowerCase(); // rainfall | temperature
    const prefix = scope === 'divisions' ? 'climate' : scope;
    const file = `${datasetFolder}/${prefix}_${datasetFolder}.csv`;

    const parts = d.split('::');
    const baseDiv = parts.length === 2 ? parts[1].trim() : d.trim();

    this.http.get(file, { responseType: 'text' }).subscribe(csv => {
      const parsed = this.parseCsv(csv, labelKey);

      const filtered = parsed
        .filter(r => {
          const csvLabel = this.normalizeKey(r[labelKey] || '');
          return (
            csvLabel === this.normalizeKey(d) ||
            csvLabel === this.normalizeKey(baseDiv)
          );
        })
        .map(r => ({ month: r.month, value: r.value }));

      this.tsData.set(filtered);
    });
  }

  reset() {
    this.selectedIsland.set(null);
    this.selectedDivision.set(null);
    this.viewMode.set('islands');
    this.loadStats();
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

    // Reload data normally
    if (dataset === 'Drought') {
      this.loadDroughtDistribution();
    } else if (dataset === 'Rainfall') {
      this.loadRainfallData();
    } else if (dataset === 'Temperature') {
      this.loadTemperatureData();
    }

    // --- Force statewide stats reload ---
    setTimeout(() => this.loadStats(null), 0);


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
    // --- Force statewide stats reload explicitly ---
    setTimeout(() => {
      this.selectedScope.set(null);
      this.selectedIsland.set(null);
      this.selectedDivision.set(null);
      console.log('Reset: fetching statewide stats');
      this.loadStats(null);
    }, 50);

  }

  formatRank(rank: number | undefined): string {
    if (rank == null || Number.isNaN(rank)) return '';

    const j = rank % 10;
    const k = rank % 100;

    let suffix = 'th';
    if (j === 1 && k !== 11) suffix = 'st';
    else if (j === 2 && k !== 12) suffix = 'nd';
    else if (j === 3 && k !== 13) suffix = 'rd';

    return `${rank}<sup>${suffix}</sup>`;
  }



  formatAnomaly(value?: number | null, dataset?: 'Rainfall' | 'Temperature' | 'Drought'): string {
    if (value == null || isNaN(value)) return '';
    const sign = value > 0 ? '+' : '';
    const unit =
      dataset === 'Rainfall'
        ? ' in'
        : dataset === 'Temperature'
        ? '°F'
        : '';
    return `${sign}${value.toFixed(1)}${unit}`.trim();
  }

  private slugifySelection(s: string): string {
    return (s || '')
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .replace(/['’ʻ`]/g, '')
      .toLowerCase()
      .trim()
      .replace(/\s+/g, '_'); // wahiawa, north_kauai, etc.
  }

  private islandToApi(island: string): string {
    return this.slugifySelection(island).replace('_island', '');
  }

  private readonly ISLAND_CANONICAL: Record<string, string> = {
    hawaii:    'Hawaiʻi',
    oahu:      'Oʻahu',
    kauai:     'Kauaʻi',
    lanai:     'Lānaʻi',
    molokai:   'Molokaʻi',
    kahoolawe: 'Kahoʻolawe',
    maui:      'Maui',
    niihau:    'Niʻihau',
  };

  private extractScopedName(key: string): string {
    const parts = key.split('::');
    if (parts.length === 2) {
      const islandKey = this.slugifySelection(parts[0]);
      const islandName = this.ISLAND_CANONICAL[islandKey] ?? parts[0].trim();
      return `${islandName}::${parts[1].trim()}`;
    }
    return key.trim();
  }

  private readonly LIST_FIELDS: Array<'county'|'moku'|'ahupuaa'|'watershed'> =
    ['county', 'moku', 'ahupuaa', 'watershed'];

  private mergeDedup(oldVals: string[] = [], newVals: string[] = []): string[] {
    const normalize = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[ʻ''`]/gu, '').toLowerCase();
    const baseName = (v: string) => normalize(v.includes('::') ? v.split('::')[1] : v);

    // Base names from incoming values supersede old bare-name entries for the same location
    const newBaseNames = new Set(newVals.map(v => baseName(v)));

    const out: string[] = [];
    const seen = new Set<string>();

    for (const v of oldVals) {
      const s = (v ?? '').trim();
      if (!s || newBaseNames.has(baseName(s))) continue; // superseded by new prefixed entry
      if (!seen.has(s)) { seen.add(s); out.push(s); }
    }

    for (const v of newVals) {
      const s = (v ?? '').trim();
      if (!s) continue;
      if (!seen.has(s)) { seen.add(s); out.push(s); }
    }

    return out;
  }

  private buildUpdatedBody(existing: any, incoming: any) {
    const updated: any = { email: existing.email };

    for (const f of this.LIST_FIELDS) {
      updated[f] = this.mergeDedup(existing?.[f] ?? [], incoming?.[f] ?? []);
    }

    return updated;
  }


  countyMenuOpen = signal(false);

  toggleCountyMenu() {
    this.countyMenuOpen.set(!this.countyMenuOpen());
  }

  closeCountyMenu() {
    this.countyMenuOpen.set(false);
  }

  chooseIsland(island: string | null) {
    this.closeCountyMenu();

    if (!island) {
      this.reset();
      return;
    }

    this.pickIsland(island);
  }
  selectedCountyDisplay = computed(() => this.selectedIsland() || 'Statewide');

  get fullSelectionLabel(): string {
    const island = this.selectedIsland();
    const rawDivision = this.selectedDivision();
    // Provide a fallback string '' if selectedScope() is null
    const scope = this.selectedScope() ?? '';

    if (!island && !rawDivision) return 'Statewide';

    if (rawDivision) {
      const cleanName = rawDivision.includes('::')
        ? rawDivision.split('::')[1]
        : rawDivision;

      const labels: Record<string, string> = {
        'divisions': 'Climate Division',
        'moku': 'Moku',
        'ahupuaa': 'Ahupuaʻa',
        'watershed': 'Watershed'
      };

      const suffix = labels[scope] || '';

      // Intercept the label to show "Maui" if the key belongs to Maui
      let displayIsland = island;
      if (scope === 'divisions' && rawDivision.toLowerCase().startsWith('maui::')) {
        displayIsland = 'Maui';
      }

      return `${displayIsland} - ${cleanName} ${suffix}`.trim();
    }

    return island || 'Statewide';
  }

  selectionLabel = computed(() => {
    let island = this.selectedIsland();
    const rawDivision = this.selectedDivision();
    const scope = this.selectedScope();

    // Force it to show Maui if viewing a Maui division
    if (scope === 'divisions' && rawDivision?.toLowerCase().startsWith('maui::')) {
      island = 'Maui';
    }

    const division = this.selectedDivisionName();

    if (island && division) {
      return `${island} > ${division}`;
    }

    if (island) return island;

    return 'Statewide';
  });


  trackByScopedOption = (_: number, opt: ScopedOption) => opt.value;

  availableScopedOptions = computed<ScopedOption[]>(() => {
    const scope = this.selectedScope();
    const island = this.selectedIsland();

    if ((scope !== 'watershed' && scope !== 'ahupuaa') || !island) return [];

    return this.islands()
      .filter(f => !!f.key && !!f.name && f.key.includes('::'))
      .map(f => ({
        label: f.name,
        value: f.key
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  });

}

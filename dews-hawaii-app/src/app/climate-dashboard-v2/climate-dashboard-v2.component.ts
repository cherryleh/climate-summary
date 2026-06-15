import { Component, computed, signal, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient, HttpClientModule, HttpHeaders, HttpParams } from '@angular/common/http';
import { environment } from '../../environments/environment';
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
import { RouterModule, Router, ActivatedRoute } from '@angular/router';
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
  selector: 'app-climate-dashboard-v2',
  standalone: true,
  imports: [CommonModule, FormsModule, HttpClientModule, StatBoxComponent, DataHighchartComponent, FooterComponent, MapPanelComponent, RouterModule],
  templateUrl: './climate-dashboard-v2.component.html',
  styleUrls: ['./climate-dashboard-v2.component.css']
})
export class ClimateDashboardV2Component implements OnDestroy {
  constructor(
    private http: HttpClient,
    private ngZone: NgZone,
    private emailSvc: EmailSubscriptionService,
    private router: Router,
    private route: ActivatedRoute,
  ) { }

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
    max?: number;
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
          [[-130, 5], [560, 305]],
          fcIsland
        );

        const islandZoomFactor: Record<string, number> = {
          'molokai': 0.75,
          'kahoolawe': 0.9,
        };
        const zoomFactor = islandZoomFactor[islandCanon];
        if (zoomFactor) {
          const f = zoomFactor;
          const vx = 215, vy = 155;
          const [tx, ty] = (projection as any).translate() as [number, number];
          (projection as any)
            .scale((projection as any).scale() * f)
            .translate([vx - (vx - tx) * f, vy + (ty - vy) * f]);
        }

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
          [[-130, 5], [560, 305]],
          fcIslandBase
        );

        const fcDivisions: FeatureCollection = {
          type: 'FeatureCollection',
          features: divisions.features.filter((f: any) => {
            const p = f.properties || {};
            const featureIsland = String(this.getProp(p, ['mokupuni', 'island', 'isle', 'Island', 'ISLAND']) || '');
            const canonF = canonIsland(featureIsland);

            let isMatch = canonF === islandCanon || canonF.includes(islandCanon);
            if (!isMatch) {
              const isMauiNui = ['kahoolawe', 'lanai', 'molokai', 'maui'].includes(islandCanon);
              if (scope === 'divisions') {
                const regionCanon = isMauiNui ? 'maui' : islandCanon;
                isMatch = canonF === regionCanon || canonF.includes(regionCanon);
              } else if (isMauiNui) {
                // Moku like Honuaʻula span multiple Maui Nui islands; include any Maui Nui feature
                isMatch = ['kahoolawe', 'lanai', 'molokai', 'maui'].includes(canonF);
              }
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
              ? this.getProp(p, ['name_hwn'])
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

        // Deduplicate by id — keep the first (largest-area) feature per name
        const seen = new Set<string>();
        const uniqueFeatures = features.filter(d => {
          if (seen.has(d.id)) return false;
          seen.add(d.id);
          return true;
        });

        const pathById: Record<string, string> = {};
        const centroidById: Record<string, [number, number]> = {};

        for (const d of uniqueFeatures) {
          pathById[d.id] = path(d.feature)!;
          centroidById[d.id] = path.centroid(d.feature) as [number, number];
        }

        this.islands.set(uniqueFeatures);
        this.pathById.set(pathById);
        this.centroidById.set(centroidById);
      });
    }

    // reload data
    this.loadStats();
    const d = this.dataset();
    if (d === 'Rainfall') this.loadRainfallData();
    else if (d === 'Temperature') this.loadTemperatureData();
    else if (d === 'Drought') this.loadDroughtDistribution();
  }


  tsData = signal<{ month: string; value?: number; [key: string]: any }[]>([]);

  email = signal<string>('');
  private emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  isEmailValid = computed(() => this.emailRegex.test(this.email().trim()));
  subscribeNotice = signal<{ type: 'success' | 'error'; message: string } | null>(null);
  private noticeTimer: any = null;
  private showNotice(type: 'success' | 'error', message: string) {
    clearTimeout(this.noticeTimer);
    this.subscribeNotice.set({ type, message });
    this.noticeTimer = setTimeout(() => this.subscribeNotice.set(null), 6000);
  }
  subscribe() {
    const email = this.email().trim();
    if (!this.isEmailValid()) return;

    // your existing "new_body" construction
    const newBody: any = { email };

    const islandSel = this.selectedIsland();
    const scope = this.selectedScope();
    const divisionKey = this.selectedDivision();

    if (islandSel) {
      const islandKey = this.slugifySelection(islandSel);
      newBody.island = [this.ISLAND_CANONICAL[islandKey] ?? islandSel, 'Statewide'];
    } else {
      newBody.island = ['Statewide'];
    }

    if (scope && divisionKey) {
      const name = this.extractScopedName(divisionKey);
      if (scope === 'moku') newBody.moku = [name];
      else if (scope === 'ahupuaa') newBody.ahupuaa = [name];
      else if (scope === 'watershed') newBody.watershed = [name];
      else if (scope === 'divisions') newBody.climate = [name];

      if (islandSel) {
        const islandKey = this.slugifySelection(islandSel);
        newBody.island = [this.ISLAND_CANONICAL[islandKey] ?? islandSel, 'Statewide'];
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
        this.showNotice('error', msg);
        return throwError(() => err);
      })
    ).subscribe(({ mode }) => {
      const label = this.selectedDivisionName() || this.islandLabel() || 'Statewide';
      const verb = mode === 'created' ? "You're subscribed!" : 'Subscription updated!';
      this.showNotice('success', `${verb} You'll receive monthly climate reports for ${label}.`);
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


  private rainfallStatsUrl = 'https://api.hcdp.ikewai.org/mesonet/climate_report/rainfall_stats';

  private apiHeaders(): HttpHeaders {
    return new HttpHeaders({ 'Authorization': `Bearer ${environment.apiToken}` });
  }


  private async loadStats(divisionArg?: string | null) {
    const dataset = this.selectedDataset();

    if (dataset === 'Rainfall') {
      await this.loadRainfallStats(divisionArg);
      return;
    }

    if (dataset === 'Temperature') {
      await this.loadTemperatureStats(divisionArg);
      return;
    }

    await this.loadDroughtStats(divisionArg);
  }

  private async loadDroughtStats(divisionArg?: string | null) {
    const island = this.selectedIsland();
    const division = divisionArg || this.selectedDivision();
    const scope = this.selectedScope();
    const date = `${this.selectedYear()}-${String(this.selectedMonth()).padStart(2, '0')}`;

    let divisionType: string, apiIsland: string, name: string;

    if (!island && !division) {
      divisionType = 'Statewide'; apiIsland = 'Statewide'; name = 'Statewide';
    } else if (island && !division) {
      divisionType = 'island';
      apiIsland = this.canonicalIslandName(island);
      name = this.canonicalIslandName(island);
    } else {
      divisionType =
        scope === 'ahupuaa' ? 'ahupuaa' :
        scope === 'moku' ? 'moku' :
        scope === 'watershed' ? 'watershed' :
        scope === 'divisions' ? 'climate_division' : 'island';
      const divStr = division ?? '';
      const parts = divStr.split('::');
      name = parts.length === 2 ? parts[1].trim() : divStr.trim();
      const divPrefix = parts.length === 2 ? parts[0].trim() : '';
      apiIsland = divPrefix ? (this.ISLAND_CANONICAL[divPrefix] ?? this.canonicalIslandName(island || '')) : (island ? this.canonicalIslandName(island) : '');
    }

    const params = new HttpParams()
      .set('division_type', divisionType)
      .set('island', apiIsland)
      .set('name', this.escapeName(name))
      .set('date', date);

    console.log('[loadDroughtStats] params:', { division_type: divisionType, island: apiIsland, name, date });

    try {
      const results = await firstValueFrom(
        this.http.get<any[]>(this.droughtStatsUrl, { params, headers: this.apiHeaders() })
      );
      console.log('[loadDroughtStats] API response:', results);
      const r = results?.[0] ?? null;
      this.stats.set(r ? {
        d0: +r.d0, d1: +r.d1, d2: +r.d2, d3: +r.d3, d4: +r.d4,
        w0: +r.w0, w1: +r.w1, w2: +r.w2, w3: +r.w3, w4: +r.w4,
        near_normal: +r.near_normal,
      } : null);
    } catch (err) {
      console.error('[loadDroughtStats] Failed:', err);
      this.stats.set(null);
    }
  }

  private async loadRainfallStats(divisionArg?: string | null) {
    const island = this.selectedIsland();
    const division = divisionArg || this.selectedDivision();
    const scope = this.selectedScope();
    const year = this.selectedYear();
    const month = this.selectedMonth();
    const date = `${year}-${String(month).padStart(2, '0')}`;

    let divisionType: string;
    let apiIsland: string;
    let name: string;

    if (!island && !division) {
      divisionType = 'Statewide';
      apiIsland = 'Statewide';
      name = 'Statewide';
    } else if (island && !division) {
      divisionType = 'island';
      apiIsland = this.canonicalIslandName(island);
      name = this.canonicalIslandName(island);
    } else {
      divisionType =
        scope === 'ahupuaa' ? 'ahupuaa' :
        scope === 'moku' ? 'moku' :
        scope === 'watershed' ? 'watershed' :
        scope === 'divisions' ? 'climate_division' : 'island';

      const divisionStr = division ?? '';
      const parts = divisionStr.split('::');
      name = parts.length === 2 ? parts[1].trim() : divisionStr.trim();
      const divPrefix = parts.length === 2 ? parts[0].trim() : '';
      apiIsland = divPrefix ? (this.ISLAND_CANONICAL[divPrefix] ?? this.canonicalIslandName(island || '')) : (island ? this.canonicalIslandName(island) : '');
    }

    const params = new HttpParams()
      .set('division_type', divisionType)
      .set('island', apiIsland)
      .set('name', this.escapeName(name))
      .set('date', date);

    console.log('[loadRainfallStats] params:', { division_type: divisionType, island: apiIsland, name, date });

    try {
      const results = await firstValueFrom(
        this.http.get<any[]>(this.rainfallStatsUrl, { params, headers: this.apiHeaders() })
      );
      console.log('[loadRainfallStats] API response:', results);
      const record = results?.[0] ?? null;
      this.stats.set(record ? {
        mean: +record.mean,
        anomaly: +record.anomaly,
        pchange: +record.pchange,
        rank: +record.rank,
        ytd_pnormal: +record.ytd_pnormal,
      } : null);
    } catch (err) {
      console.error('[loadRainfallStats] Failed:', err);
      this.stats.set(null);
    }
  }

  private temperatureStatsUrl = 'https://api.hcdp.ikewai.org/mesonet/climate_report/temperature_stats';

  private async loadTemperatureStats(divisionArg?: string | null) {
    const island = this.selectedIsland();
    const division = divisionArg || this.selectedDivision();
    const scope = this.selectedScope();
    const date = `${this.selectedYear()}-${String(this.selectedMonth()).padStart(2, '0')}`;

    let divisionType: string, apiIsland: string, name: string;

    if (!island && !division) {
      divisionType = 'Statewide'; apiIsland = 'Statewide'; name = 'Statewide';
    } else if (island && !division) {
      divisionType = 'island';
      apiIsland = this.canonicalIslandName(island);
      name = this.canonicalIslandName(island);
    } else {
      divisionType =
        scope === 'ahupuaa' ? 'ahupuaa' :
        scope === 'moku' ? 'moku' :
        scope === 'watershed' ? 'watershed' :
        scope === 'divisions' ? 'climate_division' : 'island';
      const divStr = division ?? '';
      const parts = divStr.split('::');
      name = parts.length === 2 ? parts[1].trim() : divStr.trim();
      const divPrefix = parts.length === 2 ? parts[0].trim() : '';
      apiIsland = divPrefix ? (this.ISLAND_CANONICAL[divPrefix] ?? this.canonicalIslandName(island || '')) : (island ? this.canonicalIslandName(island) : '');
    }

    const params = new HttpParams()
      .set('division_type', divisionType)
      .set('island', apiIsland)
      .set('name', this.escapeName(name))
      .set('date', date);

    console.log('[loadTemperatureStats] params:', { division_type: divisionType, island: apiIsland, name, date });

    try {
      const results = await firstValueFrom(
        this.http.get<any[]>(this.temperatureStatsUrl, { params, headers: this.apiHeaders() })
      );
      console.log('[loadTemperatureStats] API response:', results);
      const record = results?.[0] ?? null;
      this.stats.set(record ? {
        mean: +record.mean,
        anomaly: +record.anomaly,
        pchange: +record.pchange,
        rank: +record.rank,
        max: +record.max,
      } : null);
    } catch (err) {
      console.error('[loadTemperatureStats] Failed:', err);
      this.stats.set(null);
    }
  }


  private async loadRasterOnce(dataset: Dataset) {
    try {
      const year = this.selectedYear();
      const mm = String(this.selectedMonth()).padStart(2, '0');
      const tifBase = 'https://api.hcdp.ikewai.org/files/download/climate_report_data/climate_summary_tifs';
      let file = '';
      if (dataset === 'Rainfall') file = `${tifBase}/rainfall/rainfall_pdiff_cat_${year}_${mm}.tif`;
      else if (dataset === 'Temperature') file = `${tifBase}/temperature/temperature_diff_cat_${year}_${mm}.tif`;
      else if (dataset === 'Drought') file = `${tifBase}/spi3/spi3_cat_${year}_${mm}.tif`;

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
    const year = this.selectedYear();
    const mm = String(this.selectedMonth()).padStart(2, '0');
    const file = `https://api.hcdp.ikewai.org/files/download/climate_report_data/climate_summary_tifs/rainfall/legend/rainfall_legend_${year}_${mm}.json`;
    const config = await firstValueFrom(this.http.get<any>(file));
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

  selectedMonth = signal<number>(new Date().getMonth() === 0 ? 12 : new Date().getMonth());
  selectedYear = signal<number>(new Date().getMonth() === 0 ? new Date().getFullYear() - 1 : new Date().getFullYear());

  private latestMonth(): { month: number; year: number } {
    const now = new Date();
    return now.getMonth() === 0
      ? { month: 12, year: now.getFullYear() - 1 }
      : { month: now.getMonth(), year: now.getFullYear() };
  }

  private clampToLatest(month: number, year: number): { month: number; year: number } {
    const latest = this.latestMonth();
    if (year > latest.year || (year === latest.year && month >= latest.month + 1)) {
      return latest;
    }
    return { month, year };
  }

  goToLatest() {
    const { month, year } = this.latestMonth();
    this.selectedYear.set(year);
    this.applyDate(month, year);
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {},
      replaceUrl: true,
    });
  }

  stepMonth(delta: number) {
    let month = this.selectedMonth() + delta;
    let year = this.selectedYear();
    if (month < 1) { month = 12; year--; }
    else if (month > 12) { month = 1; year++; }
    const clamped = this.clampToLatest(month, year);
    this.selectedYear.set(clamped.year);
    this.applyDate(clamped.month, clamped.year);
  }

  setMonth(month: number) {
    const clamped = this.clampToLatest(month, this.selectedYear());
    this.selectedMonth.set(clamped.month);
    this.selectedYear.set(clamped.year);
    this.applyDate(clamped.month, clamped.year);
  }

  setYear(year: number) {
    const clamped = this.clampToLatest(this.selectedMonth(), year);
    this.selectedMonth.set(clamped.month);
    this.selectedYear.set(clamped.year);
    this.applyDate(clamped.month, clamped.year);
  }

  private updateUrlParams(month: number, year: number) {
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { year, month },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  private applyDate(month: number, year: number) {
    this.selectedMonth.set(month);
    this.selectedYear.set(year);
    this.updateUrlParams(month, year);
    this.loadStats();
    this.loadRasterOnce(this.dataset());
    if (this.dataset() === 'Rainfall') {
      this.loadRainfallData();
      this.loadRainfallDataConfig();
    } else if (this.dataset() === 'Temperature') {
      this.loadTemperatureData();
    } else if (this.dataset() === 'Drought') {
      this.loadDroughtDistribution();
    }
  }

  readonly monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  readonly availableYears = Array.from({ length: new Date().getFullYear() - 1990 + 1 }, (_, i) => new Date().getFullYear() - i);

  selectedDateLabel = computed(() =>
    `${this.monthNames[this.selectedMonth() - 1]} ${this.selectedYear()}`
  );

  async ngOnInit(): Promise<void> {
    // Apply month/year from URL query params before any loads
    const qp = this.route.snapshot.queryParamMap;
    const qYear = qp.get('year');
    const qMonth = qp.get('month');
    if (qYear && qMonth) {
      const clamped = this.clampToLatest(+qMonth, +qYear);
      this.selectedMonth.set(clamped.month);
      this.selectedYear.set(clamped.year);
    }

    // Base islands
    this.http.get<any>('hawaii_islands_simplified.geojson').subscribe(fc => {
      const projection = geoIdentity().reflectY(true).fitExtent(
        [[-130, 5], [560, 305]],
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
      near_normal: Math.round(Number(data.near_normal) || 0),
      totalBase: totalDry
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
      near_normal: Math.round(Number(data.near_normal) || 0),
      totalBase: totalWet
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
  timeRange = signal<number>(12);
  aprilMode = signal<boolean>(false);

  setTimeRange(months: number) {
    this.aprilMode.set(false);
    this.timeRange.set(months);
  }

  toggleAprilMode() {
    this.aprilMode.set(!this.aprilMode());
  }

  filteredTsData = computed(() => {
    const data = this.tsData();
    if (!data || data.length === 0) return [];

    if (this.aprilMode()) {
      const monthSuffix = `-${String(this.selectedMonth()).padStart(2, '0')}`;
      return data
        .filter(d => d.month?.endsWith(monthSuffix))
        .slice(-10);
    }

    return data.slice(-this.timeRange());
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
    return rank <= (totalYears / 2) ? 'high' : 'low';
  }

  // Returns rank counted from the sentiment's end so "107th of 107" becomes "1st Driest" not "107th Driest"
  getDirectionalRank(rank: number | undefined, totalYears: number): number | undefined {
    if (rank == null) return undefined;
    return this.getRankSentiment(rank, totalYears) === 'high' ? rank : totalYears - rank + 1;
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

  private rainfallHistoricalUrl = 'https://api.hcdp.ikewai.org/mesonet/climate_report/rainfall_historical';

  private buildRainfallQueryArgs(extraDates: Record<string, string>): Record<string, string> {
    const island = this.selectedIsland();
    const division = this.selectedDivision();
    const scope = this.selectedScope();

    let division_type: string, apiIsland: string, name: string;

    if (!island && !division) {
      division_type = 'Statewide'; apiIsland = 'Statewide'; name = 'Statewide';
    } else if (island && !division) {
      division_type = 'island';
      apiIsland = this.canonicalIslandName(island);
      name = this.canonicalIslandName(island);
    } else {
      division_type =
        scope === 'ahupuaa' ? 'ahupuaa' :
        scope === 'moku' ? 'moku' :
        scope === 'watershed' ? 'watershed' :
        scope === 'divisions' ? 'climate_division' : 'island';
      const divStr = division ?? '';
      const parts = divStr.split('::');
      name = parts.length === 2 ? parts[1].trim() : divStr.trim();
      const divPrefix = parts.length === 2 ? parts[0].trim() : '';
      apiIsland = divPrefix ? (this.ISLAND_CANONICAL[divPrefix] ?? this.canonicalIslandName(island || '')) : (island ? this.canonicalIslandName(island) : '');
    }

    return { division_type, island: apiIsland, name: this.escapeName(name), ...extraDates };
  }

  private rainfallApiParams(startDate: string, endDate: string): HttpParams {
    const args = this.buildRainfallQueryArgs({ startDate, endDate });
    return Object.entries(args).reduce((p, [k, v]) => p.set(k, v), new HttpParams());
  }

  private nextMonthDate(year: number, month: number): string {
    const m = month === 12 ? 1 : month + 1;
    const y = month === 12 ? year + 1 : year;
    return `${y}-${String(m).padStart(2, '0')}`;
  }

  private loadRainfallData() {
    const endYear = this.selectedYear();
    const endMonth = this.selectedMonth();
    const endDate = this.nextMonthDate(endYear, endMonth);

    // fetch 120 months back so Aprils (10 yr) mode has enough data
    const totalMonths0 = endYear * 12 + (endMonth - 1) - 119;
    const startYear = Math.floor(totalMonths0 / 12);
    const startMonth = (totalMonths0 % 12) + 1;
    const startDate = `${startYear}-${String(startMonth).padStart(2, '0')}`;

    const args = this.buildRainfallQueryArgs({ startDate, endDate });
    const params = Object.entries(args).reduce((p, [k, v]) => p.set(k, v), new HttpParams());
    console.log('[loadRainfallData] params:', args);

    this.http.get<any[]>(this.rainfallHistoricalUrl, { params, headers: this.apiHeaders() })
      .subscribe({
        next: (results) => {
          console.log('[loadRainfallData] API response:', results);
          const cutoff = `${endYear}-${String(endMonth).padStart(2, '0')}`;
          const mapped = (results ?? [])
            .map(r => ({ month: (r.date as string).slice(0, 7), value: +r.value }))
            .filter(r => r.month <= cutoff);
          this.tsData.set(mapped);
        },
        error: (err) => {
          console.error('[loadRainfallData] Failed:', err);
          this.tsData.set([]);
        }
      });
  }

  private temperatureHistoricalUrl = 'https://api.hcdp.ikewai.org/mesonet/climate_report/temperature_historical';

  private loadTemperatureData() {
    const endYear = this.selectedYear();
    const endMonth = this.selectedMonth();
    const endDate = this.nextMonthDate(endYear, endMonth);

    const totalMonths0 = endYear * 12 + (endMonth - 1) - 119;
    const startYear = Math.floor(totalMonths0 / 12);
    const startMonth = (totalMonths0 % 12) + 1;
    const startDate = `${startYear}-${String(startMonth).padStart(2, '0')}`;

    const args = this.buildRainfallQueryArgs({ startDate, endDate });
    const params = Object.entries(args).reduce((p, [k, v]) => p.set(k, v), new HttpParams());
    console.log('[loadTemperatureData] params:', args);

    this.http.get<any[]>(this.temperatureHistoricalUrl, { params, headers: this.apiHeaders() })
      .subscribe({
        next: (results) => {
          console.log('[loadTemperatureData] API response:', results);
          const cutoff = `${endYear}-${String(endMonth).padStart(2, '0')}`;
          const mapped = (results ?? [])
            .map(r => ({ month: (r.date as string).slice(0, 7), value: +r.value }))
            .filter(r => r.month <= cutoff);
          this.tsData.set(mapped);
        },
        error: (err) => {
          console.error('[loadTemperatureData] Failed:', err);
          this.tsData.set([]);
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
  private droughtStatsUrl = 'https://api.hcdp.ikewai.org/mesonet/climate_report/drought_stats';

  private async loadDroughtDistribution() {
    const endYear = this.selectedYear();
    const endMonth = this.selectedMonth();
    const endDate = this.nextMonthDate(endYear, endMonth);

    const totalMonths0 = endYear * 12 + (endMonth - 1) - 59;
    const startYear = Math.floor(totalMonths0 / 12);
    const startMonth = (totalMonths0 % 12) + 1;
    const startDate = `${startYear}-${String(startMonth).padStart(2, '0')}`;

    const args = this.buildRainfallQueryArgs({ startDate, endDate });
    const params = Object.entries(args).reduce((p, [k, v]) => p.set(k, v), new HttpParams());
    console.log('[loadDroughtDistribution] params:', args);

    try {
      const results = await firstValueFrom(
        this.http.get<any[]>(this.droughtStatsUrl, { params, headers: this.apiHeaders() })
      );
      console.log('[loadDroughtDistribution] API response:', results);

      const cutoff = `${endYear}-${String(endMonth).padStart(2, '0')}`;
      const mapped = (results ?? [])
        .map(r => ({
          month: (r.date as string).slice(0, 7),
          'D0 Abnormally Dry':      parseFloat(r.d0 || '0'),
          'D1 Moderate Drought':    parseFloat(r.d1 || '0'),
          'D2 Severe Drought':      parseFloat(r.d2 || '0'),
          'D3 Extreme Drought':     parseFloat(r.d3 || '0'),
          'D4 Exceptional Drought': parseFloat(r.d4 || '0'),
          'W0 Abnormally Wet':      parseFloat(r.w0 || '0'),
          'W1 Moderately Wet':      parseFloat(r.w1 || '0'),
          'W2 Severely Wet':        parseFloat(r.w2 || '0'),
          'W3 Extremely Wet':       parseFloat(r.w3 || '0'),
          'W4 Exceptionally Wet':   parseFloat(r.w4 || '0'),
        }))
        .filter(r => r.month <= cutoff);

      this.tsData.set(mapped);
    } catch (err) {
      console.error('[loadDroughtDistribution] Failed:', err);
      this.tsData.set([]);
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

    const dataset = this.selectedDataset();
    if (dataset === 'Rainfall') this.loadRainfallData();
    else if (dataset === 'Temperature') this.loadTemperatureData();
    else if (dataset === 'Drought') this.loadDroughtDistribution();

  }

  reset() {
    this.selectedScope.set(null);
    this.selectedIsland.set(null);
    this.selectedDivision.set(null);
    this.viewMode.set('islands');

    this.loadStats();

    const dataset = this.selectedDataset();
    if (dataset === 'Drought') {
      this.loadDroughtDistribution();
    } else if (dataset === 'Rainfall') {
      this.loadRainfallData();
    } else if (dataset === 'Temperature') {
      this.loadTemperatureData();
    }

    // reload map outlines
    this.http.get<any>('hawaii_islands_simplified.geojson').subscribe(fc => {
      const projection = geoIdentity().reflectY(true).fitExtent([[-130, 5], [560, 305]], fc);
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



  rainfallInfoBox = computed(() => {
    const s = this.stats();
    const location = this.selectedDivisionName() || this.islandLabel() || 'Statewide';
    const month = this.monthNames[this.selectedMonth() - 1];
    const years = this.rainfallYears();

    if (!s || s.mean == null) return `${location} rainfall data is not yet available for this period.`;

    const mean = s.mean?.toFixed(1) ?? '—';
    const anomaly = s.anomaly ?? 0;
    const pchange = s.pchange ?? 0;
    const rank = s.rank;

    const direction = anomaly >= 0 ? 'above' : 'below';
    const absPchange = Math.abs(Math.round(pchange));
    const absAnomaly = Math.abs(anomaly).toFixed(1);

    let rankStr = '';
    if (rank != null && years > 0) {
      const sentiment = this.getRankSentiment(rank, years) === 'high' ? 'wettest' : 'driest';
      const suffix = this.formatRankSuffix(rank);
      rankStr = `, ranking as the ${rank}${suffix} ${sentiment} ${month} in the last ${years} years`;
    }

    return `${location} received ${mean} inches of rainfall — ${absAnomaly} inches (${absPchange}%) ${direction} the ${month} average${rankStr}.`;
  });

  temperatureInfoBox = computed(() => {
    const s = this.stats();
    const location = this.selectedDivisionName() || this.islandLabel() || 'Statewide';
    const month = this.monthNames[this.selectedMonth() - 1];
    const years = this.temperatureYears();

    if (!s || s.mean == null) return `${location} temperature data is not yet available for this period.`;

    const mean = s.mean?.toFixed(1) ?? '—';
    const anomaly = s.anomaly ?? 0;
    const rank = s.rank;

    const direction = anomaly >= 0 ? 'above' : 'below';
    const absAnomaly = Math.abs(anomaly).toFixed(1);

    let rankStr = '';
    if (rank != null && years > 0) {
      const sentiment = this.getRankSentiment(rank, years) === 'high' ? 'warmest' : 'coolest';
      const suffix = this.formatRankSuffix(rank);
      rankStr = `, ranking as the ${rank}${suffix} ${sentiment} ${month} in the last ${years} years`;
    }

    return `${location} averaged ${mean}°F — ${absAnomaly}°F ${direction} the ${month} average${rankStr}.`;
  });

  droughtInfoBox = computed(() => {
    const location = this.selectedDivisionName() || this.islandLabel() || 'Statewide';
    const condition = this.dominantCondition();

    if (condition === 'wet') {
      const w = this.currentWetStats();
      if (!w) return `${location} drought/wetness data is not yet available for this period.`;
      return `${location} experienced wet conditions with ${w.w0}% of land area seeing at least abnormally wet conditions, and ${w.w3}% seeing extreme wetness or worse.`;
    }

    const d = this.currentDroughtStats();
    if (!d) return `${location} drought data is not yet available for this period.`;

    if (d.totalBase === 0) {
      return `${location} experienced near-normal conditions with no drought recorded this month.`;
    }

    return `${location} experienced dry conditions with ${d.d0}% of land area seeing at least abnormally dry conditions, and ${d.d3}% seeing extreme drought or worse.`;
  });

  private formatRankSuffix(rank: number): string {
    const j = rank % 10;
    const k = rank % 100;
    if (j === 1 && k !== 11) return 'st';
    if (j === 2 && k !== 12) return 'nd';
    if (j === 3 && k !== 13) return 'rd';
    return 'th';
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
    hawaii:     'Hawaiʻi',
    oahu:       'Oʻahu',
    kauai:      'Kauaʻi',
    lanai:      'Lānaʻi',
    molokai:    'Molokaʻi',
    kahoolawe:  'Kahoʻolawe',
    maui:       'Maui',
    niihau:     'Niʻihau',
  };

  private canonicalIslandName(island: string): string {
    const key = this.normalizeKey(island);
    return this.ISLAND_CANONICAL[key] ?? island;
  }

  private escapeName(name: string): string {
    return name.replace(/,/g, '\\,');
  }

  private extractScopedName(key: string): string {
    const parts = key.split('::');
    if (parts.length === 2) {
      const islandKey = this.slugifySelection(parts[0]);
      const islandName = this.ISLAND_CANONICAL[islandKey] ?? parts[0].trim();
      return `${islandName}::${parts[1].trim()}`;
    }
    return key.trim();
  }

  private readonly LIST_FIELDS: Array<'island'|'moku'|'ahupuaa'|'watershed'|'division'|'climate'> =
    ['island', 'moku', 'ahupuaa', 'watershed', 'division', 'climate'];

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


  // ===== Rank history modal =====
  rankTableVisible = signal(false);
  rankTableLoading = signal(false);
  rankTableTitle = signal('');
  rankTableSentiment = signal<'high' | 'low'>('high');
  rankTableRows = signal<{ year: number; value: number; anomaly: number; pchange: number; rank: number }[]>([]);

  openRankTable() {
    const dataset = this.selectedDataset();
    if (dataset === 'Drought') return;

    const month = this.selectedMonth();
    const year = this.selectedYear();
    const location = this.selectedDivisionName() || this.islandLabel() || 'Statewide';
    this.rankTableTitle.set(`${this.monthNames[month - 1]} ${dataset} Rankings — ${location}`);
    this.rankTableVisible.set(true);
    this.rankTableLoading.set(true);
    this.rankTableRows.set([]);

    const totalYears = dataset === 'Rainfall' ? this.rainfallYears() : this.temperatureYears();
    const currentRank = this.stats()?.rank;
    const sentiment = this.getRankSentiment(currentRank, totalYears);
    this.rankTableSentiment.set(sentiment);

    const startDate = dataset === 'Rainfall' ? '1920-01' : '1990-01';
    const { month: latestM, year: latestY } = this.latestMonth();
    const endDate = `${latestY}-${String(latestM).padStart(2, '0')}`;
    const statsUrl = dataset === 'Rainfall' ? this.rainfallStatsUrl : this.temperatureStatsUrl;
    const args = this.buildRainfallQueryArgs({ startDate, endDate });
    const params = Object.entries(args).reduce((p, [k, v]) => p.set(k, v), new HttpParams());

    this.http.get<any[]>(statsUrl, { params, headers: this.apiHeaders() }).subscribe({
      next: (results) => {
        const rows = (results ?? [])
          .filter(r => parseInt((r.date as string).slice(5, 7), 10) === month)
          .map(r => ({
            year: parseInt((r.date as string).slice(0, 4), 10),
            value: +r.mean,
            anomaly: +r.anomaly,
            pchange: +r.pchange,
            rank: +r.rank
          }))
          .filter(r => !isNaN(r.rank))
          .sort((a, b) => sentiment === 'low' ? b.rank - a.rank : a.rank - b.rank);
        this.rankTableRows.set(rows);
        this.rankTableLoading.set(false);
        setTimeout(() => {
          document.querySelector('.rank-current')?.scrollIntoView({ block: 'center', behavior: 'instant' });
        });
      },
      error: () => this.rankTableLoading.set(false)
    });
  }

  closeRankTable() {
    this.rankTableVisible.set(false);
  }

  goToYear(year: number) {
    this.closeRankTable();
    this.applyDate(this.selectedMonth(), year);
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

import { Component, OnInit } from '@angular/core';
import { NgFor, NgIf } from '@angular/common';
import { HttpClient, HttpClientModule } from '@angular/common/http';

import * as Highcharts from 'highcharts';
import { HighchartsChartModule } from 'highcharts-angular';

type rainfallMode = 'total' | 'pdiff' ;
type temperatureMode = 'total' | 'anom';
type monthMode = 'monthly' | 'anomaly';
type LegendItem = { color: string; label: string };

type IslandKey = 'kauai'|'oahu'|'molokai'|'lanai'|'maui'|'kahoolawe'|'hawaii';


@Component({
  selector: 'app-climate-summary-2025',
  standalone: true,
  imports: [NgFor, NgIf, HttpClientModule, HighchartsChartModule],
  templateUrl: './climate-summary-2025.component.html',
  styleUrls: ['./climate-summary-2025.component.css'],
})
export class ClimateSummary2025Component implements OnInit {
  constructor(private http: HttpClient) {}

  readonly tabs: { key: rainfallMode; label: string }[] = [
    { key: 'total', label: 'Total rainfall' },
    { key: 'pdiff', label: 'Percent Difference' }
  ];

  //Defaults
  rainfallMode: rainfallMode = 'pdiff';
  temperatureMode: temperatureMode = 'anom';
  monthMode: monthMode = 'monthly';

  readonly rainfallModeLabel: Record<rainfallMode, string> = {
    total: 'Total',
    pdiff: 'Percent difference',
  };

  readonly temperatureModeLabel: Record<temperatureMode, string> = {
    total: 'Total',
    anom: 'Anomaly',
  };

  readonly monthModeLabel: Record<monthMode, string> = {
    monthly: 'Monthly Values',
    anomaly: 'Monthly Anomaly',
  };

  readonly rainfallSrc: Record<rainfallMode, string> = {
    total: 'climate-summary/annual_rainfall_2025_agg.png',
    pdiff: 'climate-summary/annual_rainfall_2025_pdiff.png'
  };

  readonly droughtSrc = 'climate-summary/spi12.png';

  readonly droughtLegendTitle = 'Drought (SPI-12)';
  readonly droughtLegendTicks = ['3.0', '0', '-3.0'];
  readonly droughtLegendUnit = '';
  readonly droughtLegendGradient =
  'linear-gradient(180deg, #2166ac 0%, #f7f7f7 50%,  #b2182b 100%)';

  readonly rainfallLegendTitle: Record<rainfallMode, string> = {
    total: 'Total rainfall (in)',
    pdiff: 'Percent difference (%)'
  };

  readonly rainfallLegendTicks: Record<rainfallMode, string[]> = {
    total: ['300', '0'],
    pdiff: ['-100', '0', '100']
  };

  

  readonly temperatureLegendItems: Record<temperatureMode, LegendItem[] | null> = {
    total: null,
    anom: [
      { color: '#730000', label: '> 2.25°F' },
      { color: '#FF0000', label: '1.75 to 2.25°F' },
      { color: '#FF4d00', label: '1.25 to 1.75°F' },
      { color: '#FF9900', label: '0.75 to 1.25°F' },
      { color: '#ffe1c2', label: '0.25 to 0.75°F' },
      { color: '#FFFFFF', label: '-0.25 to 0.25°F' },
      { color: '#cfe8ff', label: '-0.75 to -0.25°F' },
      { color: '#66a3ff', label: '-1.25 to -0.75°F' },
      { color: '#0066CC', label: '-1.75 to -1.25°F' },
      { color: '#003d80', label: '-2.25 to -1.75°F' },
      { color: '#001933', label: '< -2.25°F' },
    ],
  };

  readonly rainfallLegendItems: Record<rainfallMode, LegendItem[] | null> = {
    total: null,
    pdiff: [
      { color: '#001a4d', label: '> 70%' },
      { color: '#2f7dff', label: '70 to 50%' },
      { color: '#7fc3ff', label: '50 to 30%' },
      { color: '#cfefff', label: '30 to 10%' },
      { color: '#ffffff', label: '10 to -10%' },
      { color: '#ff5a1f', label: '-10 to -30%' },
      { color: '#c00000', label: '-30 to -50%' },
      { color: '#7f0000', label: '-50 to -70%' },
      { color: '#4b0000', label: '< -70%' },
    ],
  };



   readonly temperatureLegendTitle: Record<temperatureMode, string> = {
    total: 'Average temperature (°F)',
    anom: 'Anomaly (°F)',
  };

  readonly temperatureLegendTicks: Record<temperatureMode, string[]> = {
    total: ['90', '40'],
    anom: ['-2.25', '0', '2.25'],
  };

  readonly rainfallLegendUnit: Record<rainfallMode, string> = {
    total: 'in',
    pdiff: '%'
  };

  readonly temperatureLegendUnit: Record<temperatureMode, string> = {
    total: '°F',
    anom: '°F',
  };

  readonly rainfallLegendGradient: Record<rainfallMode, string> = {
    total:
      'linear-gradient(180deg, #fde725 0%, #5ec962 25%, #21918c 50%, #3b528b 75%, #440154 100%)',
    pdiff:
      'linear-gradient(180deg, #b2182b 0%, #f7f7f7 50%, #2166ac 100%)',
  };

  readonly temperatureLegendGradient: Record<temperatureMode, string> = {
    total:
      'linear-gradient(180deg, #b2182b 0%, #f7f7f7 50%, #2166ac 100%)',
    anom: 'linear-gradient(180deg, #2166ac 0%, #f7f7f7 50%, #b2182b 100%)',
  };

  readonly temperatureSrc: Partial<Record<temperatureMode, string>> = {
    total: 'climate-summary/annual_tmean_2025_agg.png',
    anom: 'climate-summary/annual_tmean_2025_anomaly.png',
  };

  setRainfallMode(mode: rainfallMode) {
    this.rainfallMode = mode;
  }
  setTemperatureMode(mode: temperatureMode) {
    this.temperatureMode = mode;
  }
  setMonthMode(mode: monthMode) {
    this.monthMode = mode;
  }

   mapW = 0;
  mapH = 0;


  Highcharts: typeof Highcharts = Highcharts;

  monthlyChartOptions: Highcharts.Options = {
    title: { text: '' },
    chart: {
      marginTop: 50,
    },
    credits: { enabled: false },
    xAxis: { categories: [] },
    yAxis: [
      { title: { text: 'Rainfall (in)' } },
      { title: { text: 'Temperature (°F)' }, opposite: true },
    ],
    tooltip: { shared: true,valueDecimals: 2,  },
    legend: { enabled: true },
    series: [
      { type: 'column', name: 'Rainfall', data: [], yAxis: 0 },
      { type: 'spline', name: 'Temperature', data: [], yAxis: 1 },
    ],
  };

  anomalyChartOptions: Highcharts.Options = {
    title: { text: '' },
    chart: { marginTop: 50 },
    credits: { enabled: false },
    xAxis: { categories: [] },
    yAxis: [
      {
        title: { text: 'Rainfall anomaly (in)' },
        min: -4,
        max: 4,
        plotLines: [{ value: 0, width: 1 }],
      },
      {
        title: { text: 'Temperature anomaly (°F)' },
        opposite: true,
        min: -1.5,
        max: 1.5,
        plotLines: [{ value: 0, width: 1 }],
      },
    ],
    tooltip: { shared: true, valueDecimals: 2 },
    legend: { enabled: true },
    series: [
      { type: 'column', name: 'Rainfall anomaly', data: [], yAxis: 0 },
      { type: 'spline', name: 'Temperature anomaly', data: [], yAxis: 1 },
    ],
  };



  ngOnInit(): void {
    // Monthly Values
    this.http
      .get('climate-summary/monthly_summary.csv', { responseType: 'text' })
      .subscribe({
        next: (csv) => {
          const parsed = this.parseMonthlyCsv(csv);

          const categories = parsed.map((r) => r.monthName);
          const rf = parsed.map((r) => r.rf_mean);
          const tmean = parsed.map((r) => r.tmean);

          this.monthlyChartOptions = {
            ...this.monthlyChartOptions,
            xAxis: {
              ...(this.monthlyChartOptions.xAxis as Highcharts.XAxisOptions),
              categories,
            },
            series: [
              { type: 'column', name: 'Rainfall', data: rf, yAxis: 0 },
              { type: 'spline', name: 'Temperature', data: tmean, yAxis: 1 },
            ],
          };

          // quick sanity check
          console.log('monthly_summary.csv rows:', parsed.length, { categories, rf, tmean });
        },
        error: (err) => console.error('Failed to load monthly_summary.csv', err),
      });

    // Monthly Anomaly
    this.http
    .get('climate-summary/monthly_anomaly_summary.csv', { responseType: 'text' })
    .subscribe({
      next: (csv) => {
        const parsed = this.parseMonthlyAnomalyCsv(csv);

        const categories = parsed.map((r) => r.monthName);
        const rfAnom = parsed.map((r) => r.rf_anomaly);
        const tAnom = parsed.map((r) => r.t_anomaly);

        this.anomalyChartOptions = {
          ...this.anomalyChartOptions,
          xAxis: {
            ...(this.anomalyChartOptions.xAxis as Highcharts.XAxisOptions),
            categories,
          },
          series: [
            { type: 'column', name: 'Rainfall anomaly', data: rfAnom, yAxis: 0 },
            { type: 'spline', name: 'Temperature anomaly', data: tAnom, yAxis: 1 },
          ],
        };
        },
    error: (err) => console.error('Failed to load monthly_anomaly_summary.csv', err),
    });

    this.http.get('hawaii_islands_overlay.svg', { responseType: 'text' }).subscribe({
      next: (svgText) => {
        const parsed = this.parseIslandSvg(svgText);
        this.islandPaths = parsed.paths;
        this.mapW = parsed.w;
        this.mapH = parsed.h;
        console.log('overlay viewBox:', this.mapW, this.mapH, 'paths:', this.islandPaths.length);
      },
      error: (err) => console.error('Failed to load hawaii_islands_overlay.svg', err),
    });


  }


  private parseMonthlyCsv(csv: string): Array<{ monthName: string; rf_mean: number; tmean: number }> {
    const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

    const lines = csv
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);

    const rows = lines.slice(1);

    return rows
      .map((line) => line.split(',').map((s) => s.trim()))
      .filter((parts) => parts.length >= 3)
      .map((parts) => {
        const m = Number(parts[0]);
        return {
          monthName: monthNames[Math.max(1, Math.min(12, m)) - 1] ?? String(m),
          rf_mean: Number(parts[1]),
          tmean: Number(parts[2]),
        };
      })
      .filter((r) => Number.isFinite(r.rf_mean) && Number.isFinite(r.tmean));
  }

  private parseMonthlyAnomalyCsv(
    csv: string
  ): Array<{ monthName: string; rf_anomaly: number; t_anomaly: number }> {
    const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

    const lines = csv
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);

    const rows = lines.slice(1);

    return rows
      .map((line) => line.split(',').map((s) => s.trim()))
      .filter((parts) => parts.length >= 3)
      .map((parts) => {
        const m = Number(parts[0]);
        return {
          monthName: monthNames[Math.max(1, Math.min(12, m)) - 1] ?? String(m),
          rf_anomaly: Number(parts[1]),
          t_anomaly: Number(parts[2]),
        };
      })
      .filter((r) => Number.isFinite(r.rf_anomaly) && Number.isFinite(r.t_anomaly));
  }

  islandPaths: Array<{ id: IslandKey; label: string; d: string }> = [];

  private readonly islandLabel: Record<IslandKey, string> = {
    kauai: 'Kauaʻi',
    oahu: 'Oʻahu',
    molokai: 'Molokaʻi',
    lanai: 'Lānaʻi',
    maui: 'Maui',
    kahoolawe: 'Kahoʻolawe',
    hawaii: 'Hawaiʻi Island',
  };

  private parseIslandSvg(svgText: string): { w: number; h: number; paths: Array<{ id: IslandKey; label: string; d: string }> } {
    const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');

    const svg = doc.querySelector('svg');
    const vb = (svg?.getAttribute('viewBox') || '').trim(); // "0 0 W H"
    const parts = vb.split(/\s+/).map(Number);

    const w = parts.length === 4 ? parts[2] : 0;
    const h = parts.length === 4 ? parts[3] : 0;

    const out: Array<{ id: IslandKey; label: string; d: string }> = [];

    for (const p of Array.from(doc.querySelectorAll('path'))) {
      const raw = (p.getAttribute('data-island') || '').trim().toLowerCase();

      // normalize Kauaʻi -> kauai, Hawaiʻi -> hawaii, etc.
      const id = raw
        .replace(/[ʻ’']/g, '')
        .replace(/[^a-z]/g, '') as IslandKey;

      const d = p.getAttribute('d') || '';
      if (!d) continue;
      if (!Object.prototype.hasOwnProperty.call(this.islandLabel, id)) continue;

      out.push({ id, label: this.islandLabel[id], d });
    }

    return { w, h, paths: out };
  }


  hoverIsland: IslandKey | null = null;

  setHoverIsland(k: IslandKey) {
    this.hoverIsland = k;
  }

  clearHoverIsland() {
    this.hoverIsland = null;
  }

  get hoverIslandLabel(): string | null {
    return this.hoverIsland ? this.islandLabel[this.hoverIsland] : null;
  }
 

  private readonly rainfallHighlightsByIsland: Record<IslandKey, string> = {
    kauai: 'Kauaʻi highlight...',
    oahu: 'Oʻahu highlight...',
    molokai: 'Molokaʻi highlight...',
    lanai: 'Lānaʻi highlight...',
    maui: 'Maui highlight...',
    kahoolawe: 'Kahoʻolawe highlight...',
    hawaii: 'Hawaiʻi Island highlight...',
  };

  get rainfallHighlightsText(): string {
    if (!this.hoverIsland) return 'Hover an island to see rainfall highlights.';
    return this.rainfallHighlightsByIsland[this.hoverIsland] ?? 'No highlight yet.';
  }

}

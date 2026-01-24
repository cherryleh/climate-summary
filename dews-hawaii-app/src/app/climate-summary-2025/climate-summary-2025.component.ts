import { Component, OnInit } from '@angular/core';
import { NgFor, NgIf } from '@angular/common';
import { HttpClient, HttpClientModule } from '@angular/common/http';

import * as Highcharts from 'highcharts';
import { HighchartsChartModule } from 'highcharts-angular';
import { FormsModule } from '@angular/forms';

type rainfallMode = 'total' | 'pdiff' ;
type temperatureMode = 'total' | 'anom';
type monthMode = 'monthly' | 'anomaly' | 'drought';
type LegendItem = { color: string; label: string };

type IslandKey = 'kauai'|'oahu'|'molokai'|'lanai'|'maui'|'kahoolawe'|'hawaii';

type RainHighlight = {
  pdiff: number;     
  rankText: string;
};

type DroughtHighlight = {
  percentDry: number;
  percentModerateDrought: number;
};

type TemperatureHighlight = {
  anom: number;
  rankText: string;
};

const DROUGHT_ORDER = [
  'D4 Exceptional Drought',
  'D3 Extreme Drought',
  'D2 Severe Drought',
  'D1 Moderate Drought',
  'D0 Abnormally Dry',
  'Near Normal',
  'W0 Abnormally Wet',
  'W1 Moderately Wet',
  'W2 Severely Wet',
  'W3 Extremely Wet',
  'W4 Exceptionally Wet',
] as const;

type DroughtBin = (typeof DROUGHT_ORDER)[number];

type DryBin =
  | 'D0 Abnormally Dry'
  | 'D1 Moderate Drought'
  | 'D2 Severe Drought'
  | 'D3 Extreme Drought'
  | 'D4 Exceptional Drought';

type WetBin =
  | 'W0 Abnormally Wet'
  | 'W1 Moderately Wet'
  | 'W2 Severely Wet'
  | 'W3 Extremely Wet'
  | 'W4 Exceptionally Wet';


const DRY_STACK_OUTER_TO_INNER: DryBin[] = [
  'D0 Abnormally Dry',
  'D1 Moderate Drought',
  'D2 Severe Drought',
  'D3 Extreme Drought',
  'D4 Exceptional Drought', // darkest -> should end up closest to 0
];

const WET_STACK_OUTER_TO_INNER: WetBin[] = [
  'W0 Abnormally Wet',
  'W1 Moderately Wet',
  'W2 Severely Wet',
  'W3 Extremely Wet',
  'W4 Exceptionally Wet', // darkest -> should end up closest to 0
];




// type DryBin = (typeof DRY_BINS)[number];
// type WetBin = (typeof WET_BINS)[number];

const BIN_COLORS: Record<DryBin | WetBin, string> = {
  'D0 Abnormally Dry': '#FFFF00',
  'D1 Moderate Drought': '#FFD37F',
  'D2 Severe Drought': '#FF9900',
  'D3 Extreme Drought': '#FF0000',
  'D4 Exceptional Drought': '#730000',

  'W0 Abnormally Wet': '#99CCFF',
  'W1 Moderately Wet': '#0066CC',
  'W2 Severely Wet': '#0052A3',
  'W3 Extremely Wet': '#003d80',
  'W4 Exceptionally Wet': '#001a4d',
};

type DroughtAreaKey = DryBin | WetBin | 'Near Normal';



@Component({
  selector: 'app-climate-summary-2025',
  standalone: true,
  imports: [NgFor, NgIf, HttpClientModule, HighchartsChartModule, FormsModule],
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
    drought: 'Drought',
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
      { color: '#730000', label: '> 1.75°F' },
      { color: '#FF0000', label: '1.25 to 1.75°F' },
      { color: '#FF9900', label: '0.75 to 1.25°F' },
      { color: '#ffe1c2', label: '0.25 to 0.75°F' },
      { color: '#FFFFFF', label: '-0.25 to 0.25°F' },
      { color: '#cfe8ff', label: '-0.75 to -0.25°F' },
      { color: '#66a3ff', label: '-1.25 to -0.75°F' },
      { color: '#0066CC', label: '-1.75 to -1.25°F' },
      { color: '#003d80', label: '< -1.75°F' },
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

  droughtStackAreaOptions: Highcharts.Options = {
    chart: { type: 'area', marginTop: 40, spacingRight: 10 },
    
    title: { text: '' },
    credits: { enabled: false },

    xAxis: {
      type: 'category',
      categories: [],
      tickmarkPlacement: 'on',
      startOnTick: false,
      endOnTick: false,
      minPadding: 0,
      maxPadding: 0,
      // keeps categories from being treated like a "gapped" axis
      ordinal: false,
    },

    yAxis: {
      title: { text: 'Area (%)' },
      min: -65,
      max: 65,
      tickInterval: 20,
      labels: {
        formatter: function () {
          return `${Math.abs(Number(this.value))}%`;
        },
      },
      plotLines: [{ value: 0, width: 1 }],
    },

    legend: {
      enabled: true,

      layout: 'horizontal',
      align: 'center',

      itemWidth: 185,  
      width: 925,        
      itemDistance: 12,

      symbolRadius: 0,
      symbolWidth: 12,
      symbolHeight: 12,
      padding: 0,
      margin: 6,
      itemMarginTop: 2,
      itemMarginBottom: 2,
    },

    tooltip: {
      shared: true,
      formatter: function () {
        const pts = (this.points ?? []).slice().sort((a, b) => Math.abs(Number(b.y ?? 0)) - Math.abs(Number(a.y ?? 0)));
        const lines = pts.map((p) => {
          const v = Math.abs(Number(p.y ?? 0));
          return `<span style="color:${p.color}">●</span> ${p.series.name}: <b>${v.toFixed(1)}%</b>`;
        });
        return `<b>${this.x}</b><br/>${lines.join('<br/>')}`;
      },
    },


    plotOptions: {
      area: {
        stacking: 'normal',
        lineWidth: 0,
        marker: { enabled: false },
        threshold: 0,
        fillOpacity: 1,
        // THIS is the important part for tightening to the category ticks
        pointPlacement: 'on',
      },
    },


    series: [],
  };


  readonly droughtOrder = DROUGHT_ORDER;


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

    this.http
    .get('climate-summary/spi3_distribution_2025.csv', { responseType: 'text' })
    .subscribe({
      next: (csv) => {
        const parsed = this.parseDroughtDistributionCsv(csv);

        const categories = parsed.map((r) => r.monthName);

        const drySeries: Highcharts.SeriesAreaOptions[] = DRY_STACK_OUTER_TO_INNER.map((k) => ({
          type: 'area',
          name: k,
          stack: 'dry',
          data: parsed.map((r) => r.values[k] ?? 0),
          color: BIN_COLORS[k],
        }));

        const wetSeries: Highcharts.SeriesAreaOptions[] = WET_STACK_OUTER_TO_INNER.map((k) => ({
          type: 'area',
          name: k,
          stack: 'wet',
          data: parsed.map((r) => -(r.values[k] ?? 0)),
          color: BIN_COLORS[k],
        }));



        this.droughtStackAreaOptions = {
          ...this.droughtStackAreaOptions,
          xAxis: {
            ...(this.droughtStackAreaOptions.xAxis as Highcharts.XAxisOptions),
            categories,
          },
          series: [
            // order matters: put wet first so it fills downward cleanly, then dry
            ...wetSeries,
            ...drySeries,
          ],
        };
      },
      error: (err) => console.error('Failed to load spi3_distribution_2025.csv', err),
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

  private parseDroughtDistributionCsv(csv: string): Array<{
    monthName: string;
    values: Record<DroughtAreaKey, number>;
  }> {
    const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

    const lines = csv
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);

    if (lines.length < 2) return [];

    const header = lines[0].split(',').map((s) => s.trim());
    const idxMonth = header.findIndex((h) => h.toLowerCase() === 'month');

    const allKeys: DroughtAreaKey[] = [
      ...DRY_STACK_OUTER_TO_INNER,
      'Near Normal',
      ...WET_STACK_OUTER_TO_INNER,
    ];


    const colIndex: Partial<Record<DroughtAreaKey, number>> = {};
    for (const key of allKeys) {
      const i = header.findIndex((h) => h === key);
      if (i >= 0) colIndex[key] = i;
    }

    return lines
      .slice(1)
      .map((line) => line.split(',').map((s) => s.trim()))
      .filter((parts) => parts.length >= header.length)
      .map((parts) => {
        const mRaw = idxMonth >= 0 ? parts[idxMonth] : parts[0];
        const m = Number(mRaw);
        const monthName = monthNames[Math.max(1, Math.min(12, m)) - 1] ?? String(mRaw);

        const values = {} as Record<DroughtAreaKey, number>;
        for (const key of allKeys) {
          const i = colIndex[key];
          const v = i == null ? 0 : Number(parts[i]);
          values[key] = Number.isFinite(v) ? v : 0;
        }

        return { monthName, values };
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
          t_anomaly: Number(parts[3]),
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


  hoverRainIsland: IslandKey | null = null;
  hoverDroughtIsland: IslandKey | null = null;
  hoverTempIsland: IslandKey | null = null;

  setHoverIsland(panel: 'rain' | 'drought' | 'temp', k: IslandKey) {
    if (panel === 'rain') this.hoverRainIsland = k;
    if (panel === 'drought') this.hoverDroughtIsland = k;
    if (panel === 'temp') this.hoverTempIsland = k;
  }

  clearHoverIsland(panel: 'rain' | 'drought' | 'temp') {
    if (panel === 'rain') this.hoverRainIsland = null;
    if (panel === 'drought') this.hoverDroughtIsland = null;
    if (panel === 'temp') this.hoverTempIsland = null;
  }

  hoverIslandLabel(panel: 'rain' | 'drought' | 'temp'): string | null {
    const k =
      panel === 'rain' ? this.hoverRainIsland :
      panel === 'drought' ? this.hoverDroughtIsland :
      this.hoverTempIsland;

    return k ? this.islandLabel[k] : null;
  }


  private readonly rainfallHighlightsByIsland: Record<IslandKey, RainHighlight> = {
    kauai:      { pdiff: -14.2, rankText: '21st' },
    oahu:       { pdiff: -24.7, rankText: '16th' },
    molokai:    { pdiff: -59.9, rankText: '5th' },
    lanai:      { pdiff: -68.7, rankText: '15th' },
    maui:       { pdiff: -50.0, rankText: 'driest ' },
    kahoolawe:  { pdiff: -59.2, rankText: '23rd' },
    hawaii:     { pdiff: -47.0, rankText: '2nd' },
  };

  private readonly droughtHighlightsByIsland: Record<IslandKey, DroughtHighlight> = {
    kauai:      { percentDry: 56, percentModerateDrought: 50 },
    oahu:       { percentDry: 45, percentModerateDrought: 60 },
    molokai:    { percentDry: 100, percentModerateDrought: 80 },
    lanai:      { percentDry: 82, percentModerateDrought: 85 },
    maui:       { percentDry: 83, percentModerateDrought: 90 },
    kahoolawe:  { percentDry: 0, percentModerateDrought: 95 },
    hawaii:     { percentDry: 61, percentModerateDrought: 70 },
  };

  private readonly temperatureHighlightsByIsland: Record<IslandKey, TemperatureHighlight> = {
    kauai:      { anom: 0.9, rankText: '3rd' },
    oahu:       { anom: 1.0, rankText: '4th' },
    molokai:    { anom: 0.9, rankText: '4th' },
    lanai:      { anom: 0.9, rankText: '4th' },
    maui:       { anom: 0.8, rankText: '3rd' },
    kahoolawe:  { anom: 0.9, rankText: '4th' },
    hawaii:     { anom: 0.7, rankText: '8th' },
  };

  get droughtHighlight(): DroughtHighlight | null {
    return this.hoverDroughtIsland ? this.droughtHighlightsByIsland[this.hoverDroughtIsland] : null;
  }

  get rainfallHighlight(): RainHighlight | null {
    return this.hoverRainIsland ? this.rainfallHighlightsByIsland[this.hoverRainIsland] : null;
  }

  get temperatureHighlight(): TemperatureHighlight | null {
    return this.hoverTempIsland ? this.temperatureHighlightsByIsland[this.hoverTempIsland] : null;
  }


  fmtIn(x: number) { return x.toFixed(2); }
  fmtPct(x: number) { return `${x > 0 ? '+' : ''}${x.toFixed(0)}%`; }
  subscribeEmail = '';
  submitting = false;
  subscribeStatus: 'idle' | 'ok' | 'dup' | 'err' = 'idle';

  // paste your Apps Script Web App URL here
  readonly subscribeEndpoint = 'https://script.google.com/macros/s/AKfycbyUdIHyAKzgxeSvvzw-Z6KLQAvSocbnEc14DCrIjT5bF_lxMO3rcn-Cz64JcXMFVsLB/exec';

  async submitSubscribe() {
    const email = this.subscribeEmail.trim();
    if (!email) return;

    this.submitting = true;
    this.subscribeStatus = 'idle';

    try {
      await fetch(this.subscribeEndpoint, {
        method: 'POST',
        mode: 'no-cors',                 // KEY
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, source: 'climate-summary-2025' }),
      });

      // With no-cors you can't inspect the response; assume success if no exception.
      this.subscribeStatus = 'ok';
      this.subscribeEmail = '';
    } catch (err) {
      console.error(err);
      this.subscribeStatus = 'err';
    } finally {
      this.submitting = false;
    }
  }



}

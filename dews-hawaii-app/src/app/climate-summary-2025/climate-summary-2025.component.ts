import { Component, OnInit } from '@angular/core';
import { NgFor, NgIf } from '@angular/common';
import { HttpClient, HttpClientModule } from '@angular/common/http';

import * as Highcharts from 'highcharts';
import { HighchartsChartModule } from 'highcharts-angular';

type rainfallMode = 'total' | 'pdiff' ;
type temperatureMode = 'total' | 'anom';
type monthMode = 'monthly' | 'anomaly';
type LegendItem = { color: string; label: string };

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
      { color: '#001933', label: '> 90%' },
      { color: '#0066cc', label: '70 to 90%' },
      { color: '#4d94ff', label: '50 to 70%' },
      { color: '#99ccff', label: '30 to 50%' },
      { color: '#d6f0ff', label: '15 to 30%' },
      { color: '#ffffff', label: '-15 to 15%' },
      { color: '#ff9900', label: '-30 to -15%' },
      { color: '#ff4d00', label: '-50 to -30%' },
      { color: '#b30000', label: '-70 to -50%' },
      { color: '#7a0000', label: '-90 to -70%' },
      { color: '#4a0000', label: '< -90%' },
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

}

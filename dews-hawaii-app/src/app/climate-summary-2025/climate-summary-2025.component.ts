import { Component, OnInit } from '@angular/core';
import { NgFor } from '@angular/common';
import { HttpClient, HttpClientModule } from '@angular/common/http';

import * as Highcharts from 'highcharts';
import { HighchartsChartModule } from 'highcharts-angular';

type rainfallMode = 'total' | 'pdiff' ;
type temperatureMode = 'total' | 'anom';

@Component({
  selector: 'app-climate-summary-2025',
  standalone: true,
  imports: [NgFor, HttpClientModule, HighchartsChartModule],
  templateUrl: './climate-summary-2025.component.html',
  styleUrls: ['./climate-summary-2025.component.css'],
})
export class ClimateSummary2025Component implements OnInit {
  constructor(private http: HttpClient) {}

  // --- your existing stuff ---
  readonly tabs: { key: rainfallMode; label: string }[] = [
    { key: 'total', label: 'Total rainfall' },
    { key: 'pdiff', label: 'Percent Difference' }
  ];

  rainfallMode: rainfallMode = 'total';
  temperatureMode: temperatureMode = 'total';

  readonly rainfallModeLabel: Record<rainfallMode, string> = {
    total: 'Total',
    pdiff: 'Percent difference',
  };

  readonly temperatureModeLabel: Record<temperatureMode, string> = {
    total: 'Total',
    anom: 'Anomaly',
  };

  readonly rainfallSrc: Record<rainfallMode, string> = {
    total: 'climate-summary/annual_rainfall_2025_agg.png',
    pdiff: 'climate-summary/annual_rainfall_2025_pdiff.png'
  };

  readonly rainfallLegendTitle: Record<rainfallMode, string> = {
    total: 'Total rainfall (in)',
    pdiff: 'Percent difference (%)'
  };

  readonly rainfallLegendTicks: Record<rainfallMode, string[]> = {
    total: ['0', '300'],
    pdiff: ['-100', '0', '100']
  };

   readonly temperatureLegendTitle: Record<temperatureMode, string> = {
    total: 'Average temperature (°F)',
    anom: 'Anomaly (°F)',
  };

  readonly temperatureLegendTicks: Record<temperatureMode, string[]> = {
    total: ['40', '90'],
    anom: ['-1.5', '0', '1.5'],
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
      'linear-gradient(90deg, #440154 0%, #3b528b 25%, #21918c 50%, #5ec962 75%, #fde725 100%)',
    pdiff: 'linear-gradient(90deg, #b2182b 0%, #f7f7f7 50%, #2166ac 100%)'
  };

  readonly temperatureLegendGradient: Record<temperatureMode, string> = {
    total:
      'linear-gradient(90deg, #2166ac 0%, #f7f7f7 50%, #b2182b 100%)',
    anom: 'linear-gradient(90deg, #2166ac 0%, #f7f7f7 50%, #b2182b 100%)',
  };

  readonly temperatureSrc: Partial<Record<temperatureMode, string>> = {
    total: 'climate-summary/annual_tmean_2024_agg.png',
    anom: 'climate-summary/annual_tmean_2024_anomaly.png',
  };

  setRainfallMode(mode: rainfallMode) {
    this.rainfallMode = mode;
  }
  setTemperatureMode(mode: temperatureMode) {
    this.temperatureMode = mode;
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

  ngOnInit(): void {
    this.http
      .get('climate-summary/monthly_summary.csv', { responseType: 'text' })
      .subscribe((csv) => {
        const parsed = this.parseMonthlyCsv(csv);

        const categories = parsed.map((r) => r.monthName);
        const rf = parsed.map((r) => r.rf_mean);
        const tmean = parsed.map((r) => r.tmean);

        this.monthlyChartOptions = {
          ...this.monthlyChartOptions,
          xAxis: { ...(this.monthlyChartOptions.xAxis as Highcharts.XAxisOptions), categories },
          series: [
            { type: 'column', name: 'Rainfall', data: rf, yAxis: 0 },
            { type: 'spline', name: 'Temperature', data: tmean, yAxis: 1 },
          ],
        };
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
}

import { Component, OnInit } from '@angular/core';
import { NgFor } from '@angular/common';
import { HttpClient, HttpClientModule } from '@angular/common/http';

import * as Highcharts from 'highcharts';
import { HighchartsChartModule } from 'highcharts-angular';

type MapMode = 'total' | 'pon' | 'anom';

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
  readonly tabs: { key: MapMode; label: string }[] = [
    { key: 'total', label: 'Total rainfall' },
    { key: 'pon', label: 'Percent of normal' },
    { key: 'anom', label: 'Anomaly' },
  ];

  rainfallMode: MapMode = 'total';
  temperatureMode: MapMode = 'total';

  readonly modeLabel: Record<MapMode, string> = {
    total: 'Total',
    pon: 'Percent of normal',
    anom: 'Anomaly',
  };

  readonly rainfallSrc: Record<MapMode, string> = {
    total: '/climate-summary/annual_rainfall_2024_agg.png',
    pon: '/climate-summary/annual_rainfall_2024_pnormal.png',
    anom: '/climate-summary/annual_rainfall_2024_anomaly.png',
  };

  readonly rainfallLegendTitle: Record<MapMode, string> = {
    total: 'Total rainfall (in)',
    pon: 'Percent of normal (%)',
    anom: 'Anomaly (in)',
  };

  readonly rainfallLegendTicks: Record<MapMode, string[]> = {
    total: ['0', '300'],
    pon: ['0', '100', '200'],
    anom: ['-120', '0', '120'],
  };

  readonly rainfallLegendUnit: Record<MapMode, string> = {
    total: 'in',
    pon: '%',
    anom: 'in',
  };

  readonly rainfallLegendGradient: Record<MapMode, string> = {
    total:
      'linear-gradient(90deg, #440154 0%, #3b528b 25%, #21918c 50%, #5ec962 75%, #fde725 100%)',
    pon: 'linear-gradient(90deg, #2166ac 0%, #f7f7f7 50%, #b2182b 100%)',
    anom: 'linear-gradient(90deg, #2166ac 0%, #f7f7f7 50%, #b2182b 100%)',
  };

  readonly temperatureSrc: Partial<Record<MapMode, string>> = {
    total: '/climate-summary/annual_tmean_2024_agg.png',
    anom: '/climate-summary/annual_tmean_2024_anomaly.png',
  };

  setRainfallMode(mode: MapMode) {
    this.rainfallMode = mode;
  }
  setTemperatureMode(mode: MapMode) {
    this.temperatureMode = mode;
  }

  Highcharts: typeof Highcharts = Highcharts;

  monthlyChartOptions: Highcharts.Options = {
    title: { text: 'Monthly rainfall and temperature' },
    credits: { enabled: false },
    xAxis: { categories: [] },
    yAxis: [
      { title: { text: 'Rainfall (in)' } },
      { title: { text: 'Temperature (°F)' }, opposite: true },
    ],
    tooltip: { shared: true },
    legend: { enabled: true },
    series: [
      { type: 'column', name: 'Rainfall', data: [], yAxis: 0 },
      { type: 'spline', name: 'Temperature', data: [], yAxis: 1 },
    ],
  };

  ngOnInit(): void {
    this.http
      .get('/climate-summary/monthly_summary.csv', { responseType: 'text' })
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

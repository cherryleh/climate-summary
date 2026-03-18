import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit } from '@angular/core';
import * as Highcharts from 'highcharts';
import 'highcharts/modules/boost';
import { HighchartsChartModule } from 'highcharts-angular';
import { FormsModule } from '@angular/forms';

Highcharts.setOptions({
  time: {
    timezone: 'Pacific/Honolulu'
  }
});

type StormMode = 'daily' | 'cumulative';
type CountyFilter = 'all' | 'maui' | 'hawaii' | 'molokai' | 'oahu' | 'kauai';

interface StormDay {
  label: string;
  date: string;
  stats: {
    daily: { date: string; avg: string };
    cumulative: { date: string; avg: string };
  };
}

@Component({
  selector: 'app-storm-viewer',
  standalone: true,
  imports: [CommonModule, HighchartsChartModule, FormsModule],
  templateUrl: './storm-viewer.component.html',
  styleUrls: ['./storm-viewer.component.css']
})
export class StormViewerComponent implements OnInit, OnDestroy {
  Highcharts: typeof Highcharts = Highcharts;

  updateFlag = false;
  isChartLoading = false;

  selectedCounty: CountyFilter = 'all';

  chartOptions: Highcharts.Options = {
    chart: {
      height: 400,
      zooming: { type: 'x' }
    },
    title: { text: 'Mesonet Station Rainfall' },
    credits: { enabled: false },
    xAxis: {
      type: 'datetime',
      title: { text: 'Time' }
    },
    yAxis: {
      title: { text: 'Rainfall (in)' }
    },
    tooltip: {
      shared: false,
      xDateFormat: '%b %e, %Y %I:%M %p'
    },
    legend: {
      enabled: false
    },
    plotOptions: {
      series: {
        marker: { enabled: false },
        turboThreshold: 0,
        lineWidth: 1,
        animation: false
      }
    },
    series: []
  };

  mode: StormMode = 'daily';
  selectedDayIndex = 0;

  isPlaying = false;
  playbackMs = 1200;
  private playInterval: ReturnType<typeof setInterval> | null = null;

  days: StormDay[] = [
    {
      label: 'Day 1',
      date: '2026_03_10',
      stats: {
        daily: { date: 'March 10, 2026', avg: '1.2 in' },
        cumulative: { date: 'March 10, 2026', avg: '1.2 in' }
      }
    },
    {
      label: 'Day 2',
      date: '2026_03_11',
      stats: {
        daily: { date: 'March 11, 2026', avg: '0.9 in' },
        cumulative: { date: 'March 11, 2026', avg: '2.1 in' }
      }
    },
    {
      label: 'Day 3',
      date: '2026_03_12',
      stats: {
        daily: { date: 'March 12, 2026', avg: '1.6 in' },
        cumulative: { date: 'March 12, 2026', avg: '3.2 in' }
      }
    },
    {
      label: 'Day 4',
      date: '2026_03_13',
      stats: {
        daily: { date: 'March 13, 2026', avg: '0.3 in' },
        cumulative: { date: 'March 13, 2026', avg: '3.5 in' }
      }
    },
    {
      label: 'Day 5',
      date: '2026_03_14',
      stats: {
        daily: { date: 'March 14, 2026', avg: '2.0 in' },
        cumulative: { date: 'March 14, 2026', avg: '5.4 in' }
      }
    },
    {
      label: 'Day 6',
      date: '2026_03_15',
      stats: {
        daily: { date: 'March 15, 2026', avg: '1.1 in' },
        cumulative: { date: 'March 15, 2026', avg: '6.1 in' }
      }
    }
  ];

  ngOnInit(): void {
    this.loadStormChart();
  }

  get selectedDay() {
    return this.days[this.selectedDayIndex];
  }

  get imagePath() {
    const base = `${this.selectedDay.date}`;
    return this.mode === 'daily'
      ? `storm_site/${base}.png`
      : `storm_site/${base}_cumulative.png`;
  }

  get stats() {
    return this.selectedDay.stats[this.mode];
  }

  selectDay(i: number) {
    this.selectedDayIndex = i;
  }

  toggleMode() {
    this.mode = this.mode === 'daily' ? 'cumulative' : 'daily';
    this.loadStormChart();
  }

  onCountyChange() {
    this.loadStormChart();
  }

  togglePlay() {
    this.isPlaying ? this.stopPlayback() : this.startPlayback();
  }

  startPlayback() {
    if (this.playInterval) return;

    this.isPlaying = true;
    this.playInterval = setInterval(() => {
      this.selectedDayIndex = (this.selectedDayIndex + 1) % this.days.length;
    }, this.playbackMs);
  }

  stopPlayback() {
    this.isPlaying = false;

    if (this.playInterval) {
      clearInterval(this.playInterval);
      this.playInterval = null;
    }
  }

  ngOnDestroy() {
    this.stopPlayback();
  }

  private getCountyPrefix(county: CountyFilter): string | null {
    switch (county) {
      case 'maui':
        return '01';
      case 'hawaii':
        return '02';
      case 'molokai':
        return '04';
      case 'oahu':
        return '05';
      case 'kauai':
        return '06';
      default:
        return null;
    }
  }

  private filterStationIdsByCounty(stationIds: string[]): string[] {
    const prefix = this.getCountyPrefix(this.selectedCounty);
    if (!prefix) return stationIds;
    return stationIds.filter(id => id.startsWith(prefix));
  }

  async loadStormChart() {
    try {
      this.isChartLoading = true;
      this.updateFlag = false;

      const response = await fetch('/storm_site/merged_storm_data.csv');
      if (!response.ok) {
        throw new Error(`Failed to fetch CSV: ${response.status}`);
      }

      const csvText = await response.text();
      const lines = csvText.trim().split(/\r?\n/);

      if (lines.length < 2) {
        this.isChartLoading = false;
        return;
      }

      const headers = lines[0].split(',').map(h => h.trim());
      const allStationIds = headers.slice(1);
      const stationIds = this.filterStationIdsByCounty(allStationIds);

      const seriesMap: Record<string, [number, number | null][]> = {};
      const runningTotals: Record<string, number> = {};

      stationIds.forEach(id => {
        seriesMap[id] = [];
        runningTotals[id] = 0;
      });

      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(',');
        if (cols.length < headers.length) continue;

        const timestampStr = cols[0]?.trim();
        if (!timestampStr) continue;

        const [datePart, timePart] = timestampStr.split(' ');
        if (!datePart || !timePart) continue;

        const [year, month, day] = datePart.split('-').map(Number);
        const [hour, minute, second] = timePart.split(':').map(Number);
        const time = new Date(year, month - 1, day, hour, minute, second).getTime();

        for (let j = 0; j < stationIds.length; j++) {
          const stationId = stationIds[j];
          const colIndex = headers.indexOf(stationId);
          const raw = cols[colIndex]?.trim();

          if (this.mode === 'cumulative') {
            const numericValue = raw === '' ? 0 : Number(raw);
            runningTotals[stationId] += Number.isFinite(numericValue) ? numericValue : 0;
            seriesMap[stationId].push([time, runningTotals[stationId]]);
          } else {
            const value = raw === '' ? null : Number(raw);
            seriesMap[stationId].push([
              time,
              Number.isFinite(value) ? value : null
            ]);
          }
        }
      }

      const colors = [
        '#1f77b4', '#d62728', '#2ca02c', '#9467bd', '#ff7f0e',
        '#17becf', '#8c564b', '#e377c2', '#7f7f7f', '#bcbd22'
      ];

      const series: Highcharts.SeriesOptionsType[] = stationIds.map((id, idx) => ({
        name: id,
        type: 'line',
        data: seriesMap[id],
        color: colors[idx % colors.length],
        lineWidth: 1,
        marker: { enabled: false }
      }));

      this.chartOptions = {
        ...this.chartOptions,
        title: {
          text:
            this.selectedCounty === 'all'
              ? 'Storm Station Rainfall Time Series'
              : `Storm Station Rainfall Time Series – ${this.selectedCounty}`
        },
        series
      };

      setTimeout(() => {
        this.updateFlag = true;
        this.isChartLoading = false;
      }, 0);

    } catch (err) {
      console.error('Chart load error:', err);
      this.isChartLoading = false;
    }
  }
}

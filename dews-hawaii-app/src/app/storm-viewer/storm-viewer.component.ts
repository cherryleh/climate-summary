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
    daily: { date: string; min: string, avg: string, max: string };
    cumulative: { date: string; min: string, avg: string, max: string  };
    text: string;
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
      xDateFormat: '%b %e, %Y %I:%M',
      pointFormat: 'Station ID#{series.name}: <b>{point.y:.2f} in</b>'
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
        daily: { date: 'March 10, 2026', min: '0.5 in', avg: '1.2 in', max: '1.8 in' },
        cumulative: { date: 'March 10, 2026', min: '0.5 in', avg: '1.2 in', max: '1.8 in' },
        text: 'The first of two disturbances began impacting the state, primarily affecting the western half of the island chain. In Kauai County, Lihue set a daily rainfall record of 1.82 inches, breaking its 2021 record of 0.80 inches. This initial phase of the storm brought general rainfall totals between 2 to 5 inches, with the most concentrated amounts falling along the southern portions of Kauai and Oahu.'
      }
    },
    {
      label: 'Day 2',
      date: '2026_03_11',
      stats: {
        daily: { date: 'March 11, 2026', min: '0.5 in', avg: '1.2 in', max: '1.8 in' },
        cumulative: { date: 'March 11, 2026', min: '0.5 in', avg: '2.1 in', max: '3.6 in' },
        text: 'The first disturbance continued moving through the western islands during the morning hours. Maui County recorded a new daily rainfall record at Kahului Airport, where 1.01 inches fell, surpassing the previous 2015 record of 0.53 inches. Throughout the state, deep tropical moisture continued to be drawn northward, setting the stage for more intense precipitation.'
      }
    },
    {
      label: 'Day 3',
      date: '2026_03_12',
      stats: {
        daily: { date: 'March 12, 2026', min: '0.5 in', avg: '1.6 in', max: '2.5 in' },
        cumulative: { date: 'March 12, 2026', min: '0.5 in', avg: '3.2 in', max: '5.1 in' },
        text: 'A second, significantly stronger disturbance began affecting the entire state, bringing multiple bands of heavy rain and embedded thunderstorms. This new phase marked a major shift in intensity, with rainfall totals of at least 5 to 10 inches beginning to accumulate over the vast majority of the islands.'
      },

    },
    {
      label: 'Day 4',
      date: '2026_03_13',
      stats: {
        daily: { date: 'March 13, 2026', min: '0.5 in', avg: '0.3 in', max: '1.0 in' },
        cumulative: { date: 'March 13, 2026', min: '0.5 in', avg: '3.5 in', max: '6.0 in' },
        text: 'This was a major record-breaking day for rainfall across multiple counties. In Kauai County, Lihue recorded 5.47 inches (breaking a 2006 record); in Honolulu County, Honolulu recorded 5.51 inches (breaking a 1951 record); and in Maui County, Kahului recorded 7.40 inches. This 7.40-inch total not only broke the daily record but also set an all-time daily rainfall record for Kahului, surpassing the previous high from December 2017.'
      }
    },
    {
      label: 'Day 5',
      date: '2026_03_14',
      stats: {
        daily: { date: 'March 14, 2026', min: '0.5 in', avg: '2.0 in', max: '3.0 in' },
        cumulative: { date: 'March 14, 2026', min: '0.5 in', avg: '5.4 in', max: '8.4 in' },
        text: 'Extreme rainfall continued as the storm moved through the eastern islands. Honolulu County (Honolulu) saw 1.75 inches, Maui County (Kahului) recorded 5.82 inches, and Hawaii County (Hilo) recorded 5.60 inches, all of which were new daily records. During this peak period, the southern halves of Maui and the Big Island experienced the most significant flooding and storm impacts.'
      }
    },
    {
      label: 'Day 6',
      date: '2026_03_15',
      stats: {
        daily: { date: 'March 15, 2026', min: '0.5 in', avg: '1.1 in', max: '1.8 in' },
        cumulative: { date: 'March 15, 2026', min: '0.5 in', avg: '6.1 in', max: '7.9 in' },
        text: 'The powerful disturbance continued to produce heavy rain across the state through the end of the weekend. By the conclusion of the event, southeastern portions of Maui and the Big Island saw massive rainfall swaths between 15 and 25 inches, with some localized areas exceeding 30 inches. The highest seven-day total in the state was recorded at the Maui Summit, which received a staggering 49.57 inches of rain.'
      }
    },
    {
      label: 'Day 7',
      date: '2026_03_16',
      stats: {
        daily: { date: 'March 16, 2026', min: '0.5 in', avg: '0.8 in', max: '1.2 in' },
        cumulative: { date: 'March 16, 2026', min: '0.5 in', avg: '6.9 in', max: '8.7 in' },
        text: '?'
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

      const response = await fetch('storm_site/merged_storm_data.csv');
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

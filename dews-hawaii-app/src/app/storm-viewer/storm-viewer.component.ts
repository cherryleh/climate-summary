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

interface RainStats {
  date: string;
  min: string;
  avg: string;
  max: string;
}

interface CountyDayStats {
  daily: RainStats;
  cumulative: RainStats;
  text: string;
}

interface StormDay {
  label: string;
  date: string;
  statsByCounty: Partial<Record<CountyFilter, CountyDayStats>>;
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

  windUpdateFlag = false;
  isWindChartLoading = false;
  selectedCounty: CountyFilter = 'all';
  selectedSeriesId: string | null = null;

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
      pointFormat: 'Station ID#{series.name}: <b>{point.y:.2f} in</b>',

    },
    legend: {
      enabled: false
    },
    plotOptions: {
      series: {
        stickyTracking: false,
        marker: { enabled: false },
        turboThreshold: 0,
        lineWidth: 1,
        animation: false
      }
    },
    series: []
  };

  windChartOptions: Highcharts.Options = {
    chart: {
      height: 400,
      zooming: { type: 'x' }
    },
    title: { text: 'Mesonet Station Wind Gust' },
    credits: { enabled: false },
    xAxis: {
      type: 'datetime',
      title: { text: 'Time' }
    },
    yAxis: {
      title: { text: 'Wind Gust (mph)' }
    },
    tooltip: {
      shared: false,
      xDateFormat: '%b %e, %Y %I:%M',
      pointFormat: 'Station ID #{series.name}: <b>{point.y:.2f} mph</b>'
    },
    legend: {
      enabled: false
    },
    plotOptions: {
      series: {
        stickyTracking: false,
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
      statsByCounty: {
        all: {
          daily: { date: 'March 10, 2026', min: '0.5 in', avg: '1.2 in', max: '1.8 in' },
          cumulative: { date: 'March 10, 2026', min: '0.5 in', avg: '1.2 in', max: '1.8 in' },
          text: 'The storm began its impact on the western end of the state, with Kauai recording the highest island-wide rainfall totals for the day. A standout observation was recorded at the Lāwaʻi National Tropical Botanical Garden (NTBG), which saw 2.92 inches of rain. This was a remarkably high value for a low-land leeward location, made possible by the storm’s strong southerly flow that drove moisture directly into typically sheltered areas. While Kauai was being saturated, the central and eastern islands, including Maui, Molokai, and the Big Island, remained relatively dry as the primary moisture band had not yet progressed eastward.'
        }
      }
    },
    {
      label: 'Day 2',
      date: '2026_03_11',
      statsByCounty: {
        all: {
          daily: { date: 'March 11, 2026', min: '0.5 in', avg: '1.2 in', max: '1.8 in' },
          cumulative: { date: 'March 11, 2026', min: '0.5 in', avg: '2.1 in', max: '3.6 in' },
          text: 'On the second day of the storm, the rainfall was primarily concentrated over Oahu, although it began to spread onto Maui as the system drifted. Maui County technically claimed the highest total island rainfall as the leading edge of the plume moved in, but the individual peak was found at the Kaʻala station on Oahu with 4.71 inches. The NWS notes indicated an increasingly unstable atmosphere as the "Kona Low" environment deepened. During this time, the Big Island and Kauai saw significantly lower rainfall totals compared to the central islands as the core of the moisture focused on the middle of the chain.'
        }
      }
    },
    {
      label: 'Day 3',
      date: '2026_03_12',
      statsByCounty: {
        all: {
          daily: { date: 'March 12, 2026', min: '0.5 in', avg: '1.6 in', max: '2.5 in' },
          cumulative: { date: 'March 12, 2026', min: '0.5 in', avg: '3.2 in', max: '5.1 in' },
          text: 'The storm continued to stall over the central islands, with rainfall remaining heavy on Oahu before firmly anchoring itself over Maui. Maui recorded the highest rainfall for the day, led by the Keōpukaloa station with 3.71 inches. The slow movement of the system allowed for continuous saturation of the terrain. As the system transitioned its weight toward the east, Kauai and the southern districts of the Big Island did not receive much rainfall, remaining on the fringes of the moisture-rich convergence zone.'
        }
      }
    },
    {
      label: 'Day 4',
      date: '2026_03_13',
      statsByCounty: {
        all: {
          daily: { date: 'March 13, 2026', min: '0.5 in', avg: '0.3 in', max: '1.0 in' },
          cumulative: { date: 'March 13, 2026', min: '0.5 in', avg: '3.5 in', max: '6.0 in' },
          text: 'The weather situation turned critical as the rainfall focused and intensified significantly on Maui. The island recorded the highest rainfall totals in the state by a wide margin, dominated by an extraordinary 25.00 inches at the Haleakalā Summit station. This intensification was fueled by deep tropical moisture being lifted over Maui’s steep topography. While Maui was inundated, the western end of the state, particularly Kauai, saw very little activity as it moved into a post-frontal regime. Wind speeds also began to peak across the region as the pressure gradient tightened.'
        }
      }
    },
    {
      label: 'Day 5',
      date: '2026_03_14',
      statsByCounty: {
        all: {
          daily: { date: 'March 14, 2026', min: '0.5 in', avg: '2.0 in', max: '3.0 in' },
          cumulative: { date: 'March 14, 2026', min: '0.5 in', avg: '5.4 in', max: '8.4 in' },
          text: "March 14 was the most extreme day of the entire event, with Maui receiving catastrophic rainfall totals. The station at Nāhuku recorded the highest daily total at 27.99 inches, but the most significant measurements came from high-elevation sites: Kuiki (160) recorded 26.09 inches and Haleakalā Summit (153) recorded 19.59 inches in a single 24-hour period. By this evening, the cumulative total at Kuiki reached nearly 50 inches. This day also featured the highest recorded wind speed of the storm, which reached 48.75 mph at the Kaiāulu Puʻuwaʻawaʻa station on the Big Island at 04:20 AM. Meanwhile, Oahu, Kauai, and Molokai did not get much rainfall as the storm's energy was almost entirely localized over the windward slopes of Haleakalā."
        }
      }
    },
    {
      label: 'Day 6',
      date: '2026_03_15',
      statsByCounty: {
        all: {
          daily: { date: 'March 15, 2026', min: '0.5 in', avg: '1.1 in', max: '1.8 in' },
          cumulative: { date: 'March 15, 2026', min: '0.5 in', avg: '6.1 in', max: '7.9 in' },
          text: "The storm finally began to migrate off Maui and onto the Big Island, which recorded the highest island-wide rainfall for the day. Puʻuwaʻawaʻa recorded a daily peak of 6.90 inches as the system slowly lost its organized core. As the moisture plume shifted southeast, the islands of Oahu, Kauai, and Molokai saw clearing conditions and very little additional precipitation. Although the rainfall was shifting islands, Maui’s high-elevation terrain continued to experience gusty conditions as the atmosphere began to stabilize."
        }
      }
    },
    {
      label: 'Day 7',
      date: '2026_03_16',
      statsByCounty: {
        all: {
          daily: { date: 'March 16, 2026', min: '0.5 in', avg: '0.8 in', max: '1.2 in' },
          cumulative: { date: 'March 16, 2026', min: '0.5 in', avg: '6.9 in', max: '8.7 in' },
          text: "On the final day of the event, the Big Island continued to see the highest rainfall as the remnants of the moisture plume passed over its southern slopes. Puʻuwaʻawaʻa recorded an additional 2.44 inches, bringing the total event duration to a close. The cumulative rainfall maps show a final state-wide maximum at Kuiki on Maui, which totaled 51.90 inches over the seven-day period. By the afternoon, all other islands from Kauai through Maui had returned to dry conditions with no significant rainfall reported as the storm finally dissipated into the central Pacific."
        }
      }
    }
  ];

  get selectedStats(): CountyDayStats {
    const day = this.selectedDay;

    return (
      day.statsByCounty[this.selectedCounty] ||
      day.statsByCounty['all'] || {
        daily: { date: '', min: '--', avg: '--', max: '--' },
        cumulative: { date: '', min: '--', avg: '--', max: '--' },
        text: 'No summary available.'
      }
    );
  }

  ngOnInit(): void {
    this.loadAllCharts();
  }

  loadAllCharts() {
    this.loadStormChart();
    this.loadWindChart();
  }
  get selectedDay() {
    return this.days[this.selectedDayIndex];
  }


  selectDay(i: number) {
    this.selectedDayIndex = i;
  }

  toggleMode() {
    this.mode = this.mode === 'daily' ? 'cumulative' : 'daily';
    this.loadStormChart();
  }

  onCountyChange() {
    this.loadAllCharts();
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

  private getCountyPrefixes(county: CountyFilter): string[] | null {
    switch (county) {
      case 'maui':
        return ['01', '04'];

      case 'hawaii':
        return ['02'];

      case 'oahu':
        return ['05'];

      case 'kauai':
        return ['06'];

      default:
        return null;
    }
  }

  private getCountyImageSuffix(county: CountyFilter): string | null {
    switch (county) {
      case 'hawaii':
        return 'Ha';
      case 'oahu':
        return 'Oa';
      case 'maui':
        return 'Ma';
      case 'molokai':
        return 'Ma'; // Maui County map/image
      case 'kauai':
        return 'Ka';
      default:
        return null; // all counties
    }
  }

  get imagePath() {
    const base = this.selectedDay.date;
    const countySuffix = this.getCountyImageSuffix(this.selectedCounty);

    // all counties
    if (!countySuffix) {
      return this.mode === 'daily'
        ? `storm_site/${base}.png`
        : `storm_site/${base}_cumulative.png`;
    }

    // county-specific
    return this.mode === 'daily'
      ? `storm_site/county/${base}_${countySuffix}.png`
      : `storm_site/county/${base}_cumulative_${countySuffix}.png`;
  }

  private filterStationIdsByCounty(stationIds: string[]): string[] {
    const prefixes = this.getCountyPrefixes(this.selectedCounty);
    if (!prefixes) return stationIds;

    return stationIds.filter(id =>
      prefixes.some(prefix => id.startsWith(prefix))
    );
  }

  private async loadCsvChart(
    csvPath: string,
    chartType: 'rain' | 'wind'
  ): Promise<void> {
    const isRain = chartType === 'rain';

    try {
      if (isRain) {
        this.isChartLoading = true;
        this.updateFlag = false;
      } else {
        this.isWindChartLoading = true;
        this.windUpdateFlag = false;
      }

      const response = await fetch(csvPath);
      if (!response.ok) {
        throw new Error(`Failed to fetch CSV: ${response.status}`);
      }

      const csvText = await response.text();
      const lines = csvText.trim().split(/\r?\n/);

      if (lines.length < 2) {
        if (isRain) {
          this.isChartLoading = false;
        } else {
          this.isWindChartLoading = false;
        }
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

          if (isRain && this.mode === 'cumulative') {
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
        marker: { enabled: false },
        stickyTracking: false
      }));

      if (isRain) {
        this.chartOptions.series = [];
        this.updateFlag = true;

        setTimeout(() => {
          this.chartOptions = {
            ...this.chartOptions,
            title: {
              text:
                this.selectedCounty === 'all'
                  ? 'Mesonet Station Cumulative Rainfall Time Series'
                  : `Mesonet Station Cumulative Rainfall Time Series – ${this.formatCountyName(this.selectedCounty)}`
            },
            yAxis: {
              title: { text: this.mode === 'daily' ? 'Rainfall (in)' : 'Cumulative Rainfall (in)' }
            },
            series
          };
          this.updateFlag = true;
          this.isChartLoading = false;
        }, 10);
      } else {
        this.windChartOptions.series = [];
        this.windUpdateFlag = true;

        setTimeout(() => {
          this.windChartOptions = {
            ...this.windChartOptions,
            title: {
              text:
                this.selectedCounty === 'all'
                  ? 'Mesonet Station Wind Gust Time Series'
                  : `Mesonet Station Wind Gust Time Series – ${this.formatCountyName(this.selectedCounty)}`
            },
            series
          };
          this.windUpdateFlag = true;
          this.isWindChartLoading = false;
        }, 10);
      }

    } catch (err) {
      console.error(`${chartType} chart load error:`, err);

      if (isRain) {
        this.isChartLoading = false;
      } else {
        this.isWindChartLoading = false;
      }
    }
  }

  private formatCountyName(county: CountyFilter): string {
    if (county === 'all') return 'Statewide';

    return county.charAt(0).toUpperCase() + county.slice(1);
  }

  // async loadStormChart() {
  //   try {
  //     this.isChartLoading = true;
  //     this.updateFlag = false;



  //     const response = await fetch('storm_site/merged_storm_data.csv');
  //     if (!response.ok) {
  //       throw new Error(`Failed to fetch CSV: ${response.status}`);
  //     }

  //     const csvText = await response.text();
  //     const lines = csvText.trim().split(/\r?\n/);

  //     if (lines.length < 2) {
  //       this.isChartLoading = false;
  //       return;
  //     }

  //     const headers = lines[0].split(',').map(h => h.trim());
  //     const allStationIds = headers.slice(1);
  //     const stationIds = this.filterStationIdsByCounty(allStationIds);

  //     const seriesMap: Record<string, [number, number | null][]> = {};
  //     const runningTotals: Record<string, number> = {};

  //     stationIds.forEach(id => {
  //       seriesMap[id] = [];
  //       runningTotals[id] = 0;
  //     });

  //     for (let i = 1; i < lines.length; i++) {
  //       const cols = lines[i].split(',');
  //       if (cols.length < headers.length) continue;

  //       const timestampStr = cols[0]?.trim();
  //       if (!timestampStr) continue;

  //       const [datePart, timePart] = timestampStr.split(' ');
  //       if (!datePart || !timePart) continue;

  //       const [year, month, day] = datePart.split('-').map(Number);
  //       const [hour, minute, second] = timePart.split(':').map(Number);
  //       const time = new Date(year, month - 1, day, hour, minute, second).getTime();

  //       for (let j = 0; j < stationIds.length; j++) {
  //         const stationId = stationIds[j];
  //         const colIndex = headers.indexOf(stationId);
  //         const raw = cols[colIndex]?.trim();

  //         if (this.mode === 'cumulative') {
  //           const numericValue = raw === '' ? 0 : Number(raw);
  //           runningTotals[stationId] += Number.isFinite(numericValue) ? numericValue : 0;
  //           seriesMap[stationId].push([time, runningTotals[stationId]]);
  //         } else {
  //           const value = raw === '' ? null : Number(raw);
  //           seriesMap[stationId].push([
  //             time,
  //             Number.isFinite(value) ? value : null
  //           ]);
  //         }
  //       }
  //     }

  //     const colors = [
  //       '#1f77b4', '#d62728', '#2ca02c', '#9467bd', '#ff7f0e',
  //       '#17becf', '#8c564b', '#e377c2', '#7f7f7f', '#bcbd22'
  //     ];

  //     const series: Highcharts.SeriesOptionsType[] = stationIds.map((id, idx) => ({
  //       name: id,
  //       type: 'line',
  //       data: seriesMap[id],
  //       color: colors[idx % colors.length],
  //       lineWidth: 1,
  //       marker: { enabled: false },
  //       stickyTracking: false
  //     }));

  //     this.chartOptions.series = [];
  //     this.updateFlag = true;

  //     setTimeout(() => {
  //       this.chartOptions = {
  //         ...this.chartOptions,
  //         title: {
  //           text: this.selectedCounty === 'all'
  //                 ? 'Storm Station Rainfall Time Series'
  //                 : `Storm Station Rainfall Time Series – ${this.selectedCounty}`
  //         },
  //         series: series
  //       };
  //       this.updateFlag = true;
  //       this.isChartLoading = false;
  //     }, 10);

  //     setTimeout(() => {
  //       this.updateFlag = true;
  //       this.isChartLoading = false;
  //     }, 0);

  //   } catch (err) {
  //     console.error('Chart load error:', err);
  //     this.isChartLoading = false;
  //   }
  // }

  async loadStormChart() {
    await this.loadCsvChart('storm_site/merged_storm_data.csv', 'rain');
  }

  async loadWindChart() {
    await this.loadCsvChart('storm_site/WG_merged_storm_data.csv', 'wind');
  }
}

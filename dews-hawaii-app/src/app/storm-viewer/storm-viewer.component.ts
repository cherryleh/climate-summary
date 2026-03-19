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

  chartRef?: Highcharts.Chart;
  windChartRef?: Highcharts.Chart;

  private readonly stationColors = [
    '#1f77b4', '#d62728', '#2ca02c', '#9467bd', '#ff7f0e',
    '#17becf', '#8c564b', '#e377c2', '#7f7f7f', '#bcbd22'
  ];

  private stationColorMap: Record<string, string> = {};

  chartOptions: Highcharts.Options = {
    chart: {
      height: 400,
      zooming: { type: 'x' }
    },
    title: { text: 'Mesonet Station Rainfall' },
    credits: { enabled: false },
    xAxis: {
      type: 'datetime',
      title: { text: 'Time' },
      events: {
        setExtremes: (e) => {
          if (this.chartRef && this.windChartRef) {
            this.syncExtremes(this.chartRef, this.windChartRef, e);
          }
        }
      }
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
        stickyTracking: true,
        marker: { enabled: false,
          states: {
          hover: {
            enabled: true,
            radius: 6,
            radiusPlus: 6
          }
         },},
        turboThreshold: 0,
        lineWidth: 1,
        animation: false,

        point: {
          events: {
            click: (event) => {
              const seriesName = event.point.series.name;
              this.onSeriesClick(seriesName);
            }
          }
        }
      }
    },
    series: []
  };

  onSeriesClick(seriesId: string) {
    this.selectedSeriesId = seriesId;
  }

  windChartOptions: Highcharts.Options = {
    chart: {
      height: 400,
      zooming: { type: 'x' }
    },
    title: { text: 'Mesonet Station Wind Gust' },
    credits: { enabled: false },
    xAxis: {
      type: 'datetime',
      title: { text: 'Time' },
      events: {
        setExtremes: (e) => {
          if (this.windChartRef && this.chartRef) {
            this.syncExtremes(this.windChartRef, this.chartRef, e);
          }
        }
      }
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
        stickyTracking: true,
        marker: { enabled: false },
        turboThreshold: 0,
        lineWidth: 1,
        animation: false,
        point: {
          events: {
            click: (event) => {
              const seriesName = event.point.series.name;
              this.onSeriesClick(seriesName);
            }
          }
        }
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
          text: 'The storm’s impact began at the western end of the state with Kauaʻi recording the highest islandwide rainfall totals for the day. A notable observation was recorded at the Lāwaʻi National Tropical Botanical Garden (NTBG) Hawaiʻi Mesonet station, which received 2.92 inches of rain. This remarkably high value for a lowland leeward location was the result of the storm’s strong southerly flow that produced significant rainfall in typically rain-shadowed areas. While parts of Kauaʻi were receiving heavy rainfall, the central and eastern islands, including Maui, Molokaʻi, and Hawaiʻi Island, remained relatively.'
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
          text: 'On the second day of the storm, the rainfall was primarily concentrated over Oʻahu, although it began to spread onto Maui as the system slowly shifted eastward. Maui County  claimed the highest islandwide rainfall, but the individual peak was found at the Kaʻala Hawaiʻi Mesonet station on Oʻahu with 4.71 inches. The National Weather Service noted an increasingly unstable atmosphere as the "Kona Low" environment deepened. During this time, the Big Island and Kauaʻi saw significantly lower rainfall totals compared to the central islands as the core of the storm was focused over the middle of the state.'
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
          text: 'The storm stalled over the central islands, with rainfall remaining heavy on Oʻahu while spreading over Maui. Maui recorded the highest rainfall for the day, led by the Puʻu Kukui  with 4.01 inches. The slow movement of the system and high intensity rains began to saturate the terrain in some areas. Kauaʻi and the southern districts of Hawaiʻi Island remained on the fringes of the storm.'
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
          text: "March 14 was a day of extreme rainfall and high winds on Maui and Hawaiʻi Island. Rainfall on the east slope of Haleakalā was estimated to have been as high as 40 inches. Daily rainfall totals from high-elevation sites included Kuiki with 26.09 inches and Haleakalā Summit with 19.46 inches. By that evening, the cumulative total at Kuiki reached nearly 50 inches. This day also featured the highest recorded wind speed of the storm at the Kaiāulu Puʻuwaʻawaʻa Hawaiʻi Mesonet station on Hawaiʻi Island (see the Puʻuwaʻawaʻa Extreme Wind focus box below). Meanwhile, Kauaʻi was the only major island not experiencing heavy rainfall."
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
          text: "Rainfall decreased on Maui, while Hawaiʻi Island recorded the highest islandwide rainfall for the day. The Puʻuwaʻawaʻa Hawaiʻi Mesonet station recorded a daily peak of 6.84 inches.  Maui’s high-elevation terrain continued to experience gusty winds. Oʻahu, Kauaʻi, and Molokaʻi saw clearing conditions."
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
          text: "On the final day of the event, Hawaiʻi Island continued to receive the most rainfall. The cumulative rainfall maps show a final storm total maximum of 62 inches at a point on the eastern flank of Haleakalā on Maui near the Kuiki Hawaiʻi Mesonet station, which recorded a storm total of 53.05 inches. "
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

  private getStationColor(stationId: string): string {
    if (!this.stationColorMap[stationId]) {
      const assignedCount = Object.keys(this.stationColorMap).length;
      this.stationColorMap[stationId] =
        this.stationColors[assignedCount % this.stationColors.length];
    }

    return this.stationColorMap[stationId];
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

        const series: Highcharts.SeriesOptionsType[] = stationIds.map((id) => ({
          name: id,
          type: 'line',
          data: seriesMap[id],
          color: this.getStationColor(id),
          lineWidth: 1,
          marker: { enabled: false },
          stickyTracking: true
        }));

        // Inside the isRain block of loadCsvChart
        if (isRain) {
          this.chartOptions.series = [];
          this.updateFlag = true;

          // 1. Determine if we are in county mode
          const isCountyMode = this.selectedCounty !== 'all';

          setTimeout(() => {
            this.chartOptions = {
              ...this.chartOptions,
              title: {
                text: this.selectedCounty === 'all'
                  ? 'Mesonet Station Cumulative Rainfall Time Series'
                  : `Mesonet Station Cumulative Rainfall Time Series – ${this.formatCountyName(this.selectedCounty)}`
              },
              plotOptions: {
                series: {
                  stickyTracking: true,
                  marker: { enabled: false },
                  turboThreshold: 0,
                  lineWidth: 1,
                  animation: false,
                  boostThreshold: isCountyMode ? 0 : 5000,
                  states: {
                    inactive: {
                      opacity: isCountyMode ? 0.15 : 1,
                      enabled: isCountyMode
                    },
                    hover: {
                      enabled: true,
                      lineWidthPlus: 2
                    }
                  },
                  point: {
                    events: {
                      click: (event) => {
                        const seriesName = event.point.series.name;
                        this.onSeriesClick(seriesName);
                      }
                    }
                  }
                }
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
    switch (county) {
      case 'all':
        return 'All Counties';

      case 'maui':
        return 'Maui County';

      case 'hawaii':
        return 'Hawaiʻi';

      case 'oahu':
        return 'Oʻahu';

      case 'kauai':
        return 'Kauaʻi';

      case 'molokai':
        return 'Molokaʻi';

      default:
        return county;
    }
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

  chartCallback: Highcharts.ChartCallbackFunction = (chart) => {
    this.chartRef = chart;

    setTimeout(() => {
      chart.reflow();
      chart.redraw(false);
    }, 0);
  };

  windChartCallback: Highcharts.ChartCallbackFunction = (chart) => {
    this.windChartRef = chart;

    setTimeout(() => {
      chart.reflow();
      chart.redraw(false);
    }, 0);
  };

  private syncExtremes(
    sourceChart: Highcharts.Chart,
    targetChart: Highcharts.Chart,
    e: Highcharts.AxisSetExtremesEventObject
  ): void {
    if (!targetChart?.xAxis?.[0]) return;

    // prevent recursive loop
    if ((e as any).trigger === 'syncExtremes') return;

    targetChart.xAxis[0].setExtremes(
      e.min,
      e.max,
      true,
      false,
      { trigger: 'syncExtremes' } as any
    );
  }
}

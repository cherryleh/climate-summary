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
type CountyFilter = 'all' | 'maui' | 'hawaii'  | 'honolulu' | 'kauai';

interface RainStats {
  date: string;
  min: string;
  avg: string;
  max: string;
}

interface CountyStats {
  daily: RainStats;
  cumulative: RainStats;
}

interface SelectedDayStats extends CountyStats {
  text: string;
}

interface StormDay {
  label: string;
  date: string;
  statsByCounty: Partial<Record<CountyFilter, CountyStats>>;
}

@Component({
  selector: 'app-storm-viewer-march2026-2',
  standalone: true,
  imports: [
    CommonModule,
    HighchartsChartModule,
    FormsModule
  ],
  templateUrl: './storm-viewer-march2026-2.component.html',
  styleUrl: './storm-viewer-march2026-2.component.css'
})

export class StormViewerMarch20262Component {
  Highcharts: typeof Highcharts = Highcharts;

  updateFlag = false;
  isChartLoading = false;

  windUpdateFlag = false;
  isWindChartLoading = false;
  selectedCounty: CountyFilter = 'all';
  selectedSeriesId: string | null = null;

  chartRef?: Highcharts.Chart;
  windChartRef?: Highcharts.Chart;

  // private readonly stationColors = [
  //   '#1f77b4', '#d62728', '#2ca02c', '#9467bd', '#ff7f0e',
  //   '#17becf', '#8c564b', '#e377c2', '#7f7f7f', '#bcbd22'
  // ];

  // private stationColorMap: Record<string, string> = {};

  // chartOptions: Highcharts.Options = {
  //   chart: {
  //     height: 400,
  //     zooming: { type: 'x' }
  //   },
  //   title: { text: 'Mesonet Station Rainfall' },
  //   credits: { enabled: false },
  //   xAxis: {
  //     type: 'datetime',
  //     title: { text: 'Time' },
  //     events: {
  //       setExtremes: (e) => {
  //         if (this.chartRef && this.windChartRef) {
  //           this.syncExtremes(this.chartRef, this.windChartRef, e);
  //         }
  //       }
  //     }
  //   },
  //   yAxis: {
  //     title: { text: 'Rainfall (in)' }
  //   },
  //   tooltip: {
  //     shared: false,
  //     xDateFormat: '%b %e, %Y %I:%M',
  //     pointFormat: 'Station ID#{series.name}: <b>{point.y:.2f} in</b>',

  //   },
  //   legend: {
  //     enabled: false
  //   },
  //   plotOptions: {
  //     series: {
  //       stickyTracking: true,
  //       marker: { enabled: false,
  //         states: {
  //         hover: {
  //           enabled: true,
  //           radius: 6,
  //           radiusPlus: 6
  //         }
  //        },},
  //       turboThreshold: 0,
  //       lineWidth: 1,
  //       animation: false,

  //       point: {
  //         events: {
  //           click: (event) => {
  //             const seriesName = event.point.series.name;
  //             this.onSeriesClick(seriesName);
  //           }
  //         }
  //       }
  //     }
  //   },
  //   series: []
  // };

  onSeriesClick(seriesId: string) {
    this.selectedSeriesId = seriesId;
  }

  // windChartOptions: Highcharts.Options = {
  //   chart: {
  //     height: 400,
  //     zooming: { type: 'x' }
  //   },
  //   title: { text: 'Mesonet Station Wind Gust' },
  //   credits: { enabled: false },
  //   xAxis: {
  //     type: 'datetime',
  //     title: { text: 'Time' },
  //     events: {
  //       setExtremes: (e) => {
  //         if (this.windChartRef && this.chartRef) {
  //           this.syncExtremes(this.windChartRef, this.chartRef, e);
  //         }
  //       }
  //     }
  //   },
  //   yAxis: {
  //     title: { text: 'Wind Gust (mph)' }
  //   },
  //   tooltip: {
  //     shared: false,
  //     xDateFormat: '%b %e, %Y %I:%M',
  //     pointFormat: 'Station ID #{series.name}: <b>{point.y:.2f} mph</b>'
  //   },
  //   legend: {
  //     enabled: false
  //   },
  //   plotOptions: {
  //     series: {
  //       stickyTracking: true,
  //       marker: { enabled: false },
  //       turboThreshold: 0,
  //       lineWidth: 1,
  //       animation: false,
  //       point: {
  //         events: {
  //           click: (event) => {
  //             const seriesName = event.point.series.name;
  //             this.onSeriesClick(seriesName);
  //           }
  //         }
  //       }
  //     }
  //   },
  //   series: []
  // };

  mode: StormMode = 'daily';
  selectedDayIndex = 0;

  isPlaying = false;
  playbackMs = 1200;
  private playInterval: ReturnType<typeof setInterval> | null = null;

  days: StormDay[] = [
    {
      label: 'Day 1',
      date: '2026_03_17',
      statsByCounty: {
        all: {
          daily: {date: 'March 17, 2026', min: '0.0 in', avg: '0.8 in', max: '5.7 in'},
          cumulative: {date: 'March 17, 2026', min: '0.0 in', avg: '0.8 in', max: '5.7 in'}
        },
        maui: {
          daily: { date: 'March 17, 2026', min: '0.1 in', avg: '0.7 in', max: '2.8 in'},
          cumulative: { date: 'March 17, 2026', min: '0.1 in', avg: '0.7 in', max: '2.8 in'}
        },
        hawaii: {
          daily: { date: 'March 17, 2026', min: '0.1 in', avg: '1.1 in', max: '5.7 in'},
          cumulative: { date: 'March 17, 2026', min: '0.1 in', avg: '1.1 in', max: '5.7 in'}
        },
        honolulu: {
          daily: { date: 'March 17, 2026', min: '0.0 in', avg: '0.2 in', max: '0.7 in'},
          cumulative: { date: 'March 17, 2026', min: '0.0 in', avg: '0.2 in', max: '0.7 in'}
        },
        kauai: {
          daily: { date: 'March 17, 2026', min: '0.0 in', avg: '0.1 in', max: '0.3 in'},
          cumulative: { date: 'March 17, 2026', min: '0.0 in', avg: '0.1 in', max: '0.3 in'}
        }
      }
    },
    {
      label: 'Day 2',
      date: '2026_03_18',
      statsByCounty: {
        all: {
          daily: {date: 'March 18, 2026', min: '0.0 in', avg: '0.1 in', max: '1.0 in'},
          cumulative: {date: 'March 18, 2026', min: '0.0 in', avg: '1.0 in', max: '5.8 in'}
        },
        maui: {
          daily: { date: 'March 18, 2026', min: '0.0 in', avg: '0.0 in', max: '0.4 in'},
          cumulative: { date: 'March 18, 2026', min: '0.1 in', avg: '0.8 in', max: '3.0 in'}
        },
        hawaii: {
          daily: { date: 'March 18, 2026', min: '0.0 in', avg: '0.2 in', max: '1.0 in'},
          cumulative: { date: 'March 18, 2026', min: '0.1 in', avg: '1.3 in', max: '5.8 in'}
        },
        honolulu: {
          daily: { date: 'March 18, 2026', min: '0.0 in', avg: '0.0 in', max: '0.7 in'},
          cumulative: { date: 'March 18, 2026', min: '0.0 in', avg: '0.3 in', max: '1.0 in'}
        },
        kauai: {
          daily: { date: 'March 18, 2026', min: '0.0 in', avg: '0.0 in', max: '0.1 in'},
          cumulative: { date: 'March 18, 2026', min: '0.0 in', avg: '0.1 in', max: '0.3 in'}
        }
      }
    },
    {
      label: 'Day 3',
      date: '2026_03_19',
      statsByCounty: {
        all: {
          daily: {date: 'March 19, 2026', min: '0.0 in', avg: '0.5 in', max: '8.9 in'},
          cumulative: {date: 'March 19, 2026', min: '0.0 in', avg: '1.5 in', max: '9.1 in'}
        },
        maui: {
          daily: { date: 'March 19, 2026', min: '0.0 in', avg: '0.5 in', max: '2.1 in'},
          cumulative: { date: 'March 19, 2026', min: '0.2 in', avg: '1.2 in', max: '5.1 in'}
        },
        hawaii: {
          daily: { date: 'March 19, 2026', min: '0.0 in', avg: '0.1 in', max: '0.6 in'},
          cumulative: { date: 'March 19, 2026', min: '0.1 in', avg: '1.4 in', max: '5.8 in'}
        },
        honolulu: {
          daily: { date: 'March 19, 2026', min: '0.3 in', avg: '2.1 in', max: '8.9 in'},
          cumulative: { date: 'March 19, 2026', min: '0.4 in', avg: '2.3 in', max: '9.1 in'}
        },
        kauai: {
          daily: { date: 'March 19, 2026', min: '0.1 in', avg: '1.6 in', max: '3.4 in'},
          cumulative: { date: 'March 19, 2026', min: '0.0 in', avg: '1.6 in', max: '3.7 in'}
        }
      }
    },
    {
      label: 'Day 4',
      date: '2026_03_20',
      statsByCounty: {
        all: {
          daily: {date: 'March 20, 2026', min: '0.0 in', avg: '1.0 in', max: '13.1 in'},
          cumulative: {date: 'March 20, 2026', min: '0.1 in', avg: '2.4 in', max: '22.1 in'}
        },
        maui: {
          daily: { date: 'March 20, 2026', min: '0.1 in', avg: '1.4 in', max: '8.1 in'},
          cumulative: { date: 'March 20, 2026', min: '0.5 in', avg: '2.6 in', max: '10.9 in'}
        },
        hawaii: {
          daily: { date: 'March 20, 2026', min: '0.0 in', avg: '0.1 in', max: '0.3 in'},
          cumulative: { date: 'March 20, 2026', min: '0.1 in', avg: '1.5 in', max: '5.8 in'}
        },
        honolulu: {
          daily: { date: 'March 20, 2026', min: '2.3 in', avg: '6.5 in', max: '13.1 in'},
          cumulative: { date: 'March 20, 2026', min: '3.0 in', avg: '8.7 in', max: '22.1 in'}
        },
        kauai: {
          daily: { date: 'March 20, 2026', min: '0.0 in', avg: '0.2 in', max: '0.6 in'},
          cumulative: { date: 'March 20, 2026', min: '0.2 in', avg: '1.9 in', max: '4.2 in'}
        }
      }
    },
    {
      label: 'Day 5',
      date: '2026_03_21',
      statsByCounty: {
        all: {
          daily: {date: 'March 21, 2026', min: '0.0 in', avg: '0.8 in', max: '9.6 in'},
          cumulative: {date: 'March 21, 2026', min: '0.2 in', avg: '3.3 in', max: '23.7 in'}
        },
        maui: {
          daily: { date: 'March 21, 2026', min: '0.4 in', avg: '3.2 in', max: '9.6 in'},
          cumulative: { date: 'March 21, 2026', min: '1.3 in', avg: '5.8 in', max: '20.5 in'}
        },
        hawaii: {
          daily: { date: 'March 21, 2026', min: '0.0 in', avg: '0.2 in', max: '2.0 in'},
          cumulative: { date: 'March 21, 2026', min: '0.2 in', avg: '1.7 in', max: '6.1 in'}
        },
        honolulu: {
          daily: { date: 'March 21, 2026', min: '0.1 in', avg: '1.0 in', max: '3.0 in'},
          cumulative: { date: 'March 21, 2026', min: '3.5 in', avg: '9.7 in', max: '23.7 in'}
        },
        kauai: {
          daily: { date: 'March 21, 2026', min: '0.0 in', avg: '0.0 in', max: '0.0 in'},
          cumulative: { date: 'March 21, 2026', min: '0.2 in', avg: '1.9 in', max: '4.2 in'}
        }
      }
    },
    {
      label: 'Day 6',
      date: '2026_03_22',
      statsByCounty: {
        all: {
          daily: {date: 'March 22, 2026', min: '0.0 in', avg: '0.6 in', max: '8.9 in'},
          cumulative: {date: 'March 22, 2026', min: '0.3 in', avg: '3.9 in', max: '23.8 in'}
        },
        maui: {
          daily: { date: 'March 22, 2026', min: '0.0 in', avg: '1.3 in', max: '8.9 in'},
          cumulative: { date: 'March 22, 2026', min: '1.4 in', avg: '7.2 in', max: '21.5 in'}
        },
        hawaii: {
          daily: { date: 'March 22, 2026', min: '0.0 in', avg: '0.5 in', max: '1.5 in'},
          cumulative: { date: 'March 22, 2026', min: '0.3 in', avg: '2.2 in', max: '6.6 in'}
        },
        honolulu: {
          daily: { date: 'March 22, 2026', min: '0.0 in', avg: '0.3 in', max: '1.6 in'},
          cumulative: { date: 'March 22, 2026', min: '3.6 in', avg: '10.0 in', max: '23.8 in'}
        },
        kauai: {
          daily: { date: 'March 22, 2026', min: '0.0 in', avg: '0.1 in', max: '0.5 in'},
          cumulative: { date: 'March 22, 2026', min: '0.3 in', avg: '2.0 in', max: '4.4 in'}
        }
      }
    },
    {
      label: 'Day 7',
      date: '2026_03_23',
      statsByCounty: {
        all: {
          daily: {date: 'March 23, 2026', min: '0.0 in', avg: '0.7 in', max: '7.3 in'},
          cumulative: {date: 'March 23, 2026', min: '0.3 in', avg: '4.6 in', max: '28.0 in'}
        },
        maui: {
          daily: { date: 'March 23, 2026', min: '0.0 in', avg: '1.0 in', max: '6.7 in'},
          cumulative: { date: 'March 23, 2026', min: '1.5 in', avg: '8.2 in', max: '28.0 in'}
        },
        hawaii: {
          daily: { date: 'March 23, 2026', min: '0.0 in', avg: '0.6 in', max: '7.3 in'},
          cumulative: { date: 'March 23, 2026', min: '0.4 in', avg: '2.8 in', max: '9.2 in'}
        },
        honolulu: {
          daily: { date: 'March 23, 2026', min: '0.0 in', avg: '1.3 in', max: '7.0 in'},
          cumulative: { date: 'March 23, 2026', min: '3.6 in', avg: '11.3 in', max: '27.4 in'}
        },
        kauai: {
          daily: { date: 'March 23, 2026', min: '0.0 in', avg: '0.1 in', max: '2.3 in'},
          cumulative: { date: 'March 23, 2026', min: '0.3 in', avg: '2.1 in', max: '4.5 in'}
        }
      }
    }
  ];

  get selectedStats() {
    const day = this.selectedDay;

    const stats =
      day.statsByCounty[this.selectedCounty] ||
      day.statsByCounty['all'] || {
        daily: { date: '', min: '--', avg: '--', max: '--' },
        cumulative: { date: '', min: '--', avg: '--', max: '--' }
      };

    return {
      ...stats,
    };
  }

  get selectedDay() {
    return this.days[this.selectedDayIndex];
  }


  selectDay(i: number) {
    this.selectedDayIndex = i;
  }

  toggleMode() {
    this.mode = this.mode === 'daily' ? 'cumulative' : 'daily';
    // this.loadStormChart();
  }

  onCountyChange() {
    // this.loadAllCharts();
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

      case 'honolulu':
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
      case 'honolulu':
        return 'Oa';
      case 'maui':
        return 'Ma';
      case 'kauai':
        return 'Ka';
      default:
        return null;
    }
  }

  get imagePath() {
    const base = this.selectedDay.date;
    const countySuffix = this.getCountyImageSuffix(this.selectedCounty);

    // all counties
    if (!countySuffix) {
      return this.mode === 'daily'
        ? `storm_site/storm-march2026-2/${base}.png`
        : `storm_site/storm-march2026-2/${base}_cumulative.png`;
    }

    // county-specific
    return this.mode === 'daily'
      ? `storm_site/storm-march2026-2/county/${base}_${countySuffix}.png`
      : `storm_site/storm-march2026-2/county/${base}_cumulative_${countySuffix}.png`;
  }


  formatCountyName(county: CountyFilter): string {
    switch (county) {
      case 'all':
        return 'Statewide';

      case 'maui':
        return 'Maui County';

      case 'hawaii':
        return 'Hawaiʻi';

      case 'honolulu':
        return 'Honolulu';

      case 'kauai':
        return 'Kauaʻi';

      default:
        return county;
    }
  }


  chartCallback: Highcharts.ChartCallbackFunction = (chart) => {
    this.chartRef = chart;

    setTimeout(() => {
      chart.reflow();
      chart.redraw(false);
    }, 0);
  };

  // windChartCallback: Highcharts.ChartCallbackFunction = (chart) => {
  //   this.windChartRef = chart;

  //   setTimeout(() => {
  //     chart.reflow();
  //     chart.redraw(false);
  //   }, 0);
  // };



  getSelectedSeriesCode(): string {
    if (!this.selectedSeriesId) return '';

    const match = this.selectedSeriesId.trim().match(/(\d{4})$/);
    return match ? match[1] : '';
  }

  twoStormStats: Record<CountyFilter, RainStats> = {
    all: { date: 'March 10 - 23, 2026', min: '2.2 in', avg: '17.6 in', max: '76.0 in' },
    maui: { date: 'March 10 - 23, 2026', min: '12.1 in', avg: '25.4 in', max: '76.0 in' },
    hawaii: { date: 'March 10 - 23, 2026', min: '5.6 in', avg: '15.1 in', max: '34.8 in' },
    honolulu: { date: 'March 10 - 23, 2026', min: '13.4 in', avg: '24.2 in', max: '54.5 in' },
    kauai: { date: 'March 10 - 23, 2026', min: '2.2 in', avg: '12.1 in', max: '26.2 in' }
  };

  get selectedTwoStormStats() {
    return this.twoStormStats[this.selectedCounty] || this.twoStormStats['all'];
  }

  get allDaysImagePath() {
    const countySuffix = this.getCountyImageSuffix(this.selectedCounty);

    // Statewide / All Counties
    if (!countySuffix) {
      return `storm_site/storm-march2026-2/all_days/all_days_cumulative.png`;
    }

    // County-specific
    return `storm_site/storm-march2026-2/all_days/all_days_cumulative_${countySuffix}.png`;
  }
}

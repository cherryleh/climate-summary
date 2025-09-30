// src/app/spi-highchart/spi-highchart.component.ts
import { Component, Input, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import * as Highcharts from 'highcharts';
import { HighchartsChartModule } from 'highcharts-angular';

@Component({
  selector: 'app-data-highchart',
  standalone: true,
  imports: [CommonModule, HighchartsChartModule],
  template: `
  <highcharts-chart
    [Highcharts]="Highcharts"
    [options]="chartOptions"
    [(update)]="updateFlag"
    style="width:100%; height:400px; display:block;"
  ></highcharts-chart>

  `
})
export class DataHighchartComponent implements OnChanges {
  @Input() data: { month: string; value: number }[] = [];
  @Input() dataset: string = '';
  @Input() multiSeries: { scale: number; data: { month: string; value: number }[] }[] = [];

  @Input() unit: string = '';

  Highcharts: typeof Highcharts = Highcharts;
  chartOptions: Highcharts.Options = {
    chart: { height: 300 },
    title: { text: '' },
    xAxis: { categories: [] },
    yAxis: {
      min: -3,
      max: 3,
      tickInterval: 1,
      title: { text: 'SPI' }
    },
    tooltip: {
      valueDecimals: 2   
    },
    legend: { enabled: false },
    series: []
  };
  updateFlag = false;

  ngOnChanges(changes: SimpleChanges) {
    if (changes['data'] || changes['unit'] || changes['multiSeries']) {
      this.updateChart();
    }
  }

  

  private updateChart() {
    const isSPI = this.dataset === 'Drought';
    const isTemp = this.dataset === 'Temperature';

    console.log('=== updateChart called ===');
    console.log('dataset:', this.dataset);
    console.log('multiSeries:', this.multiSeries);
    console.log('data:', this.data);

    let categories: string[] = [];
    let series: Highcharts.SeriesOptionsType[] = [];

    if (isSPI && this.multiSeries.length > 0) {
      // Collect all unique months across scales
      categories = Array.from(
        new Set(this.multiSeries.flatMap(s => s.data.map(d => d.month)))
      ).sort();

      console.log('SPI categories:', categories);

      series = this.multiSeries.map(s => {
        const valueMap = new Map(s.data.map(d => [d.month, d.value]));
        const aligned = categories.map(m => {
          const v = valueMap.get(m);
          return v != null ? Number(v.toFixed(2)) : null;
        });

        console.log(`Series SPI-${s.scale}`, aligned);

        return {
          name: `SPI-${s.scale}`,
          type: 'line',
          data: aligned
        };
      });
    } else {
      categories = this.data.map(d => d.month);
      console.log('Non-SPI categories:', categories);

      series = [
        {
          name: this.unit,
          type: this.dataset === 'Rainfall' ? 'column' : 'line',
          data: this.data.map(d => Number(d.value.toFixed(2)))
        }
      ];
      console.log('Series (non-SPI):', series);
    }

    console.log('Final series passed to Highcharts:', series);

    this.chartOptions = JSON.parse(JSON.stringify({
      chart: { height: 300 },
      legend: { enabled: true },
      title: { text: '' },
      xAxis: { categories, title: { text: 'Month' } },
      yAxis: {
        min: isSPI ? -3 : undefined,
        max: isSPI ? 3 : undefined,
        tickInterval: isSPI ? 1 : undefined,
        title: { text: isSPI ? 'SPI' : this.unit },
        plotBands: isSPI
          ? [
              {
                from: -3,
                to: -1,
                color: 'rgba(255,0,0,0.2)',
                label: { text: 'Dry', style: { color: '#600' } }
              }
            ]
          : []
      },
      series
    }));
    this.updateFlag = true;
  }
}

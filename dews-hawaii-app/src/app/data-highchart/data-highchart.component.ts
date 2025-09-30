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
      style="width:100%; height:400px; display:block;"
    ></highcharts-chart>
  `
})
export class DataHighchartComponent implements OnChanges {
  @Input() data: { month: string; value: number }[] = [];
  @Input() unit: string = '';
  @Input() title: string = '';

  Highcharts: typeof Highcharts = Highcharts;
  chartOptions: Highcharts.Options = {
    chart: { type: 'line', height: 300 },
    title: { text: 'SPI Time Series' },
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
    series: []
  };

  ngOnChanges(changes: SimpleChanges) {
    if (changes['data'] || changes['unit']) {
      this.updateChart();
    }
  }

  private updateChart() {
    const isSPI = this.unit === 'SPI';

    this.chartOptions = {
      ...this.chartOptions,
      chart: { type: isSPI ? 'line' : 'column', height: 300 }, 
      title: { text: this.title || (isSPI ? 'Drought Time Series' : 'Rainfall Time Series') },
      xAxis: {
        categories: this.data.map(d => d.month),
        title: { text: 'Month' }
      },
      yAxis: {
        min: isSPI ? -3 : undefined,
        max: isSPI ? 3 : undefined,
        tickInterval: isSPI ? 1 : undefined,
        title: { text: this.unit || '' },
        plotBands: isSPI ? [
          {
            from: -3,
            to: -1,
            color: 'rgba(255,0,0,0.2)',
            label: { text: 'Dry', style: { color: '#600' } }
          }
        ] : []
      },
      series: [
        {
          name: isSPI ? 'SPI' : 'Rainfall',
          type: isSPI ? 'line' : 'column', 
          data: this.data.map(d => Number(d.value.toFixed(2))),
        }
      ]
    };
  }



}

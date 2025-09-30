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
    this.chartOptions = {
      ...this.chartOptions,
      xAxis: {
        categories: this.data.map(d => d.month),
        title: { text: 'Month' }
      },
      yAxis: {
        min: -3,
        max: 3,
        tickInterval: 1,
        title: { text: this.unit || 'SPI' }
      },
      series: [
        {
          name: 'SPI',
          type: 'line',
          data: this.data.map(d => Number(d.value.toFixed(2))),
          color: '#0ea5e9'
        }
      ]
    };
  }
}

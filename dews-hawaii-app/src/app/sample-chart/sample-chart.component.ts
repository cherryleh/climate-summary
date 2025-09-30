// src/app/sample-chart/sample-chart.component.ts
import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import * as Highcharts from 'highcharts';
import { HighchartsChartModule } from 'highcharts-angular';

@Component({
  selector: 'app-sample-chart',
  standalone: true,
  imports: [CommonModule, HighchartsChartModule],
  template: `
    <div class="chart-container">
      <highcharts-chart
        [Highcharts]="Highcharts"
        [options]="chartOptions"
        style="width: 100%; height: 400px; display: block;"
      ></highcharts-chart>
    </div>
  `,
})
export class SampleChartComponent {
  Highcharts: typeof Highcharts = Highcharts;

  chartOptions: Highcharts.Options = {
    chart: {
      type: 'line',
    },
    title: {
      text: 'Sample Highchart in Angular',
    },
    xAxis: {
      categories: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'],
    },
    yAxis: {
      title: { text: 'Values' },
    },
    series: [
      {
        name: 'Demo Series',
        type: 'line',
        data: [1, 3, 2, 4, 6, 5],
      },
    ],
  };
}

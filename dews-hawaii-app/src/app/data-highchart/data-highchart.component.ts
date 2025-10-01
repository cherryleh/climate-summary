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
    let categories: string[] = [];
    let series: Highcharts.SeriesOptionsType[] = [];

    if (isSPI && this.multiSeries.length > 0) {
      categories = Array.from(
        new Set(this.multiSeries.flatMap(s => s.data.map(d => d.month)))
      ).sort();

      // Define custom labels for each SPI scale
      const spiLabels: Record<number, string> = {
        1: 'Short-term Drought',
        6: 'Medium-term Drought',
        12: 'Long-term Drought'
      };

        series = this.multiSeries.map((s, i) => {
        const valueMap = new Map(s.data.map(d => [d.month, d.value]));
        const aligned = categories.map(m => {
          const v = valueMap.get(m);
          return v != null ? Number(v.toFixed(2)) : null;
        });

        // Gradient-like colors for short, medium, long drought
        const gradientColors = [
          '#74add1', // bluish (short-term)
          '#fdae61', // orange (medium-term)
          '#d73027'  // red (long-term)
        ];

      return {
          name: spiLabels[s.scale] ?? `SPI-${s.scale}`,
          type: 'line',
          data: aligned,
          color: gradientColors[i % gradientColors.length], // pick from palette
          marker: { enabled: false },
          lineWidth: 2
        };
      });
    } else {
      categories = this.data.map(d => d.month);

      series = [
        {
          name: this.unit,
          type: this.dataset === 'Rainfall' ? 'column' : 'line',
          data: this.data.map(d => Number(d.value.toFixed(2))),
          marker: { enabled: false }
        }
      ];
    }

    this.chartOptions = JSON.parse(JSON.stringify({
      chart: { height: 300 },
      legend: { enabled: isSPI },
      title: { text: '' },
      xAxis: { categories, title: { text: 'Month' } },
      yAxis: {
        min: isSPI ? -2 : undefined,
        max: isSPI ? 2 : undefined,
        tickInterval: isSPI ? 1 : undefined,
        title: { text: isSPI ? 'SPI' : this.unit },
        plotBands: isSPI
          ? [
              {
                from: -3,
                to: -1,
                color: 'rgba(255,0,0,0.2)',
                label: {
                  text: 'Drought',
                  align: 'center',
                  verticalAlign: 'top',
                  y: 30,
                  style: { color: '#600', fontSize: '14px', fontWeight: 'bold' }
                }
              }
            ]
          : []
      },
      series
    }));
    this.updateFlag = true;
  }

}

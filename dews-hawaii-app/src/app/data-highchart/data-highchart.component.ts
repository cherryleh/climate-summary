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
    [oneToOne]="true"
    style="width:100%; height:100%; display:block;"
  ></highcharts-chart>
  `
})
export class DataHighchartComponent implements OnChanges {
  @Input() data: any[] = []; // Changed to any to support distribution keys
  @Input() dataset: string = '';
  @Input() multiSeries: { scale: number; data: { month: string; value: number }[] }[] = [];
  @Input() unit: string = '';

  Highcharts: typeof Highcharts = Highcharts;
  chartOptions: Highcharts.Options = {};
  updateFlag = false;

  ngOnChanges(changes: SimpleChanges) {
    if (changes['data'] || changes['unit'] || changes['dataset']) {
      this.updateChart();
    }
  }

  private updateChart() {
    const isSPI = this.dataset === 'Drought';
    let categories: string[] = [];
    let series: Highcharts.SeriesOptionsType[] = [];

    const isDistribution = isSPI && this.data.length > 0 && ('D4 Exceptional Drought' in this.data[0]);

    if (isDistribution) {
      categories = this.data.map(d => d.month);
      const config = [
        // Drought categories (Factor 1 = Above the line)
        { name: 'D0 Abnormally Dry', color: '#FFFF00', factor: 1 },
        { name: 'D1 Moderate Drought', color: '#FFD37F', factor: 1 },
        { name: 'D2 Severe Drought', color: '#FF9900', factor: 1 },
        { name: 'D3 Extreme Drought', color: '#FF0000', factor: 1 },
        { name: 'D4 Exceptional Drought', color: '#730000', factor: 1 },

        // Wet categories (Factor -1 = Below the line)
        { name: 'W0 Abnormally Wet', color: '#99CCFF', factor: -1 },
        { name: 'W1 Moderately Wet', color: '#0066CC', factor: -1 },
        { name: 'W2 Severely Wet', color: '#0066CC', factor: -1 },
        { name: 'W3 Extremely Wet', color: '#003366', factor: -1 },
        { name: 'W4 Exceptionally Wet', color: '#001933', factor: -1 }
      ];

      series = config.map(c => ({
        name: c.name,
        type: 'area',
        color: c.color,
        data: this.data.map(d => {
            const val = parseFloat((d as any)[c.name] || '0');
            return Number((val * c.factor).toFixed(2));
        }),
        stack: c.factor > 0 ? 'drought' : 'wet'
      }));

    } else {
      categories = this.data.map(d => d.month);

      const seriesColor = this.dataset === 'Rainfall' ? '#7cb5ec' : '#ff4d4d';

      series = [{
        name: this.unit,
        type: this.dataset === 'Rainfall' ? 'column' : 'line',
        data: this.data.map(d => Number(d.value?.toFixed(2) || 0)),
        color: seriesColor,
        marker: { enabled: false }
      }];
    }

    this.chartOptions = {
      chart: {
        height: '47%',
        type: isDistribution ? 'area' : undefined
      },
      title: { text: '' },
      xAxis: {
        categories,
        title: { text: undefined },
        tickmarkPlacement: 'on'
      },
      yAxis: {
        title: { text: isDistribution ? 'Area (%)' : (isSPI ? 'SPI' : this.unit) },
        labels: {
          formatter: function() {
            // Shows positive percentage regardless of being above or below 0
            return isDistribution ? Math.abs(Number(this.value)) + '%' : this.value.toString();
          }
        }
      },
      tooltip: {
        shared: true,
        valueDecimals: 2,
        formatter: isDistribution ? function(this: any) {
          let s = `<b>${this.x}</b>`;
          // Sort points so they appear in the tooltip top-to-bottom as they appear on the graph
          const sortedPoints = [...this.points].sort((a, b) => b.y - a.y);
          sortedPoints.forEach((p: any) => {
            if (p.y !== 0) {
              s += `<br/><span style="color:${p.color}">\u25CF</span> ${p.series.name}: ${Math.abs(p.y)}%`;
            }
          });
          return s;
        } : undefined
      },
      plotOptions: {
        area: {
          stacking: 'normal',
          lineWidth: 1,
          marker: { enabled: false },
          threshold: 0 // This ensures positive values stack up and negative stack down
        },
        column: { borderWidth: 0 }
      },
      subtitle: {
        text: isDistribution ? 'Hover over the chart to see specific area percentages' : '',
        align: 'center',
        style: {
          color: '#666666',
          fontSize: '12px',
          fontStyle: 'italic'
        }
      },
      legend: {
        enabled: false
      },
      series: series
    };

    setTimeout(() => {
      this.updateFlag = true;
    }, 0);
  }
}

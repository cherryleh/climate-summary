import { Component } from '@angular/core';
import { NgFor } from '@angular/common';

type MapMode = 'total' | 'pon' | 'anom';

@Component({
  selector: 'app-climate-summary-2025',
  standalone: true,
  imports: [NgFor],
  templateUrl: './climate-summary-2025.component.html',
  styleUrls: ['./climate-summary-2025.component.css'],
})

export class ClimateSummary2025Component {
  
  readonly tabs: { key: MapMode; label: string }[] = [
    { key: 'total', label: 'Total rainfall' },
    { key: 'pon',   label: 'Percent of normal' },
    { key: 'anom',  label: 'Anomaly' },
  ];

 

  rainfallMode: MapMode = 'total';
  temperatureMode: MapMode = 'total';

  readonly modeLabel: Record<MapMode, string> = {
    total: 'Total',
    pon: 'Percent of normal',
    anom: 'Anomaly',
  };

  readonly rainfallSrc: Record<MapMode, string> = {
    total: '/climate-summary/annual_rainfall_2024_agg.png',
    pon: '/climate-summary/annual_rainfall_2024_pnormal.png',
    anom: '/climate-summary/annual_rainfall_2024_anomaly.png',
  };
  
  readonly rainfallLegendTitle: Record<MapMode, string> = {
    total: 'Total rainfall (in)',
    pon:   'Percent of normal (%)',
    anom:  'Anomaly (in)',
  };

  readonly rainfallLegendTicks: Record<MapMode, string[]> = {
    total: ['0', '300'],
    pon:   ['0', '100'],
    anom:  ['-120', '0', '120'],
  };

  readonly rainfallLegendUnit: Record<MapMode, string> = {
    total: 'in',
    pon:   '%',
    anom:  'in',
  };

  // CSS linear-gradients you can apply directly to the existing .legend-bar div
  readonly rainfallLegendGradient: Record<MapMode, string> = {
    // viridis
    total: 'linear-gradient(90deg, #440154 0%, #3b528b 25%, #21918c 50%, #5ec962 75%, #fde725 100%)',
    // RdBu
    pon:   'linear-gradient(90deg, #2166ac 0%, #f7f7f7 50%, #b2182b 100%)',
    anom:  'linear-gradient(90deg, #2166ac 0%, #f7f7f7 50%, #b2182b 100%)',
  };


  readonly temperatureSrc: Partial<Record<MapMode, string>> = {
    total: '/climate-summary/annual_tmean_2024_agg.png',
    anom:  '/climate-summary/annual_tmean_2024_anomaly.png',
  };


  setRainfallMode(mode: MapMode) { this.rainfallMode = mode; }
  setTemperatureMode(mode: MapMode) { this.temperatureMode = mode; }


}
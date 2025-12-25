import { Component } from '@angular/core';

type MapMode = 'total' | 'pon' | 'anom';

@Component({
  selector: 'app-climate-summary-2025',
  templateUrl: './climate-summary-2025.component.html',
  styleUrls: ['./climate-summary-2025.component.css'],
})

export class ClimateSummary2025Component {
  readonly tabs: { key: MapMode; label: string }[] = [
    { key: 'total', label: 'Total rainfall' },
    { key: 'pon',   label: 'Percent of normal' },
    { key: 'anom',  label: 'Anomaly' },
  ];

  // quick label map so we don’t “find” in the template
  readonly modeLabel: Record<MapMode, string> = {
    total: 'Total rainfall',
    pon: 'Percent of normal',
    anom: 'Anomaly',
  };

  rainfallMode: MapMode = 'total';
  temperatureMode: MapMode = 'total';

  readonly rainfallSrc: Record<MapMode, string> = {
    total: '/climate-summary/annual_rainfall_2024_agg.png',
    pon:   '/climate-summary/annual_rainfall_2024_percent_normal.png',
    anom:  '/climate-summary/annual_rainfall_2024_anomaly.png',
  };

  readonly temperatureSrc: Record<MapMode, string> = {
    total: '/climate-summary/annual_tmean_2024_agg.png',
    pon:   '/climate-summary/annual_tmean_2024_percent_normal.png',
    anom:  '/climate-summary/annual_tmean_2024_anomaly.png',
  };

  setRainfallMode(mode: MapMode): void {
    this.rainfallMode = mode;
  }

  setTemperatureMode(mode: MapMode): void {
    this.temperatureMode = mode;
  }

  // Optional: if you prefer building the alt text in TS:
  rainfallAlt(): string {
    return `Rainfall map: ${this.modeLabel[this.rainfallMode]}`;
  }

  temperatureAlt(): string {
    return `Temperature map: ${this.modeLabel[this.temperatureMode]}`;
  }
}
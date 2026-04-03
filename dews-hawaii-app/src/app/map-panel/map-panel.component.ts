import { Component, Input, Output, EventEmitter, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import type { Scope } from '../climate-dashboard/climate-dashboard.component';
type RasterRect = { x: number; y: number; width: number; height: number };
type Dataset = 'Rainfall' | 'Temperature' | 'Drought';

@Component({
  selector: 'app-map-panel',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './map-panel.component.html',
  styleUrls: ['./map-panel.component.css']
})
export class MapPanelComponent implements OnInit {
  // ===== Inputs =====
  @Input() selectedDataset!: Dataset;
  @Input() selectedScope!: string | null;
  @Input() selectedIsland!: string | null;
  @Input() selectedDivision!: string | null;
  @Input() viewMode!: 'islands' | 'divisions';
  @Input() rasterHref!: string | null;
  @Input() rasterRect!: RasterRect | null;
  @Input() islands: any[] = [];
  @Input() pathById!: Record<string, string>;
  @Input() centroidById!: Record<string, [number, number]>;
  @Input() selectionLabel: string | null = null;
  @Input() showDivisionDisclaimer: boolean = false;
  // ===== Outputs =====
  @Output() islandSelected = new EventEmitter<string>();
  @Output() divisionSelected = new EventEmitter<string | null>();
  @Output() resetSelection = new EventEmitter<void>();
  @Output() scopeSelected = new EventEmitter<Scope>();


  hoveredFeature = signal<string | null>(null);
  hoveredLabel = signal<{ name: string; x: number; y: number } | null>(null);

  ngOnInit() {}

  onHover(feature: any, event: MouseEvent) {
    const scope = this.selectedScope;
    if (scope === 'ahupuaa' || scope === 'watershed') {
      const svg = (event.target as SVGPathElement).ownerSVGElement!;
      const pt = svg.createSVGPoint();
      pt.x = event.clientX;
      pt.y = event.clientY;
      const screenCTM = svg.getScreenCTM();
      if (screenCTM) {
        const svgP = pt.matrixTransform(screenCTM.inverse());
        this.hoveredLabel.set({ name: feature.name, x: svgP.x, y: svgP.y });
      }
    }
    this.hoveredFeature.set(feature.name);
  }

  onLeave() {
    this.hoveredFeature.set(null);
    this.hoveredLabel.set(null);
  }

  pickIsland(name: string) {
    this.islandSelected.emit(name);
  }

  pickDivision(key: string) {
    this.divisionSelected.emit(key);
  }

  reset() {
    this.resetSelection.emit();
  }

  // ===== Styling helpers =====
  strokeColor(feature: any): string {
    if (
      (this.viewMode === 'divisions' && this.selectedDivision === feature.key) ||
      (this.viewMode === 'islands' && this.selectedIsland === feature.name)
    ) {
      return 'var(--primary)';
    }
    if (this.hoveredFeature() === feature.name) return '#6b7280';
    return '#9ca3af';
  }

  strokeWidth(feature: any): number {
    if (
      (this.viewMode === 'divisions' && this.selectedDivision === feature.key) ||
    (this.viewMode === 'islands' && this.selectedIsland === feature.name)
    ) {
      return 2;
    }
    return this.hoveredFeature() === feature.name ? 2 : 1;
  }

  filterGlow(feature: any): string | null {
    if (
      (this.viewMode === 'divisions' && this.selectedDivision === feature.key) ||
      (this.viewMode === 'islands' && this.selectedIsland === feature.name)
    ) {
      return 'url(#glow)';
    }
    return null;
  }

  // ===== Utility =====
  public getCountyForIsland(islandName: string): string {
    const COUNTY_BY_ISLAND: Record<string, string> = {
      'Kauaʻi': 'Kauaʻi',
      'Oʻahu': 'Honolulu',
      'Molokaʻi': 'Maui',
      'Lānaʻi': 'Maui',
      'Maui': 'Maui',
      'Kahoʻolawe': 'Maui',
      'Hawaiʻi': 'Hawaiʻi'
    };
    return COUNTY_BY_ISLAND[islandName] ?? islandName;
  }

  // Utility for *ngFor trackBy
  trackByIsle = (_: number, isle: any) => isle.id;
}

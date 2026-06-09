import { Component, Input, Output, EventEmitter, signal, OnInit, OnChanges, SimpleChanges, ElementRef, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import type { Scope } from '../climate-dashboard/climate-dashboard.component';
type RasterRect = { x: number; y: number; width: number; height: number };
type Dataset = 'Rainfall' | 'Temperature' | 'Drought';

const FULL_VIEWBOX = '-30 -5 490 320';
const ZOOM_SCOPES = new Set(['ahupuaa', 'watershed']);
const ZOOM_PAD = 40;

@Component({
  selector: 'app-map-panel',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './map-panel.component.html',
  styleUrls: ['./map-panel.component.css']
})
export class MapPanelComponent implements OnInit, OnChanges {
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

  @ViewChild('mapSvg') mapSvgRef!: ElementRef<SVGSVGElement>;

  hoveredFeature = signal<string | null>(null);
  hoveredLabel = signal<{ name: string; x: number; y: number } | null>(null);
  viewBox = FULL_VIEWBOX;

  ngOnInit() {}

  ngOnChanges(changes: SimpleChanges) {
    if (changes['selectedDivision'] || changes['selectedScope'] || changes['selectedIsland']) {
      this.updateViewBox();
    }
  }

  private updateViewBox() {
    const shouldZoom = this.selectedDivision && this.selectedScope && ZOOM_SCOPES.has(this.selectedScope);
    if (!shouldZoom) {
      this.viewBox = FULL_VIEWBOX;
      return;
    }
    // Defer until paths are rendered
    setTimeout(() => {
      if (!this.mapSvgRef) return;
      const svg = this.mapSvgRef.nativeElement;
      const paths = svg.querySelectorAll<SVGPathElement>('path[data-key]');
      let target: SVGPathElement | null = null;
      paths.forEach(p => { if (p.dataset['key'] === this.selectedDivision) target = p; });
      if (!target) return;
      const bb = (target as SVGPathElement).getBBox();
      if (bb.width < 1 && bb.height < 1) return;
      const x = bb.x - ZOOM_PAD;
      const y = bb.y - ZOOM_PAD;
      const w = bb.width + ZOOM_PAD * 2;
      const h = bb.height + ZOOM_PAD * 2;
      this.viewBox = `${x} ${y} ${w} ${h}`;
    }, 50);
  }

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

  fillColor(feature: any): string {
    if (this.hoveredFeature() === feature.name) return 'rgba(107, 114, 128, 0.15)';
    return 'transparent';
  }

  get isZoomed(): boolean {
    return this.viewBox !== FULL_VIEWBOX;
  }

  get zoomedRect(): { x: number; y: number; width: number; height: number } | null {
    if (!this.isZoomed) return null;
    const parts = this.viewBox.split(' ').map(Number);
    return { x: parts[0], y: parts[1], width: parts[2], height: parts[3] };
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

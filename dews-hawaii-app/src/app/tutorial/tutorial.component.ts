import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-tutorial',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './tutorial.component.html',
  styleUrl: './tutorial.component.css'
})
export class TutorialComponent {
  lightboxSrc: string | null = null;

  openLightbox(src: string) {
    this.lightboxSrc = src;
  }

  closeLightbox() {
    this.lightboxSrc = null;
  }
}

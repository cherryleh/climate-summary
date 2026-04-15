import { ComponentFixture, TestBed } from '@angular/core/testing';

import { StormViewerMarch20262Component } from './storm-viewer-march2026-2.component';

describe('StormViewerMarch20262Component', () => {
  let component: StormViewerMarch20262Component;
  let fixture: ComponentFixture<StormViewerMarch20262Component>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [StormViewerMarch20262Component]
    })
    .compileComponents();

    fixture = TestBed.createComponent(StormViewerMarch20262Component);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

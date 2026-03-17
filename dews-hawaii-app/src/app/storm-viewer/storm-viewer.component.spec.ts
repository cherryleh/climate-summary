import { ComponentFixture, TestBed } from '@angular/core/testing';

import { StormViewerComponent } from './storm-viewer.component';

describe('StormViewerComponent', () => {
  let component: StormViewerComponent;
  let fixture: ComponentFixture<StormViewerComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [StormViewerComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(StormViewerComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

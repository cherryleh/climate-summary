import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SampleChartComponent } from './sample-chart.component';

describe('SampleChartComponent', () => {
  let component: SampleChartComponent;
  let fixture: ComponentFixture<SampleChartComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SampleChartComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(SampleChartComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

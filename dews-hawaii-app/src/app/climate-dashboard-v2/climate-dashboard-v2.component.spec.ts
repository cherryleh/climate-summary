import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ClimateDashboardV2Component } from './climate-dashboard-v2.component';

describe('ClimateDashboardV2Component', () => {
  let component: ClimateDashboardV2Component;
  let fixture: ComponentFixture<ClimateDashboardV2Component>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ClimateDashboardV2Component]
    })
    .compileComponents();

    fixture = TestBed.createComponent(ClimateDashboardV2Component);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

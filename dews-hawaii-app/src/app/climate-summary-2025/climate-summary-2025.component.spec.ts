import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ClimateSummary2025Component } from './climate-summary-2025.component';

describe('ClimateSummary2025Component', () => {
  let component: ClimateSummary2025Component;
  let fixture: ComponentFixture<ClimateSummary2025Component>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ClimateSummary2025Component]
    })
    .compileComponents();

    fixture = TestBed.createComponent(ClimateSummary2025Component);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

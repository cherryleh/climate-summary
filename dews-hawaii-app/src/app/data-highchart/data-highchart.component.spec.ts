import { ComponentFixture, TestBed } from '@angular/core/testing';

import { DataHighchartComponent } from './data-highchart.component';

describe('DataHighchartComponent', () => {
  let component: DataHighchartComponent;
  let fixture: ComponentFixture<DataHighchartComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DataHighchartComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(DataHighchartComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

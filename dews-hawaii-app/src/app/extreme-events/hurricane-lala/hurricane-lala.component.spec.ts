import { ComponentFixture, TestBed } from '@angular/core/testing';

import { HurricaneLalaComponent } from './hurricane-lala.component';

describe('HurricaneLalaComponent', () => {
  let component: HurricaneLalaComponent;
  let fixture: ComponentFixture<HurricaneLalaComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HurricaneLalaComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(HurricaneLalaComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

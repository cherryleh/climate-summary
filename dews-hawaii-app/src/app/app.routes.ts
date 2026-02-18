import { Routes } from '@angular/router';
import { ClimateDashboardComponent } from './climate-dashboard/climate-dashboard.component';
import { ClimateSummary2025Component} from './climate-summary-2025/climate-summary-2025.component';
import { UnsubscribeComponent } from './unsubscribe/unsubscribe.component';

export const routes: Routes = [
  {
    path: '', component: ClimateDashboardComponent
  },
  {
    path: 'climate-summary-2025', component: ClimateSummary2025Component
  },
  {
    path: 'unsubscribe', component: UnsubscribeComponent
  }
];

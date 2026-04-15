import { Routes } from '@angular/router';
import { ClimateDashboardComponent } from './climate-dashboard/climate-dashboard.component';
import { ClimateSummary2025Component} from './climate-summary-2025/climate-summary-2025.component';
import { UnsubscribeComponent } from './unsubscribe/unsubscribe.component';
import { StormViewerComponent } from './storm-viewer/storm-viewer.component';
import { StormViewerMarch20262Component } from './storm-viewer-march2026-2/storm-viewer-march2026-2.component';

export const routes: Routes = [
  {
    path: '', component: ClimateDashboardComponent
  },
  {
    path: 'climate-summary-2025', component: ClimateSummary2025Component
  },
  {
    path: 'unsubscribe', component: UnsubscribeComponent
  },
  { path: 'storm-viewer', component: StormViewerComponent},
  { path: 'storm-viewer-march2026-2', component: StormViewerMarch20262Component}

];

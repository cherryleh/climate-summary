import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { AppComponent } from './app/app.component';
import { environment } from './environments/environment';

console.log(`Environment: ${environment.production ? 'environment.prod.ts (production)' : 'environment.ts (development)'}`, environment);

bootstrapApplication(AppComponent, appConfig)
  .catch((err) => console.error(err));

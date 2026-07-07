import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, NavigationEnd, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs/operators';
import { FooterComponent } from './footer/footer.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, RouterOutlet, FooterComponent],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css'],
})
export class AppComponent implements OnInit {
  // Toggle this to show/hide the site-wide maintenance banner.
  maintenanceMode = false;

  // Routes that render their own footer and should not get the global one.
  private readonly routesWithOwnFooter = ['/climate-summary-2025'];
  showFooter = true;

  constructor(private router: Router) {}

  ngOnInit() {
    this.router.events
      .pipe(filter(event => event instanceof NavigationEnd))
      .subscribe((event: NavigationEnd) => {
        this.showFooter = !this.routesWithOwnFooter.includes(event.urlAfterRedirects.split('?')[0].split('#')[0]);
        window.parent.postMessage({
          type: 'routeChange',
          hash: window.location.hash
        }, '*');
      });
  }
}

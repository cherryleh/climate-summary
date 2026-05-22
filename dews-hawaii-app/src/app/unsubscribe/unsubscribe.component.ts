import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient, HttpClientModule, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { environment } from '../../environments/environment';

@Component({
  selector: 'app-unsubscribe',
  standalone: true,
  imports: [CommonModule, HttpClientModule, RouterModule],
  templateUrl: './unsubscribe.component.html',
  styleUrls: ['./unsubscribe.component.css'],
})
export class UnsubscribeComponent implements OnInit {
  private baseUrl = 'https://api.hcdp.ikewai.org/mesonet/climate_report';

  loading = false;
  success = false;
  errorMsg = '';
  hasId = false;

  constructor(private http: HttpClient, private route: ActivatedRoute) {}

  ngOnInit() {
    const id = this.route.snapshot.queryParamMap.get('id');
    if (id) {
      this.hasId = true;
      this.loading = true;
      this.unsubscribe(id);
    }
  }

  private headers(): HttpHeaders {
    return new HttpHeaders({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${environment.apiToken}`,
    });
  }

  private unsubscribe(userID: string) {
    const url = `${this.baseUrl}/subscription/${encodeURIComponent(userID)}/unsubscribe`;
    this.http.patch(url, null, { headers: this.headers() }).subscribe({
      next: () => {
        this.loading = false;
        this.success = true;
      },
      error: (err) => {
        this.loading = false;
        this.errorMsg = this.humanizeError(err);
      },
    });
  }

  private humanizeError(err: unknown): string {
    if (err instanceof HttpErrorResponse) {
      const msg =
        (typeof err.error === 'string' && err.error) ||
        (err.error && typeof err.error === 'object' && (err.error.message || err.error.detail)) ||
        '';
      return msg || `Unsubscribe failed (HTTP ${err.status}).`;
    }
    return 'Unsubscribe failed.';
  }
}

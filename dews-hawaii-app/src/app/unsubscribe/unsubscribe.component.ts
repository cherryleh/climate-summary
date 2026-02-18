import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, NgForm } from '@angular/forms';
import {
  HttpClient,
  HttpClientModule,
  HttpErrorResponse,
  HttpHeaders,
  HttpParams,
} from '@angular/common/http';
import { environment } from '../../environments/environment';

type EmailLookupResponse = {
  userID: string | null;
};

@Component({
  selector: 'app-unsubscribe',
  standalone: true,
  imports: [CommonModule, FormsModule, HttpClientModule],
  templateUrl: './unsubscribe.component.html',
  styleUrls: ['./unsubscribe.component.css'],
})
export class UnsubscribeComponent {
  private baseUrl = 'https://api.hcdp.ikewai.org/mesonet/climate_report';

  email = '';
  loading = false;
  successMsg = '';
  errorMsg = '';

  constructor(private http: HttpClient) {}

  private headers(): HttpHeaders {
    const token = environment.apiToken;
    let h = new HttpHeaders({ 'Content-Type': 'application/json' });
    return h.set('Authorization', `Bearer ${token}`);
  }

  submit(form: NgForm) {
    this.successMsg = '';
    this.errorMsg = '';

    if (form.invalid) {
      this.errorMsg = 'Please enter a valid email address.';
      return;
    }

    const emailTrimmed = this.email.trim().toLowerCase();
    this.loading = true;

    const params = new HttpParams().set('email', emailTrimmed);

    this.http
      .get<EmailLookupResponse>(`${this.baseUrl}/email_lookup`, {
        params,
        headers: this.headers(),
      })
      .subscribe({
        next: (data) => {
          const userID = data?.userID;
          if (!userID) {
            this.loading = false;
            this.errorMsg = 'No subscription found for that email.';
            return;
          }
          this.unsubscribe(userID);
        },
        error: (err) => {
          this.loading = false;
          this.errorMsg = this.humanizeHttpError(err, 'Lookup failed.');
        },
      });
  }

  private unsubscribe(userID: string) {
    const url = `${this.baseUrl}/subscription/${encodeURIComponent(userID)}/unsubscribe`;

    this.http.patch(url, null, { headers: this.headers() }).subscribe({
      next: () => {
        this.loading = false;
        this.successMsg = 'You have been unsubscribed.';
      },
      error: (err) => {
        this.loading = false;
        this.errorMsg = this.humanizeHttpError(err, 'Unsubscribe failed.');
      },
    });
  }

  private humanizeHttpError(err: unknown, fallback: string): string {
    if (err instanceof HttpErrorResponse) {
      const apiMsg =
        (typeof err.error === 'string' && err.error) ||
        (err.error &&
          typeof err.error === 'object' &&
          (err.error.message || err.error.detail)) ||
        '';
      return apiMsg
        ? `${fallback} ${apiMsg}`
        : `${fallback} (HTTP ${err.status}${err.statusText ? `: ${err.statusText}` : ''})`;
    }
    return fallback;
  }
}

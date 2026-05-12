import { Injectable } from '@angular/core';
import { HttpClient, HttpParams, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export type ListField = 'county' | 'moku' | 'ahupuaa' | 'watershed';

export interface SubscriptionRecord {
  email: string;
  island?: string[];
  county?: string[];
  moku?: string[];
  ahupuaa?: string[];
  watershed?: string[];
  division?: string[];
}

export interface EmailLookupResponse {
  userID: string | null; 
}

@Injectable({ providedIn: 'root' })
export class EmailSubscriptionService {
  private baseUrl = 'https://api.hcdp.ikewai.org/mesonet/climate_report';

  constructor(private http: HttpClient) {}

  private headers(): HttpHeaders {
    const token = environment.apiToken; // whatever your env key is named
    let h = new HttpHeaders({ 'Content-Type': 'application/json' });

    h = h.set('Authorization', `Bearer ${token}`);
    return h;
  }


  emailLookup(email: string): Observable<EmailLookupResponse> {
    const params = new HttpParams().set('email', email);
    return this.http.get<EmailLookupResponse>(`${this.baseUrl}/email_lookup`, {
      params,
      headers: this.headers(),
    });
  }

  getSubscription(userID: string): Observable<SubscriptionRecord> {
    return this.http.get<SubscriptionRecord>(`${this.baseUrl}/subscription/${userID}`, {
      headers: this.headers(),
    });
  }

  createSubscription(body: any): Observable<any> {
    return this.http.post(`${this.baseUrl}/subscribe`, body, {
      headers: this.headers(),
    });
  }

  updateSubscription(userID: string, body: SubscriptionRecord) {
    return this.http.patch(
      `${this.baseUrl}/subscription/${userID}`,
      body,
      { headers: this.headers() }
    );
  }

  unsubscribeAll(userID: string): Observable<any> {
    return this.http.patch(
      `${this.baseUrl}/subscription/${encodeURIComponent(userID)}/unsubscribe`,
      null,
      { headers: this.headers() }
    );
  }

}

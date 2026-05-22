import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, NgForm } from '@angular/forms';
import { HttpClientModule, HttpErrorResponse } from '@angular/common/http';
import { RouterModule, ActivatedRoute } from '@angular/router';
import {
  EmailSubscriptionService,
  SubscriptionRecord,
} from '../services/email-subscription.service';

type Category = 'island' | 'county' | 'moku' | 'ahupuaa' | 'watershed' | 'division' | 'climate';

const CATEGORY_LABELS: Record<Category, string> = {
  island: 'Island',
  county: 'County',
  moku: 'Moku',
  ahupuaa: "Ahupuaʻa",
  watershed: 'Watershed',
  division: 'Division',
  climate: 'Climate',
};

@Component({
  selector: 'app-manage-preferences',
  standalone: true,
  imports: [CommonModule, FormsModule, HttpClientModule, RouterModule],
  templateUrl: './manage-subscriptions.component.html',
  styleUrls: ['./manage-subscriptions.component.css'],
})
export class ManagePreferencesComponent implements OnInit {
  email = '';
  loading = false;
  successMsg = '';
  errorMsg = '';
  noSubscriptionError = false;

  view: 'email' | 'prefs' = 'email';

  userID = '';
  categoryLabels = CATEGORY_LABELS;
  categories: Category[] = ['island', 'county', 'moku', 'ahupuaa', 'watershed', 'division', 'climate'];

  checked: Partial<Record<Category, Record<string, boolean>>> = {};
  items: Partial<Record<Category, string[]>> = {};

  constructor(private svc: EmailSubscriptionService, private route: ActivatedRoute) {}

  ngOnInit() {
    const id = this.route.snapshot.queryParamMap.get('id');
    if (id) {
      this.userID = id;
      this.loading = true;
      this.fetchPrefs();
    }
  }

  get hasAnySubscription(): boolean {
    return this.categories.some(
      (cat) => (this.items[cat]?.length ?? 0) > 0
    );
  }

  get checkedCount(): number {
    return this.categories.reduce((sum, cat) => {
      const map = this.checked[cat] ?? {};
      return sum + Object.values(map).filter(Boolean).length;
    }, 0);
  }

  lookup(form: NgForm) {
    this.successMsg = '';
    this.errorMsg = '';
    this.noSubscriptionError = false;

    if (form.invalid) {
      this.errorMsg = 'Please enter a valid email address.';
      return;
    }

    this.loading = true;
    const emailTrimmed = this.email.trim().toLowerCase();

    this.svc.emailLookup(emailTrimmed).subscribe({
      next: (res) => {
        const id = res?.userID;
        if (!id) {
          this.loading = false;
          this.noSubscriptionError = true;
          return;
        }
        this.userID = id;
        this.fetchPrefs();
      },
      error: (err) => {
        this.loading = false;
        this.errorMsg = this.humanize(err, 'Lookup failed.');
      },
    });
  }

  private fetchPrefs() {
    this.svc.getSubscription(this.userID).subscribe({
      next: (sub) => {
        this.loading = false;
        if (sub.email) this.email = sub.email;
        this.buildChecked(sub);
        this.view = 'prefs';
      },
      error: (err) => {
        this.loading = false;
        this.errorMsg = this.humanize(err, 'Could not load subscription details.');
      },
    });
  }

  private buildChecked(sub: SubscriptionRecord) {
    this.items = {};
    this.checked = {};
    for (const cat of this.categories) {
      const vals = sub[cat] ?? [];
      this.items[cat] = [...vals];
      this.checked[cat] = {};
      for (const v of vals) {
        this.checked[cat]![v] = true;
      }
    }
  }

  toggleAll(cat: Category, on: boolean) {
    for (const item of this.items[cat] ?? []) {
      this.checked[cat]![item] = on;
    }
  }

  allChecked(cat: Category): boolean {
    const list = this.items[cat] ?? [];
    return list.length > 0 && list.every((v) => this.checked[cat]?.[v]);
  }

  saveChanges() {
    this.successMsg = '';
    this.errorMsg = '';
    this.loading = true;

    const body: SubscriptionRecord = { email: this.email.trim().toLowerCase() };
    for (const cat of this.categories) {
      const kept = (this.items[cat] ?? []).filter((v) => this.checked[cat]?.[v]);
      if (kept.length) {
        (body as any)[cat] = kept;
      }
    }

    this.svc.updateSubscription(this.userID, body).subscribe({
      next: () => {
        this.loading = false;
        this.successMsg = 'Preferences updated successfully.';
      },
      error: (err) => {
        this.loading = false;
        this.errorMsg = this.humanize(err, 'Update failed.');
      },
    });
  }

  unsubscribeAll() {
    this.successMsg = '';
    this.errorMsg = '';
    this.loading = true;

    this.svc.unsubscribeAll(this.userID).subscribe({
      next: () => {
        this.loading = false;
        this.successMsg = 'You have been unsubscribed from all reports.';
        this.view = 'email';
        this.email = '';
        this.userID = '';
      },
      error: (err) => {
        this.loading = false;
        this.errorMsg = this.humanize(err, 'Unsubscribe failed.');
      },
    });
  }

  back() {
    this.view = 'email';
    this.successMsg = '';
    this.errorMsg = '';
  }

  private humanize(err: unknown, fallback: string): string {
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

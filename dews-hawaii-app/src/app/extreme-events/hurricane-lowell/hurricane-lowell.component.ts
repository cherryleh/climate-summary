import { Component } from '@angular/core';
import { environment } from '../../../environments/environment';

@Component({
  selector: 'app-hurricane-lowell',
  standalone: true,
  imports: [],
  templateUrl: './hurricane-lowell.component.html',
  styleUrl: './hurricane-lowell.component.css'
})
export class HurricaneLowellComponent {
  constructor() {
    // The embedded page's Mesonet panel reads its HCDP token from
    // sessionStorage first, before falling back to a prompt. sessionStorage
    // is shared with the same-origin iframe in this tab, so seeding it here
    // (before the iframe's own script runs) lets it boot without asking —
    // same token every other Lowell component reads from environment.ts.
    try {
      sessionStorage.setItem('hcdp_token', environment.apiToken);
    } catch {
      // sessionStorage unavailable (private browsing, etc.) — the embedded
      // page falls back to its own token prompt.
    }
  }
}

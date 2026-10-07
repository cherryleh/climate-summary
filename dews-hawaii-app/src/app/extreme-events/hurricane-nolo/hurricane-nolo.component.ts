import { Component, HostListener } from '@angular/core';
import { environment } from '../../../environments/environment';

@Component({
  selector: 'app-hurricane-nolo',
  standalone: true,
  imports: [],
  templateUrl: './hurricane-nolo.component.html',
  styleUrl: './hurricane-nolo.component.css'
})
export class HurricaneNoloComponent {
  // The embedded page's Mesonet panel asks for its HCDP token with a
  // postMessage on load; answer it with the token from environment.ts,
  // the same one every other component uses. Only same-origin requests
  // (our own iframe) get an answer.
  @HostListener('window:message', ['$event'])
  onMessage(event: MessageEvent) {
    if (event.origin !== window.location.origin || event.data?.type !== 'hcdp-token-request') return;
    (event.source as Window | null)?.postMessage(
      { type: 'hcdp-token', token: environment.apiToken },
      window.location.origin
    );
  }
}

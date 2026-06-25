import { HttpInterceptorFn, HttpRequest, HttpHandlerFn, HttpResponse, HttpErrorResponse } from '@angular/common/http';
import { tap, catchError } from 'rxjs/operators';
import { throwError } from 'rxjs';

const LOG_URL = 'https://script.google.com/macros/s/AKfycbwrLfGoerk6TXndVfN_OnUg84WstKCn-fXlZO173BQmpYMIczwvnmAmHapfoi9RUczHvQ/exec';

const shouldLog = (url: string) =>
  /_stats/.test(url) && !url.includes('script.google.com');

export const apiLoggerInterceptor: HttpInterceptorFn = (req: HttpRequest<unknown>, next: HttpHandlerFn) => {
  if (!shouldLog(req.url)) return next(req);

  const start = Date.now();

  const sendLog = (status: number | string, error?: string) => {
    const entry: Record<string, any> = {
      method: req.method,
      endpoint: req.url,
      status,
      durationMs: Date.now() - start,
      error: error || '',
    };

    const params = req.params.keys().reduce((acc, k) => ({ ...acc, [k]: req.params.get(k) }), {});
    if (Object.keys(params).length) entry['params'] = params;

    const body = req.body;
    if (body) entry['body'] = body;

    fetch(LOG_URL, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entry),
    }).catch(() => {});
  };

  return next(req).pipe(
    tap((event) => {
      if (event instanceof HttpResponse) sendLog(event.status);
    }),
    catchError((err: HttpErrorResponse) => {
      sendLog(err.status, err.message);
      return throwError(() => err);
    })
  );
};

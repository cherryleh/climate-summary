import { HttpInterceptorFn, HttpRequest, HttpHandlerFn, HttpResponse, HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { tap, catchError } from 'rxjs/operators';
import { throwError } from 'rxjs';

const LOG_URL = 'https://script.google.com/macros/s/AKfycbwrLfGoerk6TXndVfN_OnUg84WstKCn-fXlZO173BQmpYMIczwvnmAmHapfoi9RUczHvQ/exec';

// Avoid logging the log requests themselves
const isLogRequest = (url: string) => url.includes('script.google.com');

export const apiLoggerInterceptor: HttpInterceptorFn = (req: HttpRequest<unknown>, next: HttpHandlerFn) => {
  if (isLogRequest(req.url)) return next(req);

  const http = inject(HttpClient);
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

    http.post(LOG_URL, entry).subscribe({ error: () => {} });
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

// Sentry init — клиент-сайд error tracking. SDK DSN публичен по дизайну.
// Без VITE_SENTRY_DSN init становится no-op и Sentry не активируется.
import * as Sentry from '@sentry/react';

export function initSentry(): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
  if (!dsn) return;

  const environment = (import.meta.env.VITE_SENTRY_ENVIRONMENT as string | undefined)
    ?? (import.meta.env.PROD ? 'production' : 'development');

  Sentry.init({
    dsn,
    environment,
    release: import.meta.env.VITE_SENTRY_RELEASE as string | undefined,
    tracesSampleRate: import.meta.env.PROD ? 0.1 : 0,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: import.meta.env.PROD ? 1 : 0,
    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.replayIntegration({
        maskAllText: true,
        blockAllMedia: true,
      }),
    ],
  });
}

export { Sentry };

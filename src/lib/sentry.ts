import React from 'react'

type SentryModule = {
  init(config: Record<string, unknown>): void
  browserTracingIntegration(): unknown
  replayIntegration(config: Record<string, unknown>): unknown
  captureException(error: unknown, context?: unknown): void
}

type ErrorBoundaryFallbackProps = {
  error: Error
  resetError: () => void
}

type ErrorBoundaryProps = {
  children: React.ReactNode
  fallback: (props: ErrorBoundaryFallbackProps) => React.ReactNode
}

type CaptureContext = {
  tags?: Record<string, string>
  extra?: Record<string, unknown>
}

let sentryModulePromise: Promise<SentryModule | null> | null = null
const sentryImportId = '@sentry/react'

function getSentryDSN(): string | undefined {
  return import.meta.env.VITE_SENTRY_DSN as string | undefined
}

function loadSentryModule(): Promise<SentryModule | null> {
  if (!getSentryDSN()) {
    return Promise.resolve(null)
  }

  if (!sentryModulePromise) {
    sentryModulePromise = import(/* @vite-ignore */ sentryImportId).catch(() => null)
  }

  return sentryModulePromise
}

class LocalErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  { error: Error | null }
> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error): void {
    Sentry.captureException(error)
  }

  private resetError = (): void => {
    this.setState({ error: null })
  }

  render(): React.ReactNode {
    if (this.state.error) {
      return this.props.fallback({
        error: this.state.error,
        resetError: this.resetError,
      })
    }

    return this.props.children
  }
}

export function initSentry(): void {
  const dsn = getSentryDSN()
  if (!dsn) return

  const environment =
    (import.meta.env.VITE_SENTRY_ENVIRONMENT as string | undefined) ??
    (import.meta.env.PROD ? 'production' : 'development')

  void loadSentryModule().then((SentryModule) => {
    if (!SentryModule) return

    SentryModule.init({
      dsn,
      environment,
      release: import.meta.env.VITE_SENTRY_RELEASE as string | undefined,
      tracesSampleRate: import.meta.env.PROD ? 0.1 : 0,
      replaysSessionSampleRate: 0,
      replaysOnErrorSampleRate: import.meta.env.PROD ? 1 : 0,
      integrations: [
        SentryModule.browserTracingIntegration(),
        SentryModule.replayIntegration({
          maskAllText: true,
          blockAllMedia: true,
        }),
      ],
    })
  })
}

export const Sentry = {
  ErrorBoundary: LocalErrorBoundary,
  captureException(error: unknown, context?: CaptureContext): void {
    void loadSentryModule().then((SentryModule) => {
      SentryModule?.captureException(error, context)
    })
  },
}

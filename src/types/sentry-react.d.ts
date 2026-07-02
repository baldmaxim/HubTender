declare module '@sentry/react' {
  export function init(config: Record<string, unknown>): void
  export function browserTracingIntegration(): unknown
  export function replayIntegration(config: Record<string, unknown>): unknown
  export function captureException(error: unknown, context?: unknown): void
}

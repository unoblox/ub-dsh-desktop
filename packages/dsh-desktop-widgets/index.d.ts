export const name: 'dsh-desktop-widgets'
export const inject: string[]
export const TOOL_NAME: 'show_widget'
export const CHART_LIBRARY_ROUTE: string
export const MAX_WIDGET_HTML: number
export const MIN_HEIGHT: number
export const MAX_HEIGHT: number
export const TOOL_DESCRIPTION: string
/** The part of the Harness context this plugin uses. */
export interface WidgetsHostContext {
  tools: { register(tool: never): unknown }
  connection: { fetch: { register(route: never): unknown } }
  logger: { warn(format: string, ...args: unknown[]): void }
}
export function apply(ctx: WidgetsHostContext): void

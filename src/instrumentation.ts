// TEMPORARY (NS-136, plan M6 Task 2, C3). Never merged.
export function onRequestError(
  _error: unknown,
  _request: unknown,
  context: { routeType: string; routePath: string },
) {
  console.error(`probe: onRequestError ${context.routeType} ${context.routePath}`)
}

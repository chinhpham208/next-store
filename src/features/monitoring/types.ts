export type AdminErrorRow = {
  fingerprint: string
  routeType: string
  routePath: string
  method: string
  digest: string | null
  errorName: string
  message: string | null
  count: number
  lastSeenAt: Date
}

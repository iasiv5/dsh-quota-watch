function isIPv4Loopback(address) {
  const parts = address.split('.')
  return parts.length === 4
    && parts[0] === '127'
    && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)
}

function isLoopbackAddress(address) {
  if (typeof address !== 'string') return false
  const normalized = address.toLowerCase()
  if (normalized === '::1') return true
  if (normalized.startsWith('::ffff:')) return isIPv4Loopback(normalized.slice('::ffff:'.length))
  return isIPv4Loopback(normalized)
}

function isLoopbackHostname(hostname) {
  if (hostname === 'localhost' || hostname === '[::1]') return true
  return isIPv4Loopback(hostname)
}

export function isSameOriginRequest(request) {
  if (request.headers?.['sec-fetch-site'] === 'cross-site') return false
  const origin = request.headers?.origin
  if (origin === undefined || origin === null || origin === '') return true
  const host = request.headers?.host
  if (typeof host !== 'string' || host === '') return false
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}

export function isLoopbackRequest(request) {
  if (!isLoopbackAddress(request.socket?.remoteAddress)) return false
  const host = request.headers?.host
  if (typeof host !== 'string' || host === '') return false
  let hostname
  try {
    hostname = new URL(`http://${host}`).hostname
  } catch {
    return false
  }
  return isLoopbackHostname(hostname) && isSameOriginRequest(request)
}

function pairingService(ctx) {
  try {
    const fromGet = typeof ctx.get === 'function' ? ctx.get('remoteWebUiPairing', false) : undefined
    if (fromGet && typeof fromGet.isPairedDevice === 'function') return fromGet
  } catch {
    // Missing optional pairing service stays loopback-only.
  }
  const direct = ctx.remoteWebUiPairing
  return direct && typeof direct.isPairedDevice === 'function' ? direct : undefined
}

/** Allow the local desktop or a browser session explicitly paired by the host. */
export function isPairedOrLoopbackAllowed(ctx, request) {
  if (isLoopbackRequest(request)) return true
  if (!isSameOriginRequest(request)) return false
  try {
    return pairingService(ctx)?.isPairedDevice(request) === true
  } catch {
    return false
  }
}

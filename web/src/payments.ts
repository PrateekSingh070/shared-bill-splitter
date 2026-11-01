export type PaymentState = { status: 'pending' } | { status: 'failed'; message: string }

// A timeout can happen after the server commits. Retrying must reuse this key.
export function paymentKey(shareId: string, memory: Map<string, string>): string {
  const cached = memory.get(shareId)
  if (cached) return cached

  let key: string | null = null
  try {
    key = sessionStorage.getItem(`payment:${shareId}`)
  } catch {
    // Private browser settings may disable storage; keep the key in memory.
  }
  key ||= crypto.randomUUID()
  memory.set(shareId, key)
  try {
    sessionStorage.setItem(`payment:${shareId}`, key)
  } catch {
    // In-memory retries still work for the lifetime of this page.
  }
  return key
}

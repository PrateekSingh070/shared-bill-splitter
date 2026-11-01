import type { Balance, Bill, Home, Member, Share } from '../../api/src/models'

export type Household = Home & { members: Member[] }
export type Snapshot = { home: Household; bills: Bill[]; balances: Balance[] }
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
const integer = (value: unknown): value is number => Number.isSafeInteger(value)
const isHome = (v: unknown): v is Home =>
  record(v) && typeof v.id === 'string' && typeof v.name === 'string'
const isMember = (v: unknown): v is Member => record(v) && typeof v.homeId === 'string' && isHome(v)
const isShare = (v: unknown): v is Share =>
  record(v) &&
  typeof v.id === 'string' &&
  typeof v.memberId === 'string' &&
  integer(v.amountCents) &&
  (v.paidAt === null || typeof v.paidAt === 'string')
const isBill = (v: unknown): v is Bill =>
  record(v) &&
  typeof v.id === 'string' &&
  typeof v.homeId === 'string' &&
  typeof v.title === 'string' &&
  integer(v.totalCents) &&
  Array.isArray(v.shares) &&
  v.shares.every(isShare)
const isBalance = (v: unknown): v is Balance =>
  record(v) &&
  typeof v.memberId === 'string' &&
  typeof v.name === 'string' &&
  integer(v.outstandingCents)

async function request<T>(
  path: string,
  valid: (value: unknown) => value is T,
  init?: RequestInit,
): Promise<T> {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), 15000)
  try {
    const response = await fetch(path, { ...init, signal: controller.signal })
    let data: unknown
    try {
      data = await response.json()
    } catch {
      throw new Error(`Unreadable server response (${response.status}).`)
    }
    if (!response.ok)
      throw new Error(
        record(data) && typeof data.error === 'string'
          ? data.error
          : `Request failed (${response.status}).`,
      )
    if (!valid(data)) throw new Error('Unexpected server response. Please retry.')
    return data
  } catch (error) {
    if (controller.signal.aborted)
      throw new Error('Server took too long. Please retry; a payment may already have completed.')
    throw error
  } finally {
    window.clearTimeout(timer)
  }
}
const post = (value: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(value),
})
const path = (id: string) => `/api/homes/${encodeURIComponent(id)}`
export const createHome = (name: string) => request('/api/homes', isHome, post({ name }))
export const addMember = (id: string, name: string) =>
  request(`${path(id)}/members`, isMember, post({ name }))
export const addBill = (id: string, title: string, totalCents: number) =>
  request(`${path(id)}/bills`, isBill, post({ title, totalCents }))
export const payShare = (billId: string, shareId: string, key: string) =>
  request(
    `/api/bills/${encodeURIComponent(billId)}/shares/${encodeURIComponent(shareId)}/pay`,
    (value): value is Share => isShare(value) && typeof value.paidAt === 'string',
    { method: 'POST', headers: { 'Idempotency-Key': key } },
  )
export async function snapshot(id: string): Promise<Snapshot> {
  const [home, bills, balances] = await Promise.all([
    request(
      path(id),
      (v): v is Household =>
        record(v) && Array.isArray(v.members) && v.members.every(isMember) && isHome(v),
    ),
    request(
      `${path(id)}/bills`,
      (v): v is { bills: Bill[] } => record(v) && Array.isArray(v.bills) && v.bills.every(isBill),
    ),
    request(
      `${path(id)}/balances`,
      (v): v is { balances: Balance[] } =>
        record(v) && Array.isArray(v.balances) && v.balances.every(isBalance),
    ),
  ])
  return { home, bills: bills.bills, balances: balances.balances }
}

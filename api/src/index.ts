import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { Balance, Bill, Home, Member, Share } from './models'

const app = new Hono<{ Bindings: Env }>()

app.get('/api/health', (c) => c.json({ status: 'ok' }))

app.onError((error, c) => {
  if (error instanceof HTTPException) return c.json({ error: error.message }, error.status)
  console.error(error)
  return c.json({ error: 'Something went wrong. Please retry.' }, 500)
})
app.notFound((c) => c.json({ error: 'Route not found' }, 404))

async function body(request: Request): Promise<Record<string, unknown>> {
  let value: unknown
  try {
    value = await request.json()
  } catch {
    throw new HTTPException(400, { message: 'Invalid JSON body' })
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HTTPException(400, { message: 'Expected a JSON object' })
  }
  return value as Record<string, unknown>
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 200) {
    throw new HTTPException(422, { message: `${label} must contain 1 to 200 characters` })
  }
  return value.trim()
}

async function home(db: D1Database, id: string): Promise<Home> {
  const row = await db.prepare('SELECT id, name FROM homes WHERE id = ?').bind(id).first<Home>()
  if (!row) throw new HTTPException(404, { message: 'Home not found' })
  return row
}

app.post('/api/homes', async (c) => {
  const name = text((await body(c.req.raw)).name, 'Name')
  const id = crypto.randomUUID()
  await c.env.DB.prepare('INSERT INTO homes (id, name) VALUES (?, ?)').bind(id, name).run()
  return c.json({ id, name }, 201)
})

app.get('/api/homes/:homeId', async (c) => {
  const db = c.env.DB
  const result = await home(db, c.req.param('homeId'))
  const members = await db
    .prepare('SELECT id, home_id AS homeId, name FROM members WHERE home_id = ? ORDER BY sequence')
    .bind(result.id)
    .all<Member>()
  return c.json({ ...result, members: members.results })
})

app.post('/api/homes/:homeId/members', async (c) => {
  const homeId = c.req.param('homeId')
  await home(c.env.DB, homeId)
  const name = text((await body(c.req.raw)).name, 'Name')
  const id = crypto.randomUUID()
  await c.env.DB.prepare('INSERT INTO members (id, home_id, name) VALUES (?, ?, ?)')
    .bind(id, homeId, name)
    .run()
  return c.json({ id, homeId, name }, 201)
})

const shareColumns =
  's.id, s.member_id AS memberId, s.amount_cents AS amountCents, s.paid_at AS paidAt'

app.post('/api/homes/:homeId/bills', async (c) => {
  const db = c.env.DB
  const homeId = c.req.param('homeId')
  await home(db, homeId)
  const input = await body(c.req.raw)
  const title = text(input.title, 'Title')
  const total = input.totalCents
  if (typeof total !== 'number' || !Number.isSafeInteger(total) || total <= 0) {
    throw new HTTPException(422, { message: 'Total must be a positive safe integer in cents' })
  }
  const member = await db
    .prepare('SELECT id FROM members WHERE home_id = ? LIMIT 1')
    .bind(homeId)
    .first()
  if (!member) throw new HTTPException(422, { message: 'Add a member before creating a bill' })
  const id = crypto.randomUUID()
  // D1 batch is a transaction. The INSERT SELECT takes one membership snapshot;
  // SQL integer division and insertion order assign every remainder cent exactly once.
  const results = await db.batch([
    db
      .prepare('INSERT INTO bills (id, home_id, title, total_cents) VALUES (?, ?, ?, ?)')
      .bind(id, homeId, title, total),
    db
      .prepare(`INSERT INTO shares (id, home_id, bill_id, member_id, amount_cents)
      SELECT lower(hex(randomblob(16))), ?, ?, id,
        (CAST(? AS INTEGER) / count(*) OVER ()) + CASE WHEN row_number() OVER (ORDER BY sequence) <= (CAST(? AS INTEGER) % count(*) OVER ()) THEN 1 ELSE 0 END
      FROM members WHERE home_id = ?`)
      .bind(homeId, id, total, total, homeId),
    db
      .prepare(`SELECT ${shareColumns} FROM shares s JOIN members m ON m.id = s.member_id
      WHERE s.bill_id = ? ORDER BY m.sequence`)
      .bind(id),
  ])
  return c.json(
    { id, homeId, title, totalCents: total, shares: results[2]?.results as Share[] },
    201,
  )
})

app.get('/api/homes/:homeId/bills', async (c) => {
  const db = c.env.DB
  const homeId = c.req.param('homeId')
  await home(db, homeId)
  const results = await db.batch([
    db
      .prepare(
        'SELECT id, home_id AS homeId, title, total_cents AS totalCents FROM bills WHERE home_id = ? ORDER BY sequence DESC',
      )
      .bind(homeId),
    db
      .prepare(`SELECT ${shareColumns}, s.bill_id AS billId FROM shares s
      JOIN members m ON m.id = s.member_id WHERE s.home_id = ? ORDER BY m.sequence`)
      .bind(homeId),
  ])
  const bills = results[0]?.results as Omit<Bill, 'shares'>[]
  const shares = results[1]?.results as (Share & { billId: string })[]
  const grouped = new Map<string, Share[]>()
  for (const { billId, ...share } of shares) {
    const group = grouped.get(billId) ?? []
    group.push(share)
    grouped.set(billId, group)
  }
  return c.json({ bills: bills.map((bill) => ({ ...bill, shares: grouped.get(bill.id) ?? [] })) })
})

app.post('/api/bills/:billId/shares/:shareId/pay', async (c) => {
  const key = c.req.header('Idempotency-Key')
  if (!key?.trim()) throw new HTTPException(400, { message: 'Idempotency-Key is required' })
  const db = c.env.DB
  const billId = c.req.param('billId')
  const shareId = c.req.param('shareId')
  // Compare-and-set in SQL, never read-then-write: competing keys cannot both win.
  await db
    .prepare(`UPDATE shares SET paid_at = ?, payment_key = ?
    WHERE id = ? AND bill_id = ? AND paid_at IS NULL`)
    .bind(new Date().toISOString(), key, shareId, billId)
    .run()
  const row = await db
    .prepare(`SELECT ${shareColumns}, s.payment_key AS paymentKey
    FROM shares s WHERE s.id = ? AND s.bill_id = ?`)
    .bind(shareId, billId)
    .first<Share & { paymentKey: string | null }>()
  if (!row) throw new HTTPException(404, { message: 'Bill or share not found' })
  if (row.paymentKey !== key)
    throw new HTTPException(409, { message: 'Share already paid with a different key' })
  const { paymentKey: _key, ...share } = row
  return c.json(share)
})

app.get('/api/homes/:homeId/balances', async (c) => {
  const db = c.env.DB
  const homeId = c.req.param('homeId')
  await home(db, homeId)
  const result = await db
    .prepare(`SELECT m.id AS memberId, m.name,
    coalesce(sum(s.amount_cents), 0) AS outstandingCents FROM members m
    LEFT JOIN shares s ON s.member_id = m.id AND s.home_id = m.home_id AND s.paid_at IS NULL
    WHERE m.home_id = ? GROUP BY m.sequence ORDER BY m.sequence`)
    .bind(homeId)
    .all<Balance>()
  if (result.results.some((balance) => !Number.isSafeInteger(balance.outstandingCents))) {
    throw new HTTPException(500, { message: 'Balance exceeds the supported integer range' })
  }
  return c.json({ balances: result.results })
})

export default app

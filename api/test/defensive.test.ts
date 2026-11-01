import { env, exports } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { type Balance, type Bill, call, createBill, createHome, type Share } from './helpers'

const pay = (bill: string, share: string, key: string) =>
  call<Share>('POST', `/api/bills/${bill}/shares/${share}/pay`, {
    headers: { 'Idempotency-Key': key },
  })

describe('defensive behavior', () => {
  it('preserves exact totals and insertion order across varied splits', async () => {
    const { homeId, members } = await createHome([
      'One',
      'Two',
      'Three',
      'Four',
      'Five',
      'Six',
      'Seven',
    ])
    for (const total of [
      1,
      2,
      6,
      7,
      8,
      13,
      14,
      15,
      99,
      100,
      101,
      999,
      1000,
      1001,
      100001,
      Number.MAX_SAFE_INTEGER,
    ]) {
      const { status, body: bill } = await createBill(homeId, total)
      expect(status).toBe(201)
      expect(bill.shares.map((share) => share.memberId)).toEqual(members.map((member) => member.id))
      const cents = BigInt(total)
      const count = BigInt(members.length)
      const expected = members.map((_, index) =>
        Number(cents / count + (BigInt(index) < cents % count ? 1n : 0n)),
      )
      expect(bill.shares.map((share) => share.amountCents)).toEqual(expected)
      expect(bill.shares.reduce((sum, share) => sum + BigInt(share.amountCents), 0n)).toBe(cents)
    }
  })

  it('scopes an idempotency key to each share, including zero-cent shares', async () => {
    const { homeId } = await createHome(['One', 'Two'])
    const { body: bill } = await createBill(homeId, 1)
    for (const share of bill.shares) {
      const first = await pay(bill.id, share.id, 'shared-key')
      expect(first.status).toBe(200)
      expect((await pay(bill.id, share.id, 'shared-key')).body).toEqual(first.body)
    }
    const balances = await call<{ balances: Balance[] }>('GET', `/api/homes/${homeId}/balances`)
    expect(balances.body.balances.map((balance) => balance.outstandingCents)).toEqual([0, 0])
  })

  it('rolls back the bill if share insertion fails and returns a sanitized JSON error', async () => {
    const { homeId } = await createHome(['One'])
    // Force a storage failure for this home only; the trigger is removed even on assertion failure.
    await env.DB.prepare(`CREATE TRIGGER review_reject_share BEFORE INSERT ON shares
      WHEN NEW.home_id = '${homeId}' BEGIN SELECT RAISE(ABORT, 'forced review failure'); END`).run()
    try {
      const result = await call<{ error: string }>('POST', `/api/homes/${homeId}/bills`, {
        body: { title: 'Rollback', totalCents: 100 },
      })
      expect(result.status).toBe(500)
      expect(result.body).toEqual({ error: 'Something went wrong. Please retry.' })
      const bills = await call<{ bills: Bill[] }>('GET', `/api/homes/${homeId}/bills`)
      expect(bills.body.bills).toEqual([])
      const shares = await env.DB.prepare('SELECT count(*) AS count FROM shares WHERE home_id = ?')
        .bind(homeId)
        .first<{ count: number }>()
      expect(shares?.count).toBe(0)
    } finally {
      await env.DB.exec('DROP TRIGGER review_reject_share')
    }
  })

  it('allows exactly one competing payment key and replays only that result', async () => {
    const { homeId } = await createHome(['One', 'Two'])
    const { body: bill } = await createBill(homeId, 101)
    const share = bill.shares[0]
    if (!share) throw new Error('Missing share')
    const results = await Promise.all([
      pay(bill.id, share.id, 'first'),
      pay(bill.id, share.id, 'second'),
    ])
    expect(results.map((result) => result.status).sort()).toEqual([200, 409])
    const winningKey = results[0]?.status === 200 ? 'first' : 'second'
    const replay = await pay(bill.id, share.id, winningKey)
    expect(replay.body).toEqual(results.find((result) => result.status === 200)?.body)
    const balance = await call<{ balances: Balance[] }>('GET', `/api/homes/${homeId}/balances`)
    expect(balance.body.balances.map((row) => row.outstandingCents)).toEqual([0, 50])
  })

  it('concurrently replays the same key without changing paidAt', async () => {
    const { homeId } = await createHome(['One'])
    const { body: bill } = await createBill(homeId, 1)
    const share = bill.shares[0]
    if (!share) throw new Error('Missing share')
    const results = await Promise.all(
      Array.from({ length: 6 }, () => pay(bill.id, share.id, 'same')),
    )
    expect(results.every((result) => result.status === 200)).toBe(true)
    expect(
      results.every((result) => JSON.stringify(result.body) === JSON.stringify(results[0]?.body)),
    ).toBe(true)
  })

  it('handles totals below member count and maximum safe integers exactly', async () => {
    const { homeId } = await createHome(['One', 'Two', 'Three'])
    const tiny = await createBill(homeId, 1)
    expect(tiny.body.shares.map((share) => share.amountCents)).toEqual([1, 0, 0])
    const huge = await createBill(homeId, Number.MAX_SAFE_INTEGER)
    expect(huge.status).toBe(201)
    expect(huge.body.shares.reduce((sum, share) => sum + BigInt(share.amountCents), 0n)).toBe(
      BigInt(Number.MAX_SAFE_INTEGER),
    )
  })

  it.each([Number.MAX_SAFE_INTEGER + 1, {}, [], true, 0.01])(
    'rejects unsupported totals %j',
    async (totalCents) => {
      const { homeId } = await createHome(['One'])
      const result = await call('POST', `/api/homes/${homeId}/bills`, {
        body: { title: 'Rent', totalCents },
      })
      expect(result.status).toBe(422)
    },
  )

  it.each([null, [], { name: '' }, { name: '   ' }, { name: 5 }, { name: 'x'.repeat(201) }])(
    'rejects invalid home input %j',
    async (body) => {
      const result = await call<{ error: string }>('POST', '/api/homes', { body })
      expect([400, 422]).toContain(result.status)
      expect(result.body.error).toEqual(expect.any(String))
    },
  )

  it('returns JSON for malformed requests and unknown routes', async () => {
    const response = await exports.default.fetch(
      new Request('http://localhost/api/homes', { method: 'POST', body: '{' }),
    )
    expect(response.status).toBe(400)
    expect(await response.json()).toHaveProperty('error')
    const unknown = await call<{ error: string }>('GET', '/api/missing')
    expect(unknown.status).toBe(404)
    expect(unknown.body.error).toBeTypeOf('string')
  })

  it('does not pay a share through a different bill', async () => {
    const { homeId } = await createHome(['One'])
    const a = await createBill(homeId, 100)
    const b = await createBill(homeId, 200)
    const share = a.body.shares[0]
    if (!share) throw new Error('Missing share')
    expect((await pay(b.body.id, share.id, 'wrong')).status).toBe(404)
    expect((await pay(a.body.id, share.id, 'right')).status).toBe(200)
  })

  it('lists persisted bills and keeps new members out of old bills', async () => {
    const { homeId, members } = await createHome(['One'])
    const first = await createBill(homeId, 101)
    await call('POST', `/api/homes/${homeId}/members`, { body: { name: 'Two' } })
    const second = await createBill(homeId, 201)
    const list = await call<{ bills: Bill[] }>('GET', `/api/homes/${homeId}/bills`)
    expect(list.body.bills.map((bill) => bill.id)).toEqual([second.body.id, first.body.id])
    expect(list.body.bills[1]?.shares.map((share) => share.memberId)).toEqual([members[0]?.id])
    expect(list.body.bills[0]?.shares.map((share) => share.amountCents)).toEqual([101, 100])
  })

  it('returns ordered zero balances and empty bill lists', async () => {
    const { homeId } = await createHome(['One', 'Two'])
    const balances = await call<{ balances: Balance[] }>('GET', `/api/homes/${homeId}/balances`)
    expect(balances.body.balances.map((balance) => balance.outstandingCents)).toEqual([0, 0])
    expect((await call<{ bills: Bill[] }>('GET', `/api/homes/${homeId}/bills`)).body.bills).toEqual(
      [],
    )
  })

  it('rejects cross-home shares at the database boundary', async () => {
    const a = await createHome(['One'])
    const b = await createHome(['Two'])
    const bill = await createBill(a.homeId, 100)
    await expect(
      env.DB.prepare(
        'INSERT INTO shares (id, home_id, bill_id, member_id, amount_cents) VALUES (?, ?, ?, ?, ?)',
      )
        .bind(crypto.randomUUID(), a.homeId, bill.body.id, b.members[0]?.id, 100)
        .run(),
    ).rejects.toThrow()
  })
})

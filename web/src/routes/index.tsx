import { createFileRoute } from '@tanstack/react-router'
import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react'
import { addBill, addMember, createHome, payShare, type Snapshot, snapshot } from '../api'
import { type PaymentState, paymentKey } from '../payments'
import '../styles.css'

export const Route = createFileRoute('/')({ component: HomePage })
const message = (error: unknown) =>
  error instanceof Error ? error.message : 'Request failed. Please retry.'
const money = (cents: number) =>
  `$${Math.trunc(cents / 100).toLocaleString('en-US')}.${String(cents % 100).padStart(2, '0')}`

function HomePage() {
  const [homeId, setHomeId] = useState(
    () => new URLSearchParams(window.location.search).get('home') ?? '',
  )
  const [data, setData] = useState<Snapshot | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [payments, setPayments] = useState<Record<string, PaymentState | undefined>>({})
  const inFlight = useRef(new Set<string>())
  const keys = useRef(new Map<string, string>())
  const generation = useRef(0)

  const load = useCallback(async () => {
    const current = ++generation.current
    if (!homeId) {
      setData(null)
      return
    }
    setLoading(true)
    setError('')
    try {
      const next = await snapshot(homeId)
      if (current === generation.current) setData(next)
    } catch (cause) {
      if (current === generation.current) setError(message(cause))
    } finally {
      if (current === generation.current) setLoading(false)
    }
  }, [homeId])
  useEffect(() => {
    void load()
    return () => {
      generation.current++
    }
  }, [load])

  async function submit(
    event: FormEvent<HTMLFormElement>,
    action: (form: FormData) => Promise<void>,
  ) {
    event.preventDefault()
    const form = event.currentTarget
    setBusy(true)
    setError('')
    try {
      await action(new FormData(form))
      form.reset()
    } catch (cause) {
      setError(message(cause))
    } finally {
      setBusy(false)
    }
  }
  function open(id: string) {
    setData(null)
    const url = new URL(window.location.href)
    url.searchParams.set('home', id)
    window.history.replaceState(null, '', url)
    setHomeId(id)
  }
  async function pay(billId: string, shareId: string) {
    if (inFlight.current.has(shareId)) return
    inFlight.current.add(shareId)
    setPayments((previous) => ({ ...previous, [shareId]: { status: 'pending' } }))
    try {
      const key = paymentKey(shareId, keys.current)
      const paid = await payShare(billId, shareId, key)
      setData(
        (previous) =>
          previous && {
            ...previous,
            bills: previous.bills.map((bill) =>
              bill.id === billId
                ? {
                    ...bill,
                    shares: bill.shares.map((share) => (share.id === shareId ? paid : share)),
                  }
                : bill,
            ),
          },
      )
      setPayments((previous) => ({ ...previous, [shareId]: undefined }))
      await load()
    } catch (cause) {
      setPayments((previous) => ({
        ...previous,
        [shareId]: { status: 'failed', message: message(cause) },
      }))
    } finally {
      inFlight.current.delete(shareId)
    }
  }
  const disabled =
    busy || loading || Object.values(payments).some((payment) => payment?.status === 'pending')
  return (
    <main>
      <header>
        <a className="brand" href="/">
          ⌂ / shared
        </a>
        <span>A little clarity for your household</span>
      </header>
      <section className="intro">
        <p className="eyebrow">HOME FINANCES, SIMPLIFIED</p>
        <h1>
          Share a home.
          <br />
          <em>Split it fairly.</em>
        </h1>
        <p>Every bill, every share, all in one place. Down to the last cent.</p>
      </section>
      {!homeId && (
        <section className="panel setup">
          <h2>Make yourself at home</h2>
          <p>Create a household, or open one using its ID.</p>
          <form
            onSubmit={(e) =>
              void submit(e, async (form) => {
                const home = await createHome(String(form.get('name')))
                open(home.id)
              })
            }
          >
            <label>
              Home name
              <input name="name" placeholder="e.g. Flat 4B" required maxLength={200} />
            </label>
            <button disabled={busy} type="submit">
              {busy ? 'Working…' : 'Create home'}
            </button>
          </form>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              open(String(new FormData(e.currentTarget).get('id')).trim())
            }}
          >
            <label>
              Existing home ID
              <input name="id" required />
            </label>
            <button disabled={busy} className="secondary" type="submit">
              Open home
            </button>
          </form>
        </section>
      )}
      {error && (
        <div className="error" role="alert">
          {error}{' '}
          {homeId && (
            <button disabled={disabled} type="button" onClick={() => void load()}>
              Retry loading
            </button>
          )}
        </div>
      )}
      {loading && <p role="status">Loading household…</p>}
      {homeId && (
        <div className="home-heading">
          <div>
            <p className="eyebrow">YOUR HOUSEHOLD</p>
            <h2>{data?.home.name ?? 'Open household'}</h2>
            <small>Home ID: {homeId}</small>
          </div>
          <div>
            <button
              disabled={disabled}
              type="button"
              className="secondary"
              onClick={() => void load()}
            >
              Refresh
            </button>{' '}
            <a href="/">Switch home</a>
          </div>
        </div>
      )}
      {data && (
        <div className="workspace">
          <aside>
            <section className="panel">
              <p className="eyebrow">WHO OWES WHAT</p>
              <h2>Household balances</h2>
              <p className="muted">Unpaid shares across all bills</p>
              {!data.balances.length && <p>No members yet. Add your first housemate below.</p>}
              <ul className="balances">
                {data.balances.map((balance, index) => (
                  <li key={balance.memberId}>
                    <span className="avatar">{index + 1}</span>
                    <span>{balance.name}</span>
                    <strong>{money(balance.outstandingCents)}</strong>
                  </li>
                ))}
              </ul>
              <form
                onSubmit={(e) =>
                  void submit(e, async (form) => {
                    await addMember(homeId, String(form.get('name')))
                    await load()
                  })
                }
              >
                <label>
                  New housemate
                  <input name="name" placeholder="Member name" required maxLength={200} />
                </label>
                <button disabled={disabled} type="submit">
                  Add member
                </button>
              </form>
            </section>
            <p className="note">
              Extra cents go to the earliest members. New housemates join future bills only.
            </p>
          </aside>
          <section>
            <div className="section-heading">
              <h2>Shared bills</h2>
              <span>{data.bills.length} total</span>
            </div>
            <section className="panel">
              <h3>Add a bill</h3>
              <form
                onSubmit={(e) =>
                  void submit(e, async (form) => {
                    await addBill(homeId, String(form.get('title')), Number(form.get('total')))
                    await load()
                  })
                }
              >
                <label>
                  Title
                  <input name="title" placeholder="e.g. Electricity" required maxLength={200} />
                </label>
                <label>
                  Total in cents
                  <input
                    name="total"
                    type="number"
                    min="1"
                    max="9007199254740991"
                    step="1"
                    placeholder="1000"
                    required
                  />
                </label>
                <button disabled={disabled || !data.home.members.length} type="submit">
                  Split bill
                </button>
              </form>
              {!data.home.members.length && (
                <p className="muted">Add a member before splitting a bill.</p>
              )}
            </section>
            {!data.bills.length && (
              <div className="empty">
                <h3>A fresh start</h3>
                <p>No bills yet. Add your first shared expense above.</p>
              </div>
            )}
            {data.bills.map((bill) => (
              <article className="panel bill" key={bill.id}>
                <div className="bill-heading">
                  <div>
                    <p className="eyebrow">
                      {bill.shares.every((s) => s.paidAt) ? 'ALL SETTLED' : 'SHARED EXPENSE'}
                    </p>
                    <h3>{bill.title}</h3>
                  </div>
                  <strong>{money(bill.totalCents)}</strong>
                </div>
                <ul className="shares">
                  {bill.shares.map((share) => (
                    <li key={share.id}>
                      <div className="share-row">
                        <span>
                          {data.home.members.find((m) => m.id === share.memberId)?.name ?? 'Member'}
                        </span>
                        <strong>{money(share.amountCents)}</strong>
                        {share.paidAt ? (
                          <span className="paid">✓ Paid</span>
                        ) : (
                          <button
                            disabled={disabled}
                            type="button"
                            className="secondary"
                            onClick={() => void pay(bill.id, share.id)}
                          >
                            {payments[share.id]?.status === 'pending' ? 'Paying…' : 'Pay share'}
                          </button>
                        )}
                      </div>
                      <PaymentError state={payments[share.id]} />
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </section>
        </div>
      )}
      <footer>
        Clear shares. Comfortable homes.<span>Amounts in USD · 100 cents = $1</span>
      </footer>
    </main>
  )
}

function PaymentError({ state }: { state: PaymentState | undefined }) {
  if (state?.status !== 'failed') return null
  return (
    <p className="error" role="alert">
      {state.message} Retry with “Pay share”.
    </p>
  )
}

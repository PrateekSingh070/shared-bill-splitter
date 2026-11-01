# Shared Bill Splitter

A TypeScript implementation of the DoCoDeGo Engineering internship assignment, prepared for Prateek Singh. Create a household, add members in order, split bills in whole cents, and record each member's settlement with retry-safe payments.

**Run locally:** `pnpm install`, then `pnpm dev`. Open http://localhost:5173.

**Verify:** `pnpm check && pnpm typecheck && pnpm test && pnpm build`.

The implementation keeps the required Hono/Cloudflare D1 and React/TanStack Router stack. See [Decisions](#decisions) for the three main engineering choices and [WALKTHROUGH.md](WALKTHROUGH.md) for the architecture and interview preparation. GitHub Actions runs the same quality checks on pushes and pull requests.

## Original assignment

Welcome. In this assignment you build a small bill splitter for a shared home. It has two parts:

1. **Homes and members:** create a home and add members to it.
2. **Bill splitting:** split a bill between the members. Each member pays their own share.

The assignment is small on purpose. We want correct, safe, and clear code. We do not want many features.

## What we look at

- **Your code passes the tests.** The tests decide, not opinion. You get the visible tests. We also run extra tests that you do not see.
- **Your code is safe when things go wrong.** Wrong input, repeated requests, and two requests at the same time must not break your data.
- **Your code is typed.** Use TypeScript. Do not use `any`.
- **You understand your code.** You record a short video and explain it.

Take your time. A careful, correct solution is better than a fast one. We expect 2 to 3 days of real work.

## Stack (required)

- **API:** Hono on Cloudflare Workers
- **Database:** Cloudflare D1 (SQLite). The binding is `DB` in `api/wrangler.jsonc`.
- **Web:** React, Vite, TanStack Router
- **Language:** TypeScript on both sides
- **Tests:** Vitest, running inside the Workers runtime
- **Quality:** Biome. `pnpm check` and `pnpm typecheck` must pass.

You choose the rest (styling, form library, validation library). Pick tools you can explain.

## The task

The assignment has two parts. Do Part 1 first. Part 2 builds on it.

**Database.** Write the schema as SQL migration files in `api/migrations/`. For example `0001_init.sql`. The tests apply every file in this folder. Your schema must have **at least 3 named constraints** that protect the data. For example a foreign key, a `CHECK`, or a `UNIQUE` key. Be ready to explain what each constraint stops.

**Errors.** Every error response is JSON: `{ "error": "message" }`.

## Part 1: Homes and members

Create a home and add members to it. The order in which members are added matters in Part 2.

#### `POST /api/homes`

- Request: `{ "name": string }`
- Success: `201` `{ id, name }`

#### `POST /api/homes/:homeId/members`

- Request: `{ "name": string }`
- Success: `201` `{ id, homeId, name }`
- Errors: `404` home not found

Visible tests: `api/test/homes.test.ts`.

## Part 2: Bill splitting

Add a bill to a home, split it between the members, and let each member pay their share.

All amounts are whole **cents** (integers). `100` cents is 1 dollar. Never use decimals for money.

#### `POST /api/homes/:homeId/bills`

- Request: `{ "title": string, "totalCents": number }`
- Success: `201` `{ id, homeId, title, totalCents, shares: [{ id, memberId, amountCents, paidAt: null }] }`
- Errors: `404` home not found. `422` total is not a positive whole number, or the home has no members.

#### `POST /api/bills/:billId/shares/:shareId/pay`

- Request: header `Idempotency-Key`
- Success: `200` `{ id, memberId, amountCents, paidAt }`
- Errors: `400` key missing. `404` bill or share not found. `409` share already paid with a different key.

#### `GET /api/homes/:homeId/balances`

- Success: `200` `{ balances: [{ memberId, name, outstandingCents }] }`
- Errors: `404` home not found

**Rules**

- **Split.** A bill is split between all members of the home. The shares always add up to `totalCents`. If the amount does not divide evenly, the extra cents go to the members one by one, in the order the members were added to the home. Example: 1000 cents between 3 members gives `334`, `333`, `333`.
- **Pay.** Paying marks one share as paid and sets `paidAt`. If the same `Idempotency-Key` is sent again for the same share, answer `200` with the same result. Do not pay twice. If two requests pay the same share at the same time, only one may succeed.
- **Balances.** `outstandingCents` is the sum of the member's unpaid shares, across all bills of the home. List the members in the order they were added.

Visible tests: `api/test/bills.test.ts` and `api/test/payments.test.ts`.

#### Web page

Build one page that:

- shows the bills of a home and the shares of each bill,
- lets a member pay a share,
- shows clear **loading**, **empty**, and **error** states,
- keeps the share unpaid and shows an error if the payment fails.

The page must not crash when the API answers with an error or is slow.

## Cases you must handle

You must handle these cases and talk about them in your video:

1. A home with no members.
2. An amount that is zero, negative, or not a whole number.
3. An amount that does not divide evenly.
4. The same payment request sent twice.
5. Two members paying the same share at the same time.
6. A bill or share that does not exist.
7. The API answers with a 500 error or is slow. The web page must not crash.

## Run it

This is a pnpm workspace. Install once at the root.

```bash
pnpm install
pnpm dev          # api on :8787 and web on :5173
```

Open http://localhost:5173. The starter page shows a title. `/api/health` returns `{ "status": "ok" }`.

```bash
pnpm test         # run the visible tests in api/test
pnpm check        # Biome: format and lint. Must pass.
pnpm check:fix    # fix what Biome can fix
pnpm typecheck    # tsc on both packages. Must pass.
pnpm build        # production build of the web app
```

`pnpm dev` applies your migrations to a local database before it starts the API.

If pnpm says some build scripts were ignored, run `pnpm approve-builds` and allow `esbuild` and `workerd`.

When you change `api/wrangler.jsonc`, refresh the `Env` types:

```bash
pnpm --filter bill-splitter-api cf-typegen
```

## Rules for the tests

- The visible tests are in `api/test`. They start with a failing result. Your job is to make them pass.
- Do **not** change the visible tests or `api/test/helpers.ts`. We compare them with the original.
- We run extra tests after you submit. They test the cases in "Cases you must handle" more closely.

## AI policy

You can use AI tools. Tell us which ones and where in your answers on the form.
You must understand every line you submit. We check this with your video and in a live call. "The AI wrote it" is not an answer.

## How to submit

1. Click **Use this template**, then **Create a new repository**. Make the repository **public**.
2. Build your solution in your new repository. Small, clear commits are welcome.
3. Update this README with a short section called **Decisions**. Write 3 decisions you made and why.
4. Record a video of **3 minutes or less** (Loom or unlisted YouTube). Show the architecture, the data flow, and one trade-off you made. Make sure anyone with the link can view it.
5. Paste the repository link and the video link in the application form.

We will run `pnpm install && pnpm check && pnpm typecheck && pnpm test` on your repository.

## Decisions

1. **Let SQLite protect consistency.** Named checks, unique keys and composite foreign keys reject invalid amounts, duplicate shares and cross-home relationships. Bill creation uses a D1 batch transaction and a single membership snapshot. An autoincrement sequence preserves insertion order even when timestamps would tie.
2. **Use integer arithmetic and conditional payments.** Totals must be positive safe JavaScript integers. SQLite explicitly casts D1-bound numbers to integers before division; window functions allocate remainder cents in member order. Payment is a conditional SQL update on an unpaid share. The stored key and timestamp make retries stable, while a competing key receives 409.
3. **Confirm payments before changing the page.** The client validates response shapes, catches server/network failures and aborts requests after 15 seconds. A failed payment leaves the share unpaid; retries reuse a share-specific key. This trades instant feedback for reliable state. Pending buttons explain the wait, and Refresh reconciles changes from other clients.

## Using the completed app

Run the installation and development commands above, then open http://localhost:5173.
Create a home, add members, and enter bills in **whole cents**, not dollars. A home URL contains its ID and can be bookmarked or shared. You can also open a home by ID from the first screen. New members participate in future bills only. Zero-cent shares are valid when there are fewer cents than members.

Two supporting read endpoints serve the page: `GET /api/homes/:homeId` returns the home and ordered members; `GET /api/homes/:homeId/bills` returns newest bills first, with ordered shares. Both return JSON 404s for unknown homes.

`api/test/defensive.test.ts` adds concurrency, replay, malformed-input, safe-integer, cross-home constraint and persistence coverage. The original supplied tests and helper are unchanged. See [WALKTHROUGH.md](WALKTHROUGH.md) for architecture, constraints, failure demonstrations and a video outline.

## Scope and limits

This is the requested local assignment, with no authentication or real money transfer. Paying a share only records its settlement. Names/titles are trimmed and limited to 200 characters. Idempotency keys are scoped to a share and compared exactly; whitespace-only keys are rejected. Keys are kept in session storage when available and in memory otherwise. Reload-safe retries therefore depend on browser storage being enabled.

Each bill supports up to `Number.MAX_SAFE_INTEGER` cents. An aggregate outstanding balance outside that range returns a JSON 500 instead of silently returning rounded money. Lists are unpaginated for this small assignment. Separate read requests can briefly observe different snapshots if another browser writes concurrently; Refresh reconciles them. There is no automatic polling. A production deployment would need authentication, pagination, and an actual Cloudflare D1 database ID; the supplied binding remains configured for local use.

## AI disclosure

OpenAI Codex assisted with implementation, defensive tests, UI styling, debugging and documentation. Review and adapt the code, and disclose that assistance in the application form. Record your own video and be ready to explain and refactor the submitted code without assistance.

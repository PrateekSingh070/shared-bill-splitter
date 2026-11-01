# Understand the solution before submitting

## Architecture and data flow

React + TanStack Router → Vite `/api` proxy → Hono Worker → D1 SQLite.

- `api/migrations/0001_init.sql`: homes, ordered members, bills and shares.
- `api/src/index.ts`: HTTP validation, SQL operations and JSON error handling.
- `api/src/models.ts`: response types, imported as types by the web client.
- `web/src/api.ts`: fetch timeout, JSON parsing, runtime response validation.
- `web/src/routes/index.tsx`: one page, forms, loading/errors and payment state.
- `web/src/payments.ts`: typed pending/failed states and stable payment-key storage.

Creating a bill validates the home, title, total and member existence. A D1 batch inserts the bill and all shares, then reads shares back in insertion order. D1 rolls back the whole batch if a statement fails. The share insert calculates `total / count` plus one cent for the first `total % count` members. `CAST` matters: D1 binds JavaScript numbers as SQLite real values, so implicit division can produce fractional cents.

Paying performs `UPDATE ... WHERE paid_at IS NULL`. SQLite serializes writes. Only one request can change an unpaid share; subsequent reads compare the stored key. The winning key gets the stored timestamp on every retry. Another key receives 409. There is no separate ledger or external payment provider because this task only records settlement.

Balances left-join unpaid shares onto every member, sum their cents, and order by the member sequence. Members with no shares still appear with zero. Adding a member never rewrites historical shares.

## Constraints to explain

| Named constraint                      | What it prevents                                                          |
| ------------------------------------- | ------------------------------------------------------------------------- |
| `members_home_fk`                     | A member referencing a nonexistent home.                                  |
| `bills_total_positive`                | Zero, negative, fractional or out-of-range bill totals.                   |
| `shares_amount_nonnegative`           | Invalid share amounts; zero remains valid.                                |
| `shares_bill_fk` / `shares_member_fk` | A share linking a bill and member from different homes.                   |
| `shares_one_per_member`               | Duplicate shares for the same bill/member pair.                           |
| `shares_payment_pair`                 | A payment timestamp without a nonempty key, or a key without a timestamp. |

## Required cases and demonstrations

1. Create a home with no members. Bill creation is disabled in the page and the API returns 422.
2. Try zero, negative, fractional, string and unsafe totals. The API rejects them with 422, even if client validation is bypassed.
3. Add Asha, Ben and Chitra; split 1000 cents. Show 334, 333, 333 and their exact sum.
4. Replay a payment using the same key. Show identical `paidAt` and unchanged balances after the first payment.
5. Send two different keys concurrently for one share. The extra API test expects one 200 and one 409. Concurrent identical keys all return the same 200 result.
6. Try a nonexistent bill/share, or an existing share through the wrong bill URL. Show JSON 404 and no mutation.
7. In browser developer tools, block the payment request or take the network offline, then click Pay share. The row remains unpaid and shows an error. Restore the network and retry. To demonstrate slowness, throttle the connection: a pending state appears and requests time out after 15 seconds. A timeout does not prove the server failed; reusing the same key resolves that uncertainty.

The page updates the paid share only after a validated 200 response, then refreshes the household. If that refresh fails, the confirmed paid row stays paid, and a page-level error offers retry. Stale fetch generations are ignored to avoid older responses overwriting newer page data.

## Three-minute video outline

- **0:00–0:25:** Show the one-page app and the React → Hono → D1 flow. Explain that amounts are whole cents.
- **0:25–0:55:** Show the schema and explain three named constraints and the insertion sequence.
- **0:55–1:25:** Demo 1000 cents split across three members. Show the integer division/remainder SQL and transaction.
- **1:25–2:00:** Pay one share. Show the conditional update and explain same-key replay versus different-key conflict. Show the concurrent test.
- **2:00–2:35:** Show the empty home and invalid/missing-resource tests. Demonstrate a payment network failure and retry.
- **2:35–2:55:** Explain the trade-off: confirmed server state before marking paid, with a 15-second timeout and stable retry key. Mention that production would need authentication and pagination.

Use your own words after you can explain every statement. Do not claim to have written the code without AI assistance.

## Submission steps

1. Review and personalize the implementation. Run `pnpm install`, `pnpm check`, `pnpm typecheck`, `pnpm test` and `pnpm build`.
2. Create your own public repository from the provided template and copy this solution into it, including migrations, source, added tests, README and lockfile. Exclude `node_modules`, generated Worker types, `.wrangler` and `web/dist`.
3. Commit and push your reviewed code. Verify the public repository is readable while signed out.
4. Record your own video of at most three minutes. Publish an accessible Loom or unlisted YouTube link.
5. Submit the public repository link, video link and accurate AI disclosure in the application form.

## Practice without AI

Before recording, answer these aloud while pointing to the relevant code:

1. Why does 1000 split into 334, 333, 333? What happens for 1 cent and three members?
2. What makes the member sequence safer than sorting by a timestamp?
3. Why does bill creation need a transaction, and why does the share insert use a window function?
4. Why can a read-then-write payment handler let two requests succeed? Which SQL predicate prevents that here?
5. After a timeout, why must the browser reuse the same key? What if another browser already paid with a different key?
6. Why do TypeScript types alone fail to protect JSON received over the network?
7. How does the pending/failed union prevent an error message from being mistaken for a loading state?
8. How would you add pagination or authentication without changing the split/payment rules?

Practice refactoring the inline bill markup into a `BillCard` component, changing the maximum name length, and adding an unpaid-share count. Run the checks after each change. These exercises are for understanding; the submission does not need extra features.

## Review notes

The final review retained the atomic SQL payment update, insertion-order splitting, named constraints, and unchanged supplied tests. It replaced ambiguous string payment states with a discriminated union, extracted retry-key management from the page, and required a non-null payment timestamp in successful payment responses. This keeps server error text separate from UI control state and makes the retry behavior easier to explain.

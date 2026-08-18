# Stripe webhook — closing the payment loop

**Status:** approved 2026-08-18 · **Branch:** `feat/stripe-webhook`

## The problem, measured

`POST /billing/checkout` (`app/api/v1/billing.py:56`) already creates a real Stripe
subscription Checkout Session with `client_reference_id=user.id` and `metadata.tier`.
Nothing consumes the result:

- there is **no webhook endpoint**, so a completed payment grants nothing;
- `POST /billing/upgrade` flips the tier only when `DEMO_MODE` is on, and refuses
  otherwise (`billing.py:48`) — correctly, since it is a mock;
- `User` carries only `subscription_tier`; no Stripe identifiers are stored;
- the frontend never calls `/checkout` at all (`frontend/src/api/billing.ts` exposes
  `getPlans`, `getUsage`, `upgrade`).

So a customer can be charged and receive nothing, and the agency persona's business
model does not work outside demo mode.

## Scope

Both directions of money, and nothing else:

| event | effect |
|---|---|
| `checkout.session.completed` | store Stripe ids, grant the purchased tier |
| `customer.subscription.deleted` | drop to `free` — **only** if the event's subscription is the user's current one |
| `invoice.payment_failed` | notification only; the tier does **not** change |

Explicitly **out of scope**: proration/plan-change flows, trials, invoice history,
tax handling, and any second payment provider.

### Why the tier survives a failed payment

Stripe retries a failed invoice for days (dunning) and cancels the subscription only
at the end of that process — which arrives as `customer.subscription.deleted`, the
event already handled above. Dropping the tier on the first failure would punish a
customer whose card had a bad afternoon, and would then need
`invoice.payment_succeeded` handling to undo itself.

### Why the Customer Portal is part of this work, not a follow-up

The downgrade path is triggered by a cancellation, and today **no customer can
cancel** — only the owner, by hand, in the Stripe dashboard. The same gap makes the
`payment_failed` notification hollow: it tells the user their card failed while
offering nowhere to fix it. `POST /billing/portal` closes both, and costs one
endpoint plus one button because `stripe_customer_id` is already being stored for
the webhook.

## Data

One migration adding two nullable, indexed columns to `users`:

- `stripe_customer_id` — the portal needs it, and `invoice.payment_failed` identifies
  the user by nothing else;
- `stripe_subscription_id` — the match key that makes the downgrade safe.

**No `stripe_events` table.** Every operation here is an assignment, so replay is
already idempotent. The real hazard is *ordering*: a `deleted` event for an old
subscription arriving after a new checkout completed would downgrade a paying
customer. The guard is the match rule — act only when the event's subscription id
equals the user's current one — not an event log.

## Endpoints

### `POST /billing/webhook`

Unauthenticated by necessity; the signature is the authentication.

1. Read the **raw** body before any parsing — the signature covers bytes, not the
   re-serialized JSON.
2. Parse `Stripe-Signature: t=<unix>,v1=<hex>[,v1=<hex>…]`.
3. Compute `HMAC-SHA256(f"{t}.{raw}", STRIPE_WEBHOOK_SECRET)`, compare with
   `hmac.compare_digest` against **every** `v1` candidate (Stripe sends more than one
   during secret rotation).
4. Reject a timestamp older than 300 s (replay window).
5. If `STRIPE_WEBHOOK_SECRET` is unset → **503**. An unsigned event is never
   processed, and a misconfigured deployment must fail loudly rather than accept
   anything.
6. Unknown event types → **200**, logged. A non-2xx makes Stripe retry for days.

House precedent for step 3: `automl_service.py:58-74` already signs blobs with
HMAC-SHA256 and `compare_digest`, so this adds no new dependency and no new idiom.

### `POST /billing/portal`

Requires `stripe_customer_id`; returns a Billing Portal session URL. Refuses with a
clear error when Stripe is unconfigured or the user has never paid.

## Frontend

`UsageResponse` gains two booleans — `payments_enabled` and `has_subscription` — so
the Pricing page can decide without a second round trip (it already loads usage):

- payments enabled → «Yüksəlt» starts `/checkout` and redirects to Stripe;
- demo mode → the existing mock `upgrade` stays;
- subscribed → «Abunəni idarə et» opens the portal.

Keys land in all four bundles (az/en/ru/tr).

## Testing

Signature: valid; wrong secret; stale timestamp; malformed header; several `v1`
candidates where only the last matches; secret missing → 503.

Behaviour: unknown tier in `metadata` grants nothing; unknown user is a 200 with no
write; **a `deleted` event for a superseded subscription leaves the tier alone**; the
same event delivered twice leaves the same state; `payment_failed` writes a
notification and does not touch the tier.

Frontend: the Pricing page routes to checkout when payments are enabled, keeps the
mock in demo, and shows the manage button only for a subscriber.

Each guard is then mutation-tested — a guard that cannot fail is the recurring defect
in this repo.

### What these tests cannot cover

Stripe's actual delivery to our endpoint, and the portal page itself. Both need the
owner's Stripe test key and `stripe listen`. The tests construct signatures
themselves, so the *logic* is fully covered offline; the *network path* is not, and
this document should not be read as claiming otherwise.

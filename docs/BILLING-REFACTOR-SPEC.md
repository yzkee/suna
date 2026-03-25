# Kortix Computer — Billing Refactor Spec

> Date: March 24, 2026
> Status: Spec / Ready for implementation

---

## 0. Design Principle

Two independent billing surfaces, cleanly separated:

| Surface | What it is | Stripe model | Precedent |
|---------|-----------|--------------|-----------|
| **Machines** | 1 subscription = 1 machine. Priced by server specs. Full lifecycle: create, resize, cancel, reactivate. | Per-machine recurring subscription with ad-hoc price | **1:1 justavps.com** |
| **LLM Credits** | OpenRouter-style pay-as-you-go wallet. Per-token deduction with markup. Auto-topup + one-time credit purchases. | One-time Checkout sessions for credit packs. Auto-topup via saved card. | OpenRouter / Anthropic API billing |

These do NOT share a "plan" or "tier". Having a machine doesn't grant credits. Buying credits doesn't give you a machine. They are independent.

The current "Pro $20/mo" tier that bundles "1 machine + $10 credits" is **eliminated**. The tier system is replaced by feature gating based on whether the user is a paying customer (has ≥1 active machine subscription or has ever purchased credits).

---

## 1. What's Broken Today

1. **Subscribe flow doesn't provision a machine.** Checkout modal has a machine picker but subscribe mode sends only `tier_key` — never passes `server_type`/`location`. Webhook sees no `server_type` in metadata → no sandbox provisioned. User pays, gets nothing.

2. **Single subscription ID per account.** `credit_accounts.stripeSubscriptionId` is one column. Second machine subscription overwrites the first. Webhook `syncSubscriptionState` skips "stale" subs.

3. **No per-instance subscription tracking.** justavps.com has a dedicated `subscriptions` table linking `machine ↔ stripe_sub ↔ stripe_item`. Kortix has nothing — billing state sits on the account-wide `credit_accounts` row.

4. **No resize.** justavps.com: stop → change type → restart → update Stripe price with proration. Kortix: no resize endpoint.

5. **No cancel-per-instance.** `cancelSubscription` kills the account-level sub. Should cancel one machine.

6. **Vague Stripe product.** Checkout shows "Kortix AI subscription plans and credits". Should show machine specs like justavps: "Kortix Computer — 4 vCPU / 8 GB RAM / 160 GB SSD".

7. **Tier system conflates machines + credits.** "Pro" = machine + credits bundled. If subscription goes away, credits go away too. These should be independent.

---

## 2. Target: Machine Billing (1:1 justavps.com)

### Flow: Create Machine

Identical to justavps.com `POST /v1/machines`:

1. User picks server type + region in checkout UI
2. Backend looks up managed VPS provider price, applies markup
3. **Has saved card?** → Create Stripe subscription immediately (charge now), provision machine
4. **No card?** → Create Stripe Checkout Session with full machine config in metadata, return checkout URL. Webhook provisions on `checkout.session.completed`.

### Flow: Resize Machine

Port from justavps.com `POST /v1/machines/:id/resize`:

1. Validate: machine must be `active`, new type must be ≥ current (scale-up only — provider disk enlargement is irreversible)
2. Mark sandbox `status = 'resizing'`
3. Background: stop server → `changeType` via provider → start server
4. Update Stripe subscription item price with proration: `stripe.subscriptionItems.update(itemId, { price: newPrice, proration_behavior: 'create_prorations' })`
5. Update DB: `sandbox.serverType`, `sandbox.priceMonthly`, `instance_subscriptions.price_monthly`

### Flow: Cancel Machine

Port from justavps.com `POST /v1/machines/:id/cancel`:

1. Set `cancel_at_period_end = true` on that machine's Stripe subscription
2. Machine keeps running until period end
3. Stripe fires `customer.subscription.deleted` → webhook archives that sandbox

### Flow: Reactivate

Port from justavps.com `POST /v1/machines/:id/reactivate`:

1. Set `cancel_at_period_end = false`
2. Machine continues, no deletion

### Stripe Product Naming

Ad-hoc pricing per machine (same as justavps.com):

```typescript
const price = await stripe.prices.create({
  currency: 'usd',
  unit_amount: Math.round(priceMonthlyUsd * 100),
  recurring: { interval: 'month' },
  product_data: {
    name: `Kortix Computer — ${specs.vcpus} vCPU / ${specs.ramGb} GB RAM / ${specs.diskGb} GB SSD`,
    metadata: { platform: 'kortix', server_type: serverType },
  },
});
```

### Machine Pricing

Same formula as justavps.com but with Kortix markup (currently `COMPUTE_PRICE_MARKUP = 1.2`):

```
customer_price = ceil(provider_price × markup)
```

justavps.com uses 2.0×. Kortix currently uses 1.2×. This is a business decision, not an architecture one. The code is identical, only the multiplier differs.

### Webhook Handling (machines)

Identical to justavps.com:

| Stripe Event | Action |
|-------------|--------|
| `checkout.session.completed` (action=`create_machine`) | Parse `machine_config` from metadata → provision sandbox → insert `instance_subscriptions` row |
| `customer.subscription.updated` | Look up sandbox via `instance_subscriptions` → sync status, price, cancel state. Stop sandbox if `past_due`/`unpaid` |
| `customer.subscription.deleted` | Archive sandbox, stop the managed VPS machine, mark subscription canceled. If 0 active instances remain → user becomes free |
| `invoice.payment_failed` | Look up sandbox via `instance_subscriptions` → stop machine after 3 failed attempts |

---

## 3. Target: LLM Credit Wallet (OpenRouter-style)

Completely independent from machines. Stays on `credit_accounts` table.

### How it works

- User has an account-level **credit balance** (dollars, not abstract units)
- Every LLM call deducts from the balance: `provider_token_cost × 1.2 markup`
- Every tool call deducts a fixed cost from the balance
- Balance hits zero → LLM calls blocked until topped up

### Funding sources

| Method | Stripe model | How |
|--------|-------------|-----|
| **Credit purchase** | One-time Checkout Session (`mode: 'payment'`) | Pre-set packs: $10, $25, $50, $100, $250, $500. Already implemented. |
| **Auto-topup** | Direct charge on saved card (no Checkout) | When balance < threshold, charge topup amount. Already implemented. Defaults: charge $20 when balance < $5. |

### No "monthly credit grant"

The current system grants $10/mo in expiring credits when a Pro subscription renews. **This goes away.** Credits are purely prepaid / auto-topped. No subscription cycle tied to credits.

The auto-topup system already handles the "never run out" experience — it charges the card when balance gets low. This is cleaner than tying credit grants to machine subscription cycles.

### What triggers credit wallet creation

- User purchases credits → `credit_accounts` row created
- User creates a machine (and has saved card) → auto-topup gets enabled by default
- User enables auto-topup from settings

---

## 4. Feature Gating (replaces tiers)

Current tier system: `free` → `pro` (with 8 legacy tiers). This is replaced:

| Condition | Feature access |
|-----------|---------------|
| **No machine, no credits** (free) | BYOC only: connect own instance, bring own API keys. Basic models (Haiku). |
| **Has ≥1 active machine OR has credit balance > 0** (customer) | All models. Can purchase credits. Auto-topup available. Full platform. |

Implementation: instead of `getTier(account.tier)`, check:
```typescript
function isPayingCustomer(accountId: string): boolean {
  // Has active machine subscription OR has ever purchased credits
  return hasActiveInstanceSubscription(accountId) || hasCreditBalance(accountId);
}
```

No more `tier_2_20`, `tier_6_50`, etc. No more `isUpgrade()`, `isDowngrade()`, `scheduleDowngrade()`. All that goes away.

---

## 5. Data Model

### New table: `instance_subscriptions`

Direct port from justavps.com's `subscriptions` table:

```sql
CREATE TABLE instance_subscriptions (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sandbox_id                  TEXT NOT NULL,          -- FK to sandboxes
  account_id                  TEXT NOT NULL,
  
  -- Stripe
  stripe_subscription_id      TEXT NOT NULL,
  stripe_subscription_item_id TEXT,
  stripe_checkout_session_id  TEXT,
  
  -- Lifecycle
  status                      TEXT NOT NULL DEFAULT 'active',  -- active | canceled | past_due
  cancel_at_period_end        BOOLEAN DEFAULT FALSE,
  cancel_at                   TIMESTAMPTZ,
  cancelled_at                TIMESTAMPTZ,
  current_period_start        TIMESTAMPTZ,
  current_period_end          TIMESTAMPTZ,
  
  -- Machine billing
  price_monthly               NUMERIC(10,2),
  server_type                 TEXT,
  location                    TEXT,
  billing_interval            TEXT DEFAULT 'monthly',
  
  created_at                  TIMESTAMPTZ DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_inst_sub_sandbox  ON instance_subscriptions(sandbox_id);
CREATE INDEX idx_inst_sub_account  ON instance_subscriptions(account_id);
CREATE INDEX idx_inst_sub_stripe   ON instance_subscriptions(stripe_subscription_id);
```

### Changes to `credit_accounts`

| Column | Change |
|--------|--------|
| `tier` | **Deprecated.** Derive from `instance_subscriptions` + credit balance instead. Keep column for backward compat, stop relying on it. |
| `stripeSubscriptionId` | **Deprecated.** Machine subs move to `instance_subscriptions`. Keep column, stop writing. |
| `stripeSubscriptionStatus` | **Deprecated.** Same. |
| `planType` | **Deprecated.** No more plans. |
| `scheduledTierChange` | **Delete.** No more tier scheduling. |
| `scheduledTierChangeDate` | **Delete.** |
| `scheduledPriceId` | **Delete.** |
| `commitmentType` | **Delete.** Monthly only for now. |
| `commitmentEndDate` | **Delete.** |
| `balance` | **Keep.** Core credit wallet. |
| `expiringCredits` | **Deprecate.** No more monthly grants that expire. |
| `nonExpiringCredits` | **Keep** — all credits are now non-expiring (purchased or auto-topped). |
| `autoTopupEnabled` | **Keep.** |
| `autoTopupThreshold` | **Keep.** |
| `autoTopupAmount` | **Keep.** |
| `dailyCreditsBalance` | **Deprecate.** No more free-tier daily refresh. |

### `sandboxes` table

No schema changes. The `metadata` JSON field already stores `stripe_subscription_id` as a denormalized cache. Source of truth moves to `instance_subscriptions`.

---

## 6. API Surface

### Machine lifecycle (new routes under `/platform/sandbox`)

All ported from justavps.com. Auth via existing Supabase middleware.

```
POST   /platform/sandbox                          Create machine (existing, modified)
POST   /platform/sandbox/:id/resize               Resize machine (NEW)
POST   /platform/sandbox/:id/cancel               Cancel at period end (NEW)
POST   /platform/sandbox/:id/reactivate           Reactivate cancelled (NEW)
DELETE /platform/sandbox/:id                       Destroy machine (existing, unchanged)
```

#### `POST /platform/sandbox` (modified)

Currently provisions without billing in cloud mode and delegates to a separate checkout for billing. Changed to match justavps.com:

```typescript
// Request
{
  provider: 'justavps',
  server_type: 'cpx21',
  location: 'hel1',
  name?: 'my-computer',
}

// Response 202: machine provisioning started (has saved card)
{ sandbox_id: 'abc', status: 'provisioning', ... }

// Response 402: payment required (no card)
{ requires_checkout: true, checkout_url: 'https://checkout.stripe.com/...' }
```

Backend:
1. Look up price from provider + apply markup
2. Check for saved payment method on Stripe customer
3. **Has card** → `stripe.subscriptions.create(...)` immediately, provision sandbox, insert `instance_subscriptions`
4. **No card** → `stripe.checkout.sessions.create(...)` with `machine_config` in metadata. Return checkout URL. Webhook provisions on completion.

This is **identical** to justavps.com's `POST /v1/machines` flow.

#### `POST /platform/sandbox/:id/resize` (new)

```typescript
// Request
{ server_type: 'cpx31' }

// Response 202
{ action: 'resize', old_type: 'cpx21', new_type: 'cpx31', old_price: 12.50, new_price: 22.00, status: 'initiated' }
```

#### `POST /platform/sandbox/:id/cancel` (new)

```typescript
// Response 200
{ action: 'cancel', status: 'scheduled', cancel_at: '2026-04-24T00:00:00Z' }
```

#### `POST /platform/sandbox/:id/reactivate` (new)

```typescript
// Response 200
{ action: 'reactivate', status: 'completed' }
```

### Credit wallet (existing routes, modified)

```
GET    /billing/account-state                     Full account state (modified)
POST   /billing/purchase-credits                  Buy credit pack (existing, unchanged)
POST   /billing/auto-topup/configure              Configure auto-topup (existing, unchanged)
GET    /billing/auto-topup/settings               Get auto-topup config (existing, unchanged)
GET    /billing/transactions                      Credit history (existing, unchanged)
```

### Removed routes

```
POST   /billing/create-checkout-session           REMOVED — replaced by POST /platform/sandbox
POST   /billing/create-inline-checkout            REMOVED — replaced by POST /platform/sandbox
POST   /billing/confirm-inline-checkout           REMOVED
POST   /billing/cancel-subscription               REMOVED — replaced by POST /platform/sandbox/:id/cancel
POST   /billing/reactivate-subscription           REMOVED — replaced by POST /platform/sandbox/:id/reactivate
POST   /billing/schedule-downgrade                REMOVED — no more tiers
POST   /billing/cancel-scheduled-change           REMOVED — no more tiers
GET    /billing/proration-preview                 REMOVED — proration handled by Stripe directly
POST   /billing/sync-subscription                 REMOVED — webhooks handle sync
```

### Modified: `GET /billing/account-state`

Simplified. No more tier/plan/commitment/scheduling fields. Instead:

```typescript
{
  credits: {
    balance: 14.50,              // total available
    can_run: true,
    auto_topup: {
      enabled: true,
      threshold: 5.00,
      amount: 20.00,
    },
  },
  
  customer: {
    is_paying: true,             // has active instance OR credit balance
    has_payment_method: true,
    stripe_customer_id: 'cus_xxx',
  },
  
  models: [ ... ],              // all models if is_paying, basic if not
  
  instances: [
    {
      sandbox_id: 'abc123',
      name: 'my-computer',
      status: 'active',
      server_type: 'cpx21',
      location: 'hel1',
      price_monthly: 12.50,
      subscription: {
        id: 'sub_xxx',
        status: 'active',
        cancel_at_period_end: false,
        cancel_at: null,
        current_period_end: '2026-04-24T00:00:00Z',
      },
    },
  ],
  
  can_add_instances: true,      // true if is_paying
  
  limits: {
    max_instances: 10,
    current_instances: 1,
  },
}
```

---

## 7. Webhook Handling

### Machine webhooks (new — port from justavps.com)

All machine subscription events route through `instance_subscriptions` table, NOT `credit_accounts`.

```typescript
// checkout.session.completed
if (metadata.kortix_action === 'create_machine') {
  const config = JSON.parse(metadata.machine_config);
  const sandbox = await provisionSandbox(accountId, config);
  await db.insert(instanceSubscriptions).values({
    sandboxId: sandbox.sandboxId,
    accountId,
    stripeSubscriptionId: subscriptionId,
    stripeSubscriptionItemId: itemId,
    stripeCheckoutSessionId: session.id,
    priceMonthly: parseFloat(metadata.price_monthly),
    serverType: config.server_type,
    location: config.location,
    status: 'active',
  });
}

// customer.subscription.updated
const sub = await db.select().from(instanceSubscriptions)
  .where(eq(instanceSubscriptions.stripeSubscriptionId, subscription.id));
// sync status, cancel_at, period dates, price

// customer.subscription.deleted
const sub = await findInstanceSubscription(subscriptionId);
await archiveSandbox(sub.sandboxId);
await db.update(instanceSubscriptions).set({ status: 'canceled' });

// invoice.payment_failed
const sub = await findInstanceSubscription(subscriptionId);
if (attemptCount >= 3) await stopSandbox(sub.sandboxId);
```

### Credit webhooks (existing — simplified)

```typescript
// checkout.session.completed (mode=payment)
// Already works. Credit purchase → grant credits. No change.

// invoice.paid is NO LONGER used for credit grants.
// Credits are only from purchases + auto-topup. No subscription-cycle grants.
```

---

## 8. Frontend Changes

### Checkout Modal

One flow for both "first machine" and "add machine":

1. User picks region (globe toggle)
2. User picks server type (machine cards with price)
3. CTA button: "Get Your Kortix — $XX/mo"
4. Backend: creates subscription or returns checkout URL
5. No more `mode='subscribe'` vs `mode='add-instance'` distinction — it's always "create a machine"

### Resize Dialog

Port justavps.com's `RescaleDialog`:
- Shows current plan (highlighted) + available upgrades
- Locks out downgrades (greyed, "no downgrade" label)
- Price diff shown with proration notice
- Calls `POST /platform/sandbox/:id/resize`

### Instance Detail / Settings

- Monthly price + billing period end date
- "Cancel subscription" → calls `/cancel`, shows "Cancels on [date]" badge
- "Reactivate" → calls `/reactivate`
- "Scale Up" → opens resize dialog

### Credit Wallet UI

Existing credit purchase modal + auto-topup settings. Stays as-is. Independent from machine billing.

### Kill Tier UI

Remove:
- Plan selection modals
- Tier badges ("Pro", "Free")
- Upgrade/downgrade flows
- Scheduled change cards
- Commitment period UI

Replace with:
- "You have X active machines"
- "Credit balance: $XX.XX"
- Per-instance billing info

---

## 9. Migration Plan

### Phase 1: Unblock machine provisioning (Critical — day 1)

**Smallest fix to stop the bleeding.** Frontend only.

1. `checkout-modal.tsx` subscribe mode: pass `server_type` + `location` to `createCheckoutSession`
2. Home page `handleLaunch`: open checkout modal instead of going straight to Stripe
3. Backend already supports `server_type`/`location` in metadata → webhook already provisions sandbox

This fixes: user pays → machine gets created.

### Phase 2: `instance_subscriptions` table + machine billing routes

1. Create `instance_subscriptions` table (Drizzle migration)
2. Port webhook handlers to route via `instance_subscriptions` (with fallback to `credit_accounts` for legacy subs)
3. Modify `POST /platform/sandbox` to create Stripe subscription (port from justavps.com machine create flow)
4. Add `POST /platform/sandbox/:id/resize`
5. Add `POST /platform/sandbox/:id/cancel`
6. Add `POST /platform/sandbox/:id/reactivate`
7. Update `GET /billing/account-state` to include per-instance subscription data from new table
8. Backfill existing sandboxes with `metadata.stripe_subscription_id` into `instance_subscriptions`

### Phase 3: Ad-hoc Stripe pricing

1. Replace pre-created Stripe Price IDs with ad-hoc price creation per machine
2. Product name: `Kortix Computer — X vCPU / Y GB RAM / Z GB SSD`
3. Port `formatProductName`, `resolveStripePrice`, `createMachineSubscription`, `updateMachineSubscription` from justavps.com `stripe.ts`

### Phase 4: Kill tiers, decouple credits

1. Remove `tier` concept from feature gating — replace with `isPayingCustomer()` check
2. Remove monthly credit grants from `invoice.paid` handler
3. Remove expiring credits logic
4. Remove tier upgrade/downgrade/scheduling code
5. Remove legacy tier definitions (tier_2_20, tier_6_50, etc.)
6. Frontend: remove tier UI, replace with machine-list + credit-wallet UI

### Phase 5: Frontend cleanup

1. Port `RescaleDialog` from justavps.com
2. Add per-instance cancel/reactivate to instance detail page
3. Update checkout modal to unified "create machine" flow (no subscribe vs add-instance)
4. Kill plan selection modals, tier badges, scheduled change cards

### Phase 6: Cleanup + deprecation

1. Deprecate unused `credit_accounts` columns (`stripeSubscriptionId`, `tier`, `planType`, scheduled* fields)
2. Remove dead billing routes (`create-checkout-session`, `create-inline-checkout`, `schedule-downgrade`, etc.)
3. Remove `sandbox-provisioner.ts` metadata-based sub tracking (replaced by `instance_subscriptions`)
4. Clean up old Stripe Price IDs from config

---

## 10. What Stays Unchanged

- **LLM billing engine**: `deductLLMCredits`, `deductToolCredits`, `checkCredits` — all unchanged
- **Auto-topup**: threshold + amount + charge card — unchanged
- **Credit purchases**: one-time Checkout sessions for $10/$25/$50/$100/$250/$500 — unchanged
- **Supabase auth + middleware**: unchanged
- **Provider abstraction**: JustAVPS provider — unchanged
- **RevenueCat (mobile)**: stays as-is, separate path
- **Sandbox lifecycle**: provisioning, ensure-sandbox, status polling — unchanged (only billing wrapper changes)

---

## 11. Comparison: justavps.com vs Kortix Computer (target)

| Aspect | justavps.com | Kortix Computer (target) |
|--------|-------------|--------------------------|
| Machine billing | 1 sub = 1 machine ✓ | 1 sub = 1 machine ✓ (same) |
| Pricing | Provider price × 2.0 | Provider price × configurable markup |
| Stripe model | Ad-hoc prices per machine | Ad-hoc prices per machine (same) |
| Resize | Scale-up, prorated | Scale-up, prorated (same) |
| Cancel | Per-instance, at period end | Per-instance, at period end (same) |
| Webhooks | `checkout.completed` → provision, `sub.deleted` → archive | Same |
| Subscription table | `subscriptions` (machine_id, stripe_sub, stripe_item) | `instance_subscriptions` (sandbox_id, stripe_sub, stripe_item) — same shape |
| Backups pricing | +20% surcharge | Future (not in v1) |
| Yearly billing | monthly/yearly/2year | Monthly only (v1) |
| Guest checkout | Yes | Future (not in v1) |
| **LLM credits** | None | OpenRouter-style wallet (Kortix addition) |
| **Auto-topup** | None | Yes — charge card when balance low (Kortix addition) |
| **Credit purchases** | None | $10-$500 packs via Stripe Checkout (Kortix addition) |
| **Per-token billing** | None | LLM + tool deductions from wallet (Kortix addition) |

The machine billing is **mechanically identical**. Kortix adds the credit wallet on top as an independent system.

---

## 12. One-Time $5 Credit Grant

When a user purchases their **first machine** (first `instance_subscriptions` row for that account), the system grants a one-time $5 credit to their wallet. This is a welcome bonus, not a recurring grant.

```typescript
// In webhook: checkout.session.completed → after inserting instance_subscriptions
const existingInstances = await db.select()
  .from(instanceSubscriptions)
  .where(and(eq(instanceSubscriptions.accountId, accountId), eq(instanceSubscriptions.status, 'active')));

if (existingInstances.length === 1) { // this is their first one
  await grantCredits(accountId, 5.00, 'welcome_grant', 'Welcome bonus: $5 LLM credits', false);
}
```

- **One-time**: only on first machine, not on second/third/etc.
- **Non-expiring**: these credits never expire (unlike the old monthly expiring grants).
- **Idempotent**: check if a `welcome_grant` ledger entry already exists before granting.

---

## 13. Complete File Audit — What Happens To Every File

### Legend
- **KEEP** = no changes needed
- **MODIFY** = needs targeted edits
- **REWRITE** = substantial rewrite (>50% changes)
- **DELETE** = remove entirely
- **NEW** = create from scratch
- **PORT** = port from justavps.com

---

### Backend: `kortix-api/src/billing/`

| File | Action | Details |
|------|--------|---------|
| `index.ts` | **MODIFY** | Remove subscription routes, keep credits + account-state + webhooks. Remove tier gate middleware. |
| `services/tiers.ts` | **REWRITE** | Kill tier definitions, tier ordering, upgrade/downgrade logic, price ID maps. Keep only: `COMPUTE_PRICE_MARKUP`, `CREDITS_PER_DOLLAR`, model pricing config. Replace `isPaidTier()` with `isPayingCustomer()`. |
| `services/subscriptions.ts` | **DELETE** | All 801 lines. Entire file is tier-based subscription management (create checkout, inline checkout, schedule downgrade, etc.). Replaced by machine billing in `platform/routes/sandbox-cloud.ts`. |
| `services/webhooks.ts` | **REWRITE** | Strip all tier logic. `handleSubscriptionCheckout` → route through `instance_subscriptions`. Kill `syncSubscriptionState`, `applyScheduledDowngrade`, `handleScheduleCompleted`. Keep: `handleCreditPurchase`, `processRevenueCatWebhook` (mobile). Add: machine lifecycle hooks routing through `instance_subscriptions`. |
| `services/account-state.ts` | **REWRITE** | Kill tier display, scheduled change, commitment, monthly credits. New shape: `{ credits, customer, models, instances, limits }`. Instances come from `instance_subscriptions` JOIN `sandboxes`. |
| `services/credits.ts` | **MODIFY** | Keep credit grant/deduct/reset logic. Remove `resetExpiringCredits` (no more expiring monthly grants). Add `grantWelcomeCredits()` with idempotency check. |
| `services/auto-topup.ts` | **MODIFY** | Replace `isPaidTier()` check with `isPayingCustomer()`. Rest stays. |
| `services/yearly-rotation.ts` | **DELETE** | No more yearly credit rotation tied to subscription cycles. |
| `services/account-deletion.ts` | **MODIFY** | Update to also clean up `instance_subscriptions` rows. |
| `routes/subscriptions.ts` | **DELETE** | All 135 lines. Entire router gone. Replaced by machine routes in `platform/routes/`. |
| `routes/account-state.ts` | **MODIFY** | Calls into rewritten `services/account-state.ts`. May need minor response shape updates. |
| `routes/webhooks.ts` | **KEEP** | Just routing — the logic changes are in `services/webhooks.ts`. |
| `routes/payments.ts` | **KEEP** | Credit purchases via Stripe Checkout. Independent from machines. |
| `routes/credits.ts` | **MODIFY** | Remove tier-gated credit purchase check. Anyone with a payment method can buy credits. |
| `routes/account-deletion.ts` | **KEEP** | |
| `repositories/credit-accounts.ts` | **MODIFY** | Keep all balance operations. Remove `getSubscriptionInfo()`, `getYearlyAccountsDueForRotation()`. These become dead code. |
| `repositories/customers.ts` | **KEEP** | Stripe customer ↔ account mapping. Used by both machines and credits. |
| `repositories/transactions.ts` | **KEEP** | Credit ledger queries. |

### Backend: `kortix-api/src/billing/__tests__/`

| File | Action | Details |
|------|--------|---------|
| `subscriptions.test.ts` | **DELETE** | Tests for deleted subscription service. |
| `webhooks.test.ts` | **REWRITE** | New tests for machine-routed webhooks via `instance_subscriptions`. |
| `yearly-rotation.test.ts` | **DELETE** | Yearly rotation is gone. |
| `credits.test.ts` | **MODIFY** | Remove expiring-credit tests. Add welcome-grant tests. |
| `mocks.ts` | **MODIFY** | Update mock data shapes. |
| `account-deletion.test.ts` | **MODIFY** | Add instance_subscriptions cleanup assertions. |

### Backend: `kortix-api/src/shared/`

| File | Action | Details |
|------|--------|---------|
| `stripe.ts` | **REWRITE** | Port from justavps.com `stripe.ts`: ad-hoc pricing, `createMachineSubscription`, `createCheckoutSession` (with machine_config in metadata), `updateMachineSubscription` (resize), `cancelAtPeriodEnd`, `reactivateSubscription`, `formatProductName`. Kill pre-created Price ID logic. |
| `db-schema.ts` | **MODIFY** | Add `instanceSubscriptions` export from `@kortix/db`. |
| `db.ts` | **KEEP** | |

### Backend: `kortix-api/src/platform/`

| File | Action | Details |
|------|--------|---------|
| `services/sandbox-provisioner.ts` | **DELETE** | 108 lines. Metadata-based sub tracking replaced by `instance_subscriptions` table. Provisioning moves inline into the create-machine route. |
| `routes/sandbox-cloud.ts` | **REWRITE** | This is the machine create route. Port billing flow from justavps.com: has-card → direct sub, no-card → checkout 402. Add resize, cancel, reactivate routes. Kill current `createCheckoutSession` delegation. |
| `services/ensure-sandbox.ts` | **MODIFY** | Remove `checkCredits` gate for local mode. Machine creation billing is handled in `sandbox-cloud.ts`. |
| `routes/account.ts` | **MODIFY** | Replace `isPaidTier()` with `isPayingCustomer()`. |

### Backend: `kortix-api/src/router/` (LLM proxy — mostly untouched)

| File | Action | Details |
|------|--------|---------|
| `services/billing.ts` | **KEEP** | `checkCredits`, `deductToolCredits`, `deductLLMCredits` — all wallet operations, independent from machines. |
| `routes/llm.ts` | **KEEP** | Credit check + deduct. |
| `routes/anthropic.ts` | **KEEP** | Credit check + deduct. |
| `routes/search-web.ts` | **KEEP** | Credit check + deduct. |
| `routes/search-image.ts` | **KEEP** | Credit check + deduct. |
| `routes/proxy.ts` | **KEEP** | Credit check + deduct. |
| `config/models.ts` | **MODIFY** | Replace `tier: 'free' | 'paid'` with `requiresPayment: boolean`. Same gating, cleaner name. |
| `config/model-pricing.ts` | **KEEP** | LLM token pricing. |

### Backend: `kortix-api/src/repositories/`

| File | Action | Details |
|------|--------|---------|
| `credits.ts` | **KEEP** | Low-level balance deduction. Used by `router/services/billing.ts`. |

### Backend: `kortix-api/src/config.ts`

| Section | Action | Details |
|---------|--------|---------|
| Tool cost config | **KEEP** | |
| LLM pricing config | **KEEP** | |

### Shared: `packages/db/src/schema/kortix.ts`

| Table | Action | Details |
|-------|--------|---------|
| `creditAccounts` | **MODIFY** | Columns to deprecate (don't delete — backward compat): `tier`, `stripeSubscriptionId`, `stripeSubscriptionStatus`, `planType`, `scheduledTierChange`, `scheduledTierChangeDate`, `scheduledPriceId`, `commitmentType`, `commitmentStartDate`, `commitmentEndDate`, `commitmentPriceId`, `canCancelAfter`, `expiringCredits`, `dailyCreditsBalance`, `billingCycleAnchor`, `nextCreditGrant`, `lastRenewalPeriodStart`, `lastProcessedInvoiceId`, `lastGrantDate`. Columns to keep: `accountId`, `balance`, `nonExpiringCredits`, `lifetimeGranted`, `lifetimePurchased`, `lifetimeUsed`, `autoTopup*`, `paymentStatus`, `lastPaymentFailure`, `provider`, `revenuecat*`, `trialStatus`, `trialStartedAt`, `trialEndsAt`. |
| `instanceSubscriptions` | **NEW** | New table as defined in spec §5. |
| `creditLedger` | **KEEP** | |
| `creditUsage` | **KEEP** | |
| `creditPurchases` | **KEEP** | |
| `billingCustomers` | **KEEP** | |

---

### Frontend: `apps/frontend/src/lib/`

| File | Action | Details |
|------|--------|---------|
| `api/billing.ts` | **REWRITE** | Kill: `CreateCheckoutSessionRequest/Response`, `ScheduleDowngradeRequest/Response`, `CancelScheduledChangeResponse`, `createInlineCheckout`, `confirmInlineCheckout`, `scheduleDowngrade`, `cancelScheduledChange`, `syncSubscription`, tier-related types. Add: `createMachine(serverType, location)`, `resizeMachine(sandboxId, serverType)`, `cancelMachine(sandboxId)`, `reactivateMachine(sandboxId)`. Keep: `getAccountState`, `purchaseCredits`, `getTransactions`, `getAutoTopupSettings`, `configureAutoTopup`, `getServerTypes`. Rewrite `AccountState` interface to new shape (§6). |
| `pricing-config.ts` | **DELETE** | 75 lines. Tier pricing definitions. Gone. |
| `site-config.ts` | **MODIFY** | Remove `cloudPricingItems` (was `pricingTiers`). |
| `config.ts` | **REWRITE** | Kill `SubscriptionTiers`, `SubscriptionTierData`, `TIERS` constant, all legacy tier key defs. Keep: `isBillingEnabled()`, `isSelfHosted()`. |

### Frontend: `apps/frontend/src/stores/`

| File | Action | Details |
|------|--------|---------|
| `subscription-store.tsx` | **REWRITE** | Remove tier-based backward-compat hooks (`useSubscriptionContext`, `useSharedSubscription`). Simplify to just `accountState` + `isLoading` + `refetch`. Kill `dollarsToCredits` conversions (display dollars directly). |
| `pricing-modal-store.ts` | **DELETE** | No more pricing/plan modals. Machine creation goes through checkout modal. |

### Frontend: `apps/frontend/src/hooks/billing/`

| File | Action | Details |
|------|--------|---------|
| `index.ts` | **MODIFY** | Remove re-exports for tier configs, trial hooks. |
| `use-account-state.ts` | **MODIFY** | Kill tier name resolution, `dollarsToCredits`, legacy selectors. New selectors: `isPayingCustomer`, `creditBalance`, `instances`. |
| `use-billing-modal.ts` | **MODIFY** | Simplify — no more tier-based modal open/close logic. |
| `use-tier-configurations.ts` | **DELETE** | 53 lines. Tiers are dead. |
| `use-transactions.ts` | **KEEP** | Credit transaction history. |
| `use-download-restriction.ts` | **MODIFY** | Replace `tier_key === 'free'` with `!isPayingCustomer`. |
| `use-admin-billing.ts` | **MODIFY** | Remove tier references. |

### Frontend: `apps/frontend/src/components/billing/`

| File | Action | Details |
|------|--------|---------|
| `pricing/index.ts` | **MODIFY** | Remove `PlanSelectionModal` export. |
| `pricing/checkout-modal.tsx` | **REWRITE** | Kill `mode='subscribe' | 'add-instance'` distinction. One flow: create machine. Call `POST /platform/sandbox` (which returns 202 or 402 checkout URL). Kill `createCheckoutSession` with `tier_key`. |
| `pricing/new-instance-modal.tsx` | **DELETE** or **MERGE** | Merge into unified checkout-modal. |
| `pricing/pricing-section.tsx` | **REWRITE** | Kill tier comparison UI. Show machine picker + credit wallet info. |
| `plan-utils.ts` | **DELETE** | 64 lines. Tier name/icon resolution. Dead. |
| `tier-badge.tsx` | **DELETE** | Tier badge component. Dead. |
| `upgrade-celebration.tsx` | **DELETE** | "You upgraded to Pro!" celebration. Dead. |
| `scheduled-downgrade-card.tsx` | **DELETE** | Scheduled tier change card. Dead. |
| `subscription-cancellation-card.tsx` | **REWRITE** | Becomes per-instance cancellation card. Shows "This machine cancels on [date]". |
| `credit-purchase.tsx` | **KEEP** | Credit pack purchase UI. Independent from machines. |
| `credits-explained-modal.tsx` | **MODIFY** | Update copy — no more "included with Pro" language. Credits are pay-as-you-go. |
| `billing-history.tsx` | **KEEP** | Transaction history. |
| `credit-transactions.tsx` | **KEEP** | Transaction list. |

### Frontend: `apps/frontend/src/components/billing/` — NEW FILES

| File | Action | Details |
|------|--------|---------|
| `rescale-dialog.tsx` | **PORT** from justavps.com | Machine resize dialog. Scale-up picker with price diff + proration notice. |
| `instance-billing-card.tsx` | **NEW** | Per-instance billing info: price, period end, cancel/reactivate buttons. |

### Frontend: Other files with billing imports

| File | Action | Details |
|------|--------|---------|
| `components/settings/user-settings-modal.tsx` | **MODIFY** | Remove tier badges, plan name display, scheduled downgrade card, upgrade celebration. Replace with machine list + credit balance. |
| `components/sidebar/user-menu.tsx` | **MODIFY** | Remove `TierBadge`, `PlanSelectionModal`. Show credit balance + instance count. |
| `components/sidebar/server-selector.tsx` | **MODIFY** | Replace `can_add_instances` logic (currently tier-gated) with `isPayingCustomer`. |
| `components/command-palette.tsx` | **MODIFY** | Remove `PlanSelectionModal` import. |
| `components/layout/app-providers.tsx` | **MODIFY** | Remove `NewInstanceModal` if merged into checkout-modal. |
| `components/ui/upgrade-dialog.tsx` | **DELETE** | "Upgrade to Pro" dialog. Dead. |
| `app/(home)/page.tsx` | **MODIFY** | `handleLaunch` → open checkout modal (machine picker) instead of calling `createCheckoutSession` with `tier_key: 'pro'`. |
| `app/(home)/variant-2/page.tsx` | **MODIFY** | Same as above. |
| `app/(home)/pricing/page.tsx` | **REWRITE** | Kill tier comparison table. Show machine pricing + credit wallet info. |
| `app/instances/page.tsx` | **MODIFY** | Remove `NewInstanceModal` import if merged. Update checkout redirect handler. |
| `app/subscription/page.tsx` | **DELETE** | Legacy redirect page for old `/subscription` URL. |
| `app/activate-trial/page.tsx` | **DELETE** | Trial activation page. No more trials. |
| `app/auth/callback/route.ts` | **MODIFY** | Replace `tier_key` check with `isPayingCustomer`. |
| `app/auth/actions.ts` | **MODIFY** | Remove `createTrialCheckout` import. Replace tier checks with customer status. |
| `hooks/onboarding/use-onboarding.ts` | **MODIFY** | Replace `hasPaidTier` check with `isPayingCustomer`. |

### Frontend: Mobile (`apps/mobile/`) — LEAVE FOR LATER

Mobile billing (RevenueCat) is a separate system. Don't touch it in this refactor. Files listed for awareness:

| Directory | Status |
|-----------|--------|
| `lib/billing/*` (14 files) | **DEFER** — RevenueCat path, separate refactor |
| `hooks/billing/*` | **DEFER** |
| `components/billing/*` (8 files) | **DEFER** |
| `app/billing.tsx` | **DEFER** |
| `app/plans.tsx` | **DEFER** |
| `stores/billing-modal-store.ts` | **DEFER** |

---

## 14. File Count Summary

| Action | Backend | Frontend | DB Schema | Total |
|--------|---------|----------|-----------|-------|
| **DELETE** | 5 files | 9 files | 0 | **14** |
| **REWRITE** | 5 files | 6 files | 0 | **11** |
| **MODIFY** | 11 files | 16 files | 1 | **28** |
| **NEW** | 0 | 2 files | 1 table | **3** |
| **PORT** | 1 (stripe.ts) | 1 (rescale-dialog) | 0 | **2** |
| **KEEP** | 12 files | 7 files | 4 tables | **23** |
| **DEFER** (mobile) | 0 | ~25 files | 0 | **~25** |

**Total files touched: ~58** (excluding mobile defer and test files)

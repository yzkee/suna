/**
 * Tests for Phase 1 billing fix: checkout.session.completed with server_type
 * triggers sandbox provisioning.
 *
 * Verifies:
 *  1. When server_type IS in checkout metadata → provisionSandboxFromCheckout is called
 *  2. When server_type is NOT in metadata → no provisioning (legacy tier-only flow)
 *  3. Provisioning receives correct params (accountId, serverType, location, subscriptionId)
 *  4. Provisioning failure does NOT prevent the subscription from being recorded
 *  5. Credits are still granted alongside provisioning
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import {
  createMockCreditAccount,
  createMockStripeCheckoutSession,
  createMockStripeEvent,
  createMockStripeClient,
  mockRegistry,
  registerGlobalMocks,
  registerCreditsMock,
  resetMockRegistry,
} from './mocks';

// Register mocks BEFORE importing the module under test
registerGlobalMocks();
registerCreditsMock();

// Module under test
const { processStripeWebhook } = await import('../../billing/services/webhooks');

// ─── Track calls ──────────────────────────────────────────────────────────────

let provisionCalls: any[] = [];
let grantCreditsCalls: any[] = [];
let upsertCreditAccountCalls: any[] = [];
let upsertCustomerCalls: any[] = [];
let eventCounter = 0;

beforeEach(() => {
  provisionCalls = [];
  grantCreditsCalls = [];
  upsertCreditAccountCalls = [];
  upsertCustomerCalls = [];
  resetMockRegistry();

  mockRegistry.stripeClient = createMockStripeClient();
  mockRegistry.getCreditAccount = async () => createMockCreditAccount();
  mockRegistry.getCreditBalance = async () => {
    const a = createMockCreditAccount();
    return { balance: a.balance, expiringCredits: a.expiringCredits, nonExpiringCredits: a.nonExpiringCredits, dailyCreditsBalance: a.dailyCreditsBalance, tier: a.tier };
  };
  mockRegistry.updateCreditAccount = async () => {};
  mockRegistry.upsertCreditAccount = async (_id: string, data: any) => {
    upsertCreditAccountCalls.push(data);
  };
  mockRegistry.insertLedgerEntry = async (data: any) => ({ id: 'ledger_test', ...data });
  mockRegistry.getPurchaseByPaymentIntent = async () => null;
  mockRegistry.updatePurchaseStatus = async () => {};
  mockRegistry.getCustomerByStripeId = async () => ({
    id: 'cus_test_123', accountId: 'acc_test_123', email: 'test@example.com', provider: 'stripe', active: true,
  });
  mockRegistry.upsertCustomer = async (data: any) => { upsertCustomerCalls.push(data); };
  mockRegistry.grantCredits = async (...args: any[]) => { grantCreditsCalls.push(args); };
  mockRegistry.resetExpiringCredits = async () => {};
  mockRegistry.provisionSandboxFromCheckout = async (...args: any[]) => {
    provisionCalls.push(args);
  };
});

/** Create an event with a guaranteed unique ID to bypass in-memory dedup */
function uniqueEvent(type: string, object: any) {
  return createMockStripeEvent(type, object, { id: `evt_provision_${++eventCounter}` });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('checkout.session.completed: instance provisioning', () => {

  test('calls provisionSandboxFromCheckout when server_type is in metadata', async () => {
    const session = createMockStripeCheckoutSession({
      metadata: {
        account_id: 'acc_test_123',
        tier_key: 'pro',
        commitment_type: 'monthly',
        server_type: 'basic',
        location: 'hel1',
      },
    });
    const event = uniqueEvent('checkout.session.completed', session);
    mockRegistry.stripeClient.webhooks.constructEvent = () => event;

    await processStripeWebhook(JSON.stringify(event), 'sig');

    expect(provisionCalls.length).toBe(1);
    const call = provisionCalls[0][0]; // first arg is the params object
    expect(call.accountId).toBe('acc_test_123');
    expect(call.serverType).toBe('basic');
    expect(call.location).toBe('hel1');
    expect(call.subscriptionId).toBe('sub_test_123');
    expect(call.tierKey).toBe('pro');
  });

  test('does NOT provision when server_type is absent from metadata', async () => {
    const session = createMockStripeCheckoutSession({
      metadata: {
        account_id: 'acc_test_123',
        tier_key: 'pro',
        commitment_type: 'monthly',
        // no server_type, no location
      },
    });
    const event = uniqueEvent('checkout.session.completed', session);
    mockRegistry.stripeClient.webhooks.constructEvent = () => event;

    await processStripeWebhook(JSON.stringify(event), 'sig');

    expect(provisionCalls.length).toBe(0);
  });

  test('still grants credits AND provisions when both server_type and tier_key are present', async () => {
    const session = createMockStripeCheckoutSession({
      metadata: {
        account_id: 'acc_test_123',
        tier_key: 'pro',
        commitment_type: 'monthly',
        server_type: 'pro',
        location: 'ash',
      },
    });
    const event = uniqueEvent('checkout.session.completed', session);
    mockRegistry.stripeClient.webhooks.constructEvent = () => event;

    await processStripeWebhook(JSON.stringify(event), 'sig');

    // Pro tier has 0 monthly credits, but $5 machine bonus is granted at checkout
    expect(grantCreditsCalls.length).toBe(1);
    expect(grantCreditsCalls[0][0]).toBe('acc_test_123');
    expect(grantCreditsCalls[0][1]).toBe(5); // $5 machine bonus
    expect(grantCreditsCalls[0][2]).toBe('machine_bonus');

    // Provisioning also happened
    expect(provisionCalls.length).toBe(1);
    expect(provisionCalls[0][0].serverType).toBe('pro');
    expect(provisionCalls[0][0].location).toBe('ash');
  });

  test('provisioning failure does not block subscription creation', async () => {
    mockRegistry.provisionSandboxFromCheckout = async () => {
      throw new Error('Provider API timeout');
    };

    const session = createMockStripeCheckoutSession({
      metadata: {
        account_id: 'acc_test_123',
        tier_key: 'pro',
        commitment_type: 'monthly',
        server_type: 'basic',
        location: 'hel1',
      },
    });
    const event = uniqueEvent('checkout.session.completed', session);
    mockRegistry.stripeClient.webhooks.constructEvent = () => event;

    // Should NOT throw — provisioning error is caught internally
    await processStripeWebhook(JSON.stringify(event), 'sig');

    // Subscription was still recorded even though provisioning failed
    expect(upsertCreditAccountCalls.length).toBe(1);
    expect(upsertCreditAccountCalls[0].tier).toBe('pro');
  });

  test('passes location as undefined when not provided', async () => {
    const session = createMockStripeCheckoutSession({
      metadata: {
        account_id: 'acc_test_123',
        tier_key: 'pro',
        commitment_type: 'monthly',
        server_type: 'basic',
        // no location
      },
    });
    const event = uniqueEvent('checkout.session.completed', session);
    mockRegistry.stripeClient.webhooks.constructEvent = () => event;

    await processStripeWebhook(JSON.stringify(event), 'sig');

    expect(provisionCalls.length).toBe(1);
    expect(provisionCalls[0][0].serverType).toBe('basic');
    expect(provisionCalls[0][0].location).toBeUndefined();
  });
});

describe('checkout.session.completed: backward compatibility', () => {

  test('legacy tier-only checkout still works (no server_type)', async () => {
    const session = createMockStripeCheckoutSession({
      metadata: {
        account_id: 'acc_test_123',
        tier_key: 'tier_6_50',
        commitment_type: 'monthly',
      },
    });
    const event = uniqueEvent('checkout.session.completed', session);
    mockRegistry.stripeClient.webhooks.constructEvent = () => event;

    await processStripeWebhook(JSON.stringify(event), 'sig');

    // Only tier_grant ($50) — no machine bonus since no server_type in metadata
    expect(grantCreditsCalls.length).toBe(1);
    expect(grantCreditsCalls[0][1]).toBe(50); // tier_6_50 = $50 monthly credits

    // Subscription recorded
    expect(upsertCreditAccountCalls.length).toBe(1);
    expect(upsertCreditAccountCalls[0].tier).toBe('tier_6_50');

    // No provisioning (no server_type)
    expect(provisionCalls.length).toBe(0);
  });
});

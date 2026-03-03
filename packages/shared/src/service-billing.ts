import { findUserById } from "./service-auth.js";

export const DEFAULT_BILLING_CATALOG = {
  currency: "usd",
  runtimeMinuteUsd: 0.03,
  storageGbMonthUsd: 0.015
};

function nowMs(clock) {
  return clock();
}

function nowIso(clock) {
  return new Date(nowMs(clock)).toISOString();
}

export function normalizeUsageTotals(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    runtimeMinutes: Number.isFinite(source.runtimeMinutes) ? Math.max(0, Number(source.runtimeMinutes)) : 0,
    storageGbDays: Number.isFinite(source.storageGbDays) ? Math.max(0, Number(source.storageGbDays)) : 0
  };
}

export function normalizeWorkspaceBilling(billing) {
  const source = billing && typeof billing === "object" && !Array.isArray(billing) ? billing : {};
  return {
    pricingModel: typeof source.pricingModel === "string" ? source.pricingModel : "usage",
    provider: typeof source.provider === "string" ? source.provider : null,
    customerId: typeof source.customerId === "string" ? source.customerId : null,
    billingStatus: typeof source.billingStatus === "string" ? source.billingStatus : null,
    defaultPaymentMethodId: typeof source.defaultPaymentMethodId === "string" ? source.defaultPaymentMethodId : null,
    lastSetupIntentId: typeof source.lastSetupIntentId === "string" ? source.lastSetupIntentId : null,
    lastInvoiceId: typeof source.lastInvoiceId === "string" ? source.lastInvoiceId : null,
    lastInvoiceStatus: typeof source.lastInvoiceStatus === "string" ? source.lastInvoiceStatus : null,
    lastInvoiceCurrency: typeof source.lastInvoiceCurrency === "string" ? source.lastInvoiceCurrency : null,
    lastInvoiceAmountUsd:
      Number.isFinite(source.lastInvoiceAmountUsd) ? Math.max(0, Number(source.lastInvoiceAmountUsd)) : null,
    billedUsageTotals: normalizeUsageTotals(source.billedUsageTotals),
    subscriptionId: typeof source.subscriptionId === "string" ? source.subscriptionId : null,
    subscriptionStatus: typeof source.subscriptionStatus === "string" ? source.subscriptionStatus : null,
    pendingPlan: typeof source.pendingPlan === "string" ? source.pendingPlan : null,
    currentPeriodEnd: typeof source.currentPeriodEnd === "string" ? source.currentPeriodEnd : null,
    cancelAtPeriodEnd: Boolean(source.cancelAtPeriodEnd),
    lastCheckoutSessionId: typeof source.lastCheckoutSessionId === "string" ? source.lastCheckoutSessionId : null,
    lastPortalSessionId: typeof source.lastPortalSessionId === "string" ? source.lastPortalSessionId : null,
    recentWebhookEventIds: Array.isArray(source.recentWebhookEventIds)
      ? source.recentWebhookEventIds.filter((entry) => typeof entry === "string").slice(-25)
      : [],
    creditBalanceUsd: Number.isFinite(source.creditBalanceUsd) ? Math.max(0, Number(source.creditBalanceUsd)) : 0,
    updatedAt: typeof source.updatedAt === "string" ? source.updatedAt : null
  };
}

export function formatWorkspaceBilling(workspace) {
  const billing = normalizeWorkspaceBilling(workspace?.billing);
  return {
    pricingModel: billing.pricingModel,
    provider: billing.provider,
    customerId: billing.customerId,
    billingStatus: billing.billingStatus,
    defaultPaymentMethodId: billing.defaultPaymentMethodId,
    lastSetupIntentId: billing.lastSetupIntentId,
    lastInvoiceId: billing.lastInvoiceId,
    lastInvoiceStatus: billing.lastInvoiceStatus,
    lastInvoiceCurrency: billing.lastInvoiceCurrency,
    lastInvoiceAmountUsd: billing.lastInvoiceAmountUsd,
    billedUsageTotals: billing.billedUsageTotals,
    subscriptionId: billing.subscriptionId,
    subscriptionStatus: billing.subscriptionStatus,
    pendingPlan: billing.pendingPlan,
    currentPeriodEnd: billing.currentPeriodEnd,
    cancelAtPeriodEnd: billing.cancelAtPeriodEnd,
    lastCheckoutSessionId: billing.lastCheckoutSessionId,
    lastPortalSessionId: billing.lastPortalSessionId,
    creditBalanceUsd: billing.creditBalanceUsd,
    updatedAt: billing.updatedAt
  };
}

export function writeWorkspaceBilling(workspace, clock, updates: any = {}) {
  const current = normalizeWorkspaceBilling(workspace?.billing);
  const next = {
    ...current,
    ...updates,
    pricingModel: "usage",
    billedUsageTotals:
      updates.billedUsageTotals !== undefined ? normalizeUsageTotals(updates.billedUsageTotals) : current.billedUsageTotals,
    recentWebhookEventIds: Array.isArray(updates.recentWebhookEventIds)
      ? updates.recentWebhookEventIds.filter((entry) => typeof entry === "string").slice(-25)
      : current.recentWebhookEventIds,
    updatedAt: nowIso(clock)
  };
  workspace.billing = next;
  return next;
}

export function trackBillingWebhookEvent(workspace, clock, eventId) {
  if (!eventId) {
    return { duplicate: false, billing: normalizeWorkspaceBilling(workspace?.billing) };
  }
  const current = normalizeWorkspaceBilling(workspace?.billing);
  if (current.recentWebhookEventIds.includes(eventId)) {
    return { duplicate: true, billing: current };
  }
  return {
    duplicate: false,
    billing: writeWorkspaceBilling(workspace, clock, {
      recentWebhookEventIds: [...current.recentWebhookEventIds, eventId]
    })
  };
}

export function toIsoFromUnixSeconds(value) {
  if (!Number.isFinite(value)) {
    return null;
  }
  return new Date(value * 1000).toISOString();
}

export function normalizeBillingCatalog(catalog: any = {}) {
  const source = catalog && typeof catalog === "object" && !Array.isArray(catalog) ? catalog : {};
  const currency =
    typeof source.currency === "string" && source.currency.trim() ? source.currency.trim().toLowerCase() : "usd";
  const runtimeMinuteUsd = Number.isFinite(source.runtimeMinuteUsd)
    ? Math.max(0, Number(source.runtimeMinuteUsd))
    : DEFAULT_BILLING_CATALOG.runtimeMinuteUsd;
  const storageGbMonthUsd = Number.isFinite(source.storageGbMonthUsd)
    ? Math.max(0, Number(source.storageGbMonthUsd))
    : DEFAULT_BILLING_CATALOG.storageGbMonthUsd;
  return {
    currency,
    runtimeMinuteUsd,
    storageGbMonthUsd
  };
}

export function priceUsageSummary(usage, catalog) {
  const normalizedUsage = normalizeUsageTotals(usage);
  const normalizedCatalog = normalizeBillingCatalog(catalog);
  const runtimeUsd = normalizedUsage.runtimeMinutes * normalizedCatalog.runtimeMinuteUsd;
  const storageGbMonths = Number((normalizedUsage.storageGbDays / 30).toFixed(4));
  const storageUsd = storageGbMonths * normalizedCatalog.storageGbMonthUsd;
  const totalUsd = runtimeUsd + storageUsd;
  return {
    currency: normalizedCatalog.currency,
    usage: {
      ...normalizedUsage,
      storageGbMonths
    },
    rates: {
      runtimeMinuteUsd: normalizedCatalog.runtimeMinuteUsd,
      storageGbMonthUsd: normalizedCatalog.storageGbMonthUsd
    },
    lineItems: [
      {
        metric: "runtimeMinutes",
        quantity: normalizedUsage.runtimeMinutes,
        unitAmountUsd: normalizedCatalog.runtimeMinuteUsd,
        amountUsd: Number(runtimeUsd.toFixed(4))
      },
      {
        metric: "storageGbMonths",
        quantity: storageGbMonths,
        unitAmountUsd: normalizedCatalog.storageGbMonthUsd,
        amountUsd: Number(storageUsd.toFixed(4))
      }
    ],
    totalUsd: Number(totalUsd.toFixed(4))
  };
}

export function getWorkspaceBillingOwner(state, workspace) {
  if (!workspace?.ownerUserId) {
    return null;
  }
  return findUserById(state, workspace.ownerUserId);
}

export function getWorkspaceBillingSource(state, workspace, fallbackUser = null) {
  const owner = getWorkspaceBillingOwner(state, workspace) || fallbackUser || null;
  if (owner?.billing !== undefined) {
    return owner;
  }
  if (workspace?.billing !== undefined) {
    return workspace;
  }
  return owner || workspace || null;
}

export function ensureWorkspaceBillingOwner(state, workspace, fallbackUser = null) {
  const owner = getWorkspaceBillingOwner(state, workspace) || fallbackUser || null;
  if (!owner) {
    return workspace || null;
  }
  if (owner.billing === undefined && workspace?.billing !== undefined) {
    owner.billing = normalizeWorkspaceBilling(workspace.billing);
  }
  return owner;
}

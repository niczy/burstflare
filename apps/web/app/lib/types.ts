export type ApiError = {
  error: string;
  status?: number;
  code?: string;
  requestId?: string;
  details?: unknown;
};

export type RuntimeHealth = {
  containersEnabled: boolean;
  turnstileEnabled: boolean;
  workflowEnabled: boolean;
};

export type HealthResponse = {
  ok: boolean;
  service: string;
  runtime: RuntimeHealth;
};

export type Viewer = {
  user: {
    id: string;
    email: string;
    name: string;
  };
  workspace: {
    id: string;
    name: string;
  };
  membership?: {
    role?: string;
  };
};

export type AuthSession = {
  id: string;
  createdAt?: string;
  expiresAt?: string;
  kind?: string;
  ip?: string | null;
  userAgent?: string | null;
};

export type AuthSessionsResponse = {
  sessions: AuthSession[];
};

export type BillingSummaryResponse = {
  billing?: {
    provider?: string;
    billingStatus?: string;
    defaultPaymentMethodId?: string | null;
  };
  estimate?: {
    totalUsd?: number;
    currency?: string;
  };
};

export type BillingCheckoutResponse = {
  url?: string;
};

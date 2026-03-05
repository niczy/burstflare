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

export type InstanceRecord = {
  id: string;
  name: string;
  description?: string;
  image?: string;
  baseImage?: string;
  commonStateBytes?: number;
  commonStateUpdatedAt?: string | null;
  persistedPaths?: string[];
  sleepTtlSeconds?: number | null;
  createdAt?: string;
  updatedAt?: string;
};

export type InstancesResponse = {
  instances: InstanceRecord[];
};

export type SessionRecord = {
  id: string;
  name: string;
  state: string;
  instanceId?: string | null;
  instanceName?: string | null;
  instanceBaseImage?: string | null;
  previewUrl?: string | null;
  persistedPaths?: string[];
  runtimeStatus?: string | null;
  runtimeDesiredState?: string | null;
  runtimeState?: string | null;
  sleepTtlSeconds?: number | null;
  updatedAt?: string;
  lastStartedAt?: string | null;
  lastStoppedAt?: string | null;
};

export type SessionsResponse = {
  sessions: SessionRecord[];
};

export type UsageTotals = {
  runtimeMinutes: number;
  storageGbDays: number;
  storageGbMonths: number;
  currentStorageBytes: number;
  currentStorageGb: number;
};

export type UsageLimits = {
  maxRunningSessions?: number;
  maxStorageBytes?: number;
  maxRuntimeMinutes?: number;
};

export type UsageResponse = {
  usage: UsageTotals;
  limits?: UsageLimits;
  overrides?: Record<string, number>;
};

export type AdminReport = {
  members?: number;
  instances?: number;
  sessionsRunning?: number;
  sessionsSleeping?: number;
  sessionsStaleEligible?: number;
  sessionsTotal?: number;
  activeUploadGrants?: number;
  limits?: UsageLimits;
};

export type AdminReportResponse = {
  report: AdminReport;
};

export type AuditRecord = {
  id: string;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  createdAt?: string;
};

export type AuditResponse = {
  audit: AuditRecord[];
};

export type DashboardSnapshot = {
  viewer: Viewer | null;
  instances: InstanceRecord[];
  sessions: SessionRecord[];
  usage: UsageResponse | null;
  report: AdminReport | null;
  audit: AuditRecord[];
  lastRefreshedAt: string | null;
  warning: string | null;
};

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

import {
  createCloudflareClient,
  desiredResourceNames,
  loadCloudflareConfig,
  writeProvisionState
} from "./lib/cloudflare.js";

interface CloudflareScriptError extends Error {
  payload?: unknown;
}

interface EnsureByNameResult<T> {
  resource: T;
  created: boolean;
}

type AttemptResult<T> =
  | { ok: true; label: string; value: T }
  | { ok: false; label: string; error: string; payload: unknown };

type FailedAttempt = Extract<AttemptResult<unknown>, { ok: false }>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function ensureByName<T extends Record<string, any>, K extends keyof T>(
  items: T[],
  field: K,
  name: T[K],
  create: (name: T[K]) => Promise<T>
): Promise<EnsureByNameResult<T>> {
  const existing = items.find((item) => item[field] === name);
  if (existing) {
    return { resource: existing, created: false };
  }
  const resource = await create(name);
  return { resource, created: true };
}

async function attempt<T>(label: string, work: () => Promise<T>): Promise<AttemptResult<T>> {
  try {
    return { ok: true, label, value: await work() };
  } catch (error) {
    const typedError = error as CloudflareScriptError;
    return {
      ok: false,
      label,
      error: typedError.message,
      payload: typedError.payload || null
    };
  }
}

async function main(): Promise<void> {
  const config = await loadCloudflareConfig();
  const names = desiredResourceNames(config);
  const client = createCloudflareClient(config);

  await client.verifyToken();

  const d1List = await client.listD1Databases();
  const kvList = await client.listKvNamespaces();
  const queueListAttempt = await attempt("queues.list", () => client.listQueues());
  const r2ListAttempt = await attempt("r2.list", () => client.listR2Buckets());

  const d1 = await ensureByName(d1List, "name", names.d1, (name) => client.createD1Database(name));
  const kvAuth = await ensureByName(kvList, "title", names.kv.auth, (title) => client.createKvNamespace(title));
  const kvCache = await ensureByName(kvList.concat(kvAuth.created ? [kvAuth.resource] : []), "title", names.kv.cache, (title) =>
    client.createKvNamespace(title)
  );

  const r2Errors: FailedAttempt[] = [];
  let r2Templates = null;
  let r2Snapshots = null;
  let r2Builds = null;
  if (r2ListAttempt.ok) {
    const r2List = r2ListAttempt.value;
    const templatesAttempt = await attempt("r2.templates", () =>
      ensureByName(r2List, "name", names.r2.templates, (name) => client.createR2Bucket(name))
    );
    if (templatesAttempt.ok) {
      r2Templates = templatesAttempt.value;
      const snapshotsAttempt = await attempt("r2.snapshots", () =>
        ensureByName(
          r2List.concat(r2Templates.created ? [r2Templates.resource] : []),
          "name",
          names.r2.snapshots,
          (name) => client.createR2Bucket(name)
        )
      );
      if (snapshotsAttempt.ok) {
        r2Snapshots = snapshotsAttempt.value;
        const buildsAttempt = await attempt("r2.builds", () =>
          ensureByName(
            r2List
              .concat(r2Templates.created ? [r2Templates.resource] : [])
              .concat(r2Snapshots.created ? [r2Snapshots.resource] : []),
            "name",
            names.r2.builds,
            (name) => client.createR2Bucket(name)
          )
        );
        if (buildsAttempt.ok) {
          r2Builds = buildsAttempt.value;
        } else {
          r2Errors.push(buildsAttempt as FailedAttempt);
        }
      } else {
        r2Errors.push(snapshotsAttempt as FailedAttempt);
      }
    } else {
      r2Errors.push(templatesAttempt as FailedAttempt);
    }
  } else {
    r2Errors.push(r2ListAttempt as FailedAttempt);
  }

  const queueErrors: FailedAttempt[] = [];
  let queueBuilds = null;
  let queueReconcile = null;
  if (queueListAttempt.ok) {
    const queueList = queueListAttempt.value;
    const buildsAttempt = await attempt("queues.builds", () =>
      ensureByName(queueList, "queue_name", names.queues.builds, (queueName) => client.createQueue(queueName))
    );
    if (buildsAttempt.ok) {
      queueBuilds = buildsAttempt.value;
      const reconcileAttempt = await attempt("queues.reconcile", () =>
        ensureByName(
          queueList.concat(queueBuilds.created ? [queueBuilds.resource] : []),
          "queue_name",
          names.queues.reconcile,
          (queueName) => client.createQueue(queueName)
        )
      );
      if (reconcileAttempt.ok) {
        queueReconcile = reconcileAttempt.value;
      } else {
        queueErrors.push(reconcileAttempt as FailedAttempt);
      }
    } else {
      queueErrors.push(buildsAttempt as FailedAttempt);
    }
  } else {
    queueErrors.push(queueListAttempt as FailedAttempt);
  }

  const state = {
    environment: config.environment,
    workerName: config.workerName,
    accountId: config.accountId,
    zoneId: config.zoneId,
    domain: config.domain,
    createdAt: new Date().toISOString(),
    resources: {
      d1: {
        name: d1.resource.name,
        id: d1.resource.uuid || d1.resource.id
      },
      kv: {
        auth: {
          title: kvAuth.resource.title,
          id: kvAuth.resource.id
        },
        cache: {
          title: kvCache.resource.title,
          id: kvCache.resource.id
        }
      },
      r2:
        r2Templates && r2Snapshots && r2Builds
          ? {
              templates: {
                name: r2Templates.resource.name
              },
              snapshots: {
                name: r2Snapshots.resource.name
              },
              builds: {
                name: r2Builds.resource.name
              }
            }
          : null,
      queues:
        queueBuilds && queueReconcile
          ? {
              builds: {
                name: queueBuilds.resource.queue_name,
                id: queueBuilds.resource.queue_id
              },
              reconcile: {
                name: queueReconcile.resource.queue_name,
                id: queueReconcile.resource.queue_id
              }
            }
          : null
    },
    warnings: {
      r2: r2Errors.map((entry) => ({ label: entry.label, error: entry.error })),
      queues: queueErrors.map((entry) => ({ label: entry.label, error: entry.error }))
    }
  };

  await writeProvisionState(state, config.stateFile);

  process.stdout.write(
    JSON.stringify(
      {
        accountId: state.accountId,
        domain: state.domain,
        resources: state.resources,
        created: {
          d1: d1.created,
          kvAuth: kvAuth.created,
          kvCache: kvCache.created,
          r2Templates: r2Templates ? r2Templates.created : null,
          r2Snapshots: r2Snapshots ? r2Snapshots.created : null,
          r2Builds: r2Builds ? r2Builds.created : null,
          queueBuilds: queueBuilds ? queueBuilds.created : null,
          queueReconcile: queueReconcile ? queueReconcile.created : null
        },
        warnings: state.warnings
      },
      null,
      2
    ) + "\n"
  );
}

main().catch((error: unknown) => {
  const typedError = error as CloudflareScriptError;
  process.stderr.write(`${typedError.message}\n`);
  if (typedError.payload) {
    process.stderr.write(`${JSON.stringify(typedError.payload, null, 2)}\n`);
  }
  process.exit(1);
});

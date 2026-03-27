const COOLIFY_URL = process.env.COOLIFY_URL!;
const COOLIFY_TOKEN = process.env.COOLIFY_TOKEN!;

async function coolifyFetch(path: string, options: RequestInit = {}) {
  const res = await fetch(`${COOLIFY_URL}/api/v1${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${COOLIFY_TOKEN}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Coolify API ${res.status} ${path}: ${body}`);
  }

  return res.json();
}

export async function createDatabase(prNumber: number) {
  const serverUuid = process.env.COOLIFY_SERVER_UUID!;
  const projectUuid = process.env.COOLIFY_PROJECT_UUID!;
  const environmentName = process.env.COOLIFY_ENVIRONMENT_NAME || "production";

  const dbName = `pr_${prNumber}`;
  const dbPassword = crypto.randomUUID().replace(/-/g, "");

  const result = await coolifyFetch("/databases/postgresql", {
    method: "POST",
    body: JSON.stringify({
      server_uuid: serverUuid,
      project_uuid: projectUuid,
      environment_name: environmentName,
      name: `pr-${prNumber}-db`,
      description: `Preview database for PR #${prNumber}`,
      postgres_user: "postgres",
      postgres_password: dbPassword,
      postgres_db: dbName,
      image: "postgres:16-alpine",
      instant_deploy: true,
    }),
  });

  console.log(`[PR #${prNumber}] Created database: ${result.uuid}`);
  return { uuid: result.uuid, dbName, dbPassword };
}

export async function waitForDatabase(dbUuid: string, maxWaitMs = 60_000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    try {
      const db = await coolifyFetch(`/databases/${dbUuid}`);
      if (db.status === "running") {
        return db;
      }
    } catch {
      // DB may not be ready yet
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error(`Database ${dbUuid} did not start within ${maxWaitMs}ms`);
}

export async function getDatabaseInternalUrl(
  dbUuid: string,
  dbName: string,
  dbPassword: string
) {
  const db = await coolifyFetch(`/databases/${dbUuid}`);
  // Internal Docker hostname is the container name
  const host = db.name || `pr-db-${dbUuid}`;
  return `postgresql://postgres:${dbPassword}@${host}:5432/${dbName}`;
}

export async function setPreviewEnv(
  appUuid: string,
  key: string,
  value: string
) {
  await coolifyFetch(`/applications/${appUuid}/envs`, {
    method: "POST",
    body: JSON.stringify({
      key,
      value,
      is_preview: true,
      is_literal: true,
    }),
  });

  console.log(`[App ${appUuid}] Set preview env: ${key}`);
}

export async function triggerDeploy(appUuid: string, prNumber: number) {
  const result = await coolifyFetch(
    `/deploy?uuid=${appUuid}&pr=${prNumber}`
  );

  console.log(`[PR #${prNumber}] Triggered deploy: ${JSON.stringify(result)}`);
  return result;
}

export async function deleteDatabase(dbUuid: string) {
  await coolifyFetch(`/databases/${dbUuid}`, {
    method: "DELETE",
  });

  console.log(`Deleted database: ${dbUuid}`);
}

export async function listProjectDatabases(): Promise<
  Array<{ uuid: string; name: string; description: string }>
> {
  const projectUuid = process.env.COOLIFY_PROJECT_UUID!;
  const environmentName = process.env.COOLIFY_ENVIRONMENT_NAME || "production";

  const env = await coolifyFetch(
    `/projects/${projectUuid}/${environmentName}`
  );

  return (env.databases || []).map((db: any) => ({
    uuid: db.uuid,
    name: db.name,
    description: db.description,
  }));
}

export async function findDatabaseForPR(
  prNumber: number
): Promise<string | null> {
  const databases = await listProjectDatabases();
  const match = databases.find((db) => db.name === `pr-${prNumber}-db`);
  return match?.uuid ?? null;
}

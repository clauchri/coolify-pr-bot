import { Hono } from "hono";
import { verifyGithubSignature, parsePREvent, type PRAction } from "./github";
import {
  createDatabase,
  waitForDatabase,
  getDatabaseInternalUrl,
  setPreviewEnv,
  triggerDeploy,
  deleteDatabase,
  findDatabaseForPR,
} from "./coolify";

const app = new Hono();

const GITHUB_WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET!;
const APP_UUID = process.env.COOLIFY_APP_UUID!;

const HANDLED_ACTIONS: PRAction[] = [
  "opened",
  "reopened",
  "synchronize",
  "closed",
];

app.get("/health", (c) => c.json({ status: "ok" }));

app.post("/webhook/github", async (c) => {
  const body = await c.req.text();
  const signature = c.req.header("x-hub-signature-256");

  if (!(await verifyGithubSignature(body, signature, GITHUB_WEBHOOK_SECRET))) {
    console.warn("Invalid webhook signature");
    return c.json({ error: "Invalid signature" }, 401);
  }

  const event = c.req.header("x-github-event");
  if (event !== "pull_request") {
    return c.json({ message: "Ignored event", event });
  }

  const payload = JSON.parse(body);
  const pr = parsePREvent(payload);
  if (!pr) {
    return c.json({ error: "Could not parse PR event" }, 400);
  }

  if (!HANDLED_ACTIONS.includes(pr.action)) {
    return c.json({ message: "Ignored action", action: pr.action });
  }

  console.log(
    `[PR #${pr.number}] ${pr.action} — "${pr.title}" by ${pr.sender}`
  );

  // Respond immediately, process async
  const promise = handlePREvent(pr);
  promise.catch((err) =>
    console.error(`[PR #${pr.number}] Error handling ${pr.action}:`, err)
  );

  return c.json({ message: "Processing", pr: pr.number, action: pr.action });
});

async function handlePREvent(
  pr: ReturnType<typeof parsePREvent> & {}
) {
  switch (pr.action) {
    case "opened":
    case "reopened":
      await handlePROpened(pr.number);
      break;
    case "synchronize":
      await handlePRSync(pr.number);
      break;
    case "closed":
      await handlePRClosed(pr.number);
      break;
  }
}

async function handlePROpened(prNumber: number) {
  console.log(`[PR #${prNumber}] Creating preview database...`);

  // 1. Create database on Coolify
  const { uuid: dbUuid, dbName, dbPassword } = await createDatabase(prNumber);

  // 2. Wait for it to be running
  console.log(`[PR #${prNumber}] Waiting for database to start...`);
  await waitForDatabase(dbUuid);

  // 3. Get internal connection URL
  const databaseUrl = await getDatabaseInternalUrl(dbUuid, dbName, dbPassword);
  console.log(`[PR #${prNumber}] Database ready`);

  // 4. Set DATABASE_URL on the app as preview env
  await setPreviewEnv(APP_UUID, "DATABASE_URL", databaseUrl);

  // 5. Trigger the preview deployment
  await triggerDeploy(APP_UUID, prNumber);

  console.log(`[PR #${prNumber}] Preview deployment triggered with database`);
}

async function handlePRSync(prNumber: number) {
  // On new commits, just redeploy — database already exists
  const dbUuid = await findDatabaseForPR(prNumber);
  if (!dbUuid) {
    // Database doesn't exist yet (edge case), create it
    console.log(
      `[PR #${prNumber}] No database found on sync, creating one...`
    );
    await handlePROpened(prNumber);
    return;
  }

  console.log(`[PR #${prNumber}] Redeploying preview (DB already exists)...`);
  await triggerDeploy(APP_UUID, prNumber);
}

async function handlePRClosed(prNumber: number) {
  console.log(`[PR #${prNumber}] Cleaning up preview database...`);

  const dbUuid = await findDatabaseForPR(prNumber);
  if (dbUuid) {
    await deleteDatabase(dbUuid);
    console.log(`[PR #${prNumber}] Database deleted`);
  } else {
    console.log(`[PR #${prNumber}] No database found to clean up`);
  }
}

const port = parseInt(process.env.PORT || "3000");
console.log(`Coolify PR Bot listening on port ${port}`);

export default {
  port,
  fetch: app.fetch,
};

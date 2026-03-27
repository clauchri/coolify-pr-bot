export async function verifyGithubSignature(
  payload: string,
  signature: string | null,
  secret: string
): Promise<boolean> {
  if (!signature) return false;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signed = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  const expected = `sha256=${Buffer.from(signed).toString("hex")}`;

  // Constant-time comparison
  if (expected.length !== signature.length) return false;

  const a = encoder.encode(expected);
  const b = encoder.encode(signature);
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a[i] ^ b[i];
  }
  return mismatch === 0;
}

export type PRAction =
  | "opened"
  | "reopened"
  | "synchronize"
  | "closed";

export interface PREvent {
  action: PRAction;
  number: number;
  merged: boolean;
  repoFullName: string;
  branch: string;
  title: string;
  sender: string;
}

export function parsePREvent(body: any): PREvent | null {
  if (!body.pull_request) return null;

  return {
    action: body.action,
    number: body.pull_request.number,
    merged: body.pull_request.merged ?? false,
    repoFullName: body.repository.full_name,
    branch: body.pull_request.head.ref,
    title: body.pull_request.title,
    sender: body.sender.login,
  };
}

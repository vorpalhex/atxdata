import { Store } from "./store";
import { parseOptions } from "./frontend";
import { loadSchemas } from "./layouts";
import { discover, acquire, retainCatalog, validateBudgets } from "./live";
import { bounds as validateMemberOptions } from "./members";
import { withZip, inventory, serialized, LIMITS } from "./archive";
import { readFile } from "node:fs/promises";
export const REQUIRED: Record<string, string[]> = {
  "import-member": [
    "archive",
    "snapshot",
    "member",
    "start",
    "count",
    "max-expanded",
    "max-seconds",
    "output",
  ],
  "verify-members": ["output"],
  "member-status": ["output"],
  layouts: ["layout"],
  "inventory-members": ["archive"],
  discover: ["output", "max-requests", "max-bytes"],
  acquire: ["output", "id", "max-requests", "max-bytes"],
  catalog: ["output"],
  "catalog-import": ["output", "html"],
};
export const OPTIONAL: Record<string, string[]> = {
  "import-member": ["layout"],
  acquire: ["refresh"],
};
export function generalCommand(command: string) {
  return Object.hasOwn(REQUIRED, command);
}
function argumentsFor(command: string, args: string[]) {
  const required = REQUIRED[command];
  if (!required) throw new Error("unknown general command");
  const allowed = [...required, ...(OPTIONAL[command] ?? [])];
  const v = new Map(
    [
      ...parseOptions(
        args,
        allowed.map((k) => "--" + k),
        required.map((k) => "--" + k),
      ),
    ].map(([k, value]) => [k.slice(2), value]),
  );
  if (v.has("refresh") && !["true", "false"].includes(v.get("refresh")!))
    throw new Error("refresh must be true or false");
  return v;
}
function memberOptions(v: Map<string, string>) {
  return {
    archive: v.get("archive")!,
    snapshot: v.get("snapshot")!,
    member: v.get("member")!,
    start: Number(v.get("start")),
    count: v.get("count") === "all" ? ("all" as const) : Number(v.get("count")),
    maxExpanded: Number(v.get("max-expanded")),
    maxSeconds: Number(v.get("max-seconds")),
    layout: v.get("layout"),
  };
}
type Handler = (s: Store, v: Map<string, string>) => unknown;
const LOCAL: Record<string, Handler> = {
  "import-member": (s, v) => s.importMember(memberOptions(v)),
  "verify-members": (s) => s.verifyMembers(),
  "member-status": (s) =>
    s.db
      .query(
        "SELECT id,identity,status,row_count,rejected,complete,crc_verified,error FROM member_versions",
      )
      .all(),
  "catalog-import": async (s, v) =>
    retainCatalog(s.db, await readFile(v.get("html")!, "utf8")),
  catalog: (s) => s.db.query("SELECT * FROM catalog").all(),
};
function remote(command: string, s: Store, v: Map<string, string>) {
  const budgets = {
    maxRequests: Number(v.get("max-requests")),
    maxBytes: Number(v.get("max-bytes")),
    refresh: v.get("refresh") === "true",
  };
  return command === "discover"
    ? discover(s.db, s.root, budgets)
    : acquire(s.db, s.root, v.get("id")!, budgets);
}
export async function runGeneral(command: string, args: string[]) {
  const v = argumentsFor(command, args);
  // Pure validation must precede Store.open (which initializes/reconciles durable state).
  if (command === "import-member") validateMemberOptions(memberOptions(v));
  if (command === "discover" || command === "acquire")
    validateBudgets({
      maxRequests: Number(v.get("max-requests")),
      maxBytes: Number(v.get("max-bytes")),
    });
  if (command === "layouts") return loadSchemas(v.get("layout")!);
  if (command === "inventory-members")
    return withZip(v.get("archive")!, LIMITS.compressed, async (z) => ({
      members: serialized(await inventory(z)),
      coverage: "metadata only",
    }));
  const s = await Store.open(v.get("output")!);
  try {
    const handler = LOCAL[command];
    return await (handler ? handler(s, v) : remote(command, s, v));
  } finally {
    await s.close();
  }
}

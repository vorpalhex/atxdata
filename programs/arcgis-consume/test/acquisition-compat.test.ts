import { test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { join } from "node:path";
import { policyFixture } from "./support/policy-fixture";

test("legacy wrapper annotations are optional data, but source bindings stay immutable", async () => {
  const f = await policyFixture();
  try {
    const p = await f.produce();
    f.mode.status = 200;
    const args = ["inspect-wrapper", ...p.slice(1)];
    const captured = await f.invoke(args);
    expect(captured.exit, captured.err).toBe(0);
    const result = JSON.parse(captured.out);
    const db = new Database(join(f.root, "state.sqlite"));
    const row = db
      .query<{ options: string }, [string]>(
        "SELECT options FROM acquisition_options WHERE run=?",
      )
      .get(result.run)!;
    const options = JSON.parse(row.options);
    // Authored legacy-envelope compatibility fixture, not a publisher receipt.
    options.selection.acknowledgeMapsRobotsOmission = true;
    options.waiver = {
      kind: "operator-scoped-robots-omission-v1",
      acknowledged: true,
    };
    db.query("UPDATE acquisition_options SET options=? WHERE run=?").run(
      JSON.stringify(options),
      result.run,
    );
    db.query("UPDATE runs SET summary=? WHERE id=?").run(
      JSON.stringify({ ...result.summary, waiver: options.waiver }),
      result.run,
    );
    db.close();
    const before = f.wire.length;
    expect((await f.invoke(["verify", "--archive", f.root], true)).exit).toBe(
      0,
    );
    expect((await f.invoke(args, true)).exit).toBe(0);
    const changed = new Database(join(f.root, "state.sqlite"));
    options.binding.publishedURL = "https://maps.austintexas.gov/Unpublished/";
    changed
      .query("UPDATE acquisition_options SET options=? WHERE run=?")
      .run(JSON.stringify(options), result.run);
    changed.close();
    expect((await f.invoke(["verify", "--archive", f.root], true)).exit).toBe(
      1,
    );
    expect(f.wire.length).toBe(before);
  } finally {
    f.close();
  }
}, 20000);

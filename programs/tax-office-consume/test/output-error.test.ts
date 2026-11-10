import { test, expect, spyOn } from "bun:test";
import { failure } from "../src/frontend";
test("domain EPIPE is not mistaken for deliberate output-pipe closure", () => {
  const previous = process.exitCode,
    log = spyOn(console, "error").mockImplementation(() => {});
  try {
    failure(Object.assign(new Error("domain failure"), { code: "EPIPE" }));
    expect(process.exitCode).toBe(1);
    expect(log).toHaveBeenCalled();
  } finally {
    process.exitCode = previous ?? 0;
    log.mockRestore();
  }
});

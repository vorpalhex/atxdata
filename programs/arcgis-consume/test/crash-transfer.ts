import { Archive } from "../src/archive";
let pulls = 0;
const a = await Archive.open(process.argv[2]!, {
  fetch: async () =>
    new Response(
      new ReadableStream({
        async pull(controller) {
          if (++pulls === 5) {
            await Bun.sleep(100);
            process.exit(91); // Actual process death bypasses all finally blocks.
          }
          controller.enqueue(new Uint8Array(1_000_000));
          await Bun.sleep(20);
        },
      }),
    ),
});
a.store.source("fixture", "crash fixture", "https://example.invalid");
const run = a.store.start("fixture", "collect");
await a.request(run, "partial", "https://example.invalid", "text");

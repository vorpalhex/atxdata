import { write } from "node:fs";

/** Observe fd delivery, not console/Bun's buffered best-effort logging. */
export class CheckedOutput {
  private tail: Promise<void> = Promise.resolve();
  private failure?: Error;
  private closed = false;
  private queuedBytes = 0;

  constructor(private readonly fd = 1, private readonly timeoutMs = 5000) {}

  // A synchronous sink lets job loggers retain their existing interface. Failure is
  // deferred until flush so logging cannot relabel completed acquisition facts.
  line = (text: string): void => { this.text(text + "\n"); };
  text = (text: string): void => {
    if (this.failure || this.closed) return;
    const bytes = Buffer.from(text);
    if (this.queuedBytes > 1024 * 1024) {
      this.failure = new Error("stdout delivery failed (queue limit)"); return;
    }
    this.queuedBytes += bytes.length;
    this.tail = this.tail.then(async () => {
      if (this.failure || this.closed) return;
      try { await this.deliver(bytes); }
      catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "EPIPE") this.closed = true;
        else this.failure = new Error(`stdout delivery failed (${code ?? "write error"})`);
      } finally { this.queuedBytes -= bytes.length; }
    });
  };

  async flush(): Promise<void> {
    await this.tail;
    if (this.failure) throw this.failure;
  }

  private async deliver(bytes: Buffer): Promise<void> {
    const deadline = Date.now() + this.timeoutMs;
    for (let offset = 0; offset < bytes.length;) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw Object.assign(new Error("timeout"), { code: "ETIMEDOUT" });
      const count = await new Promise<number>((resolve, reject) => {
        const timer = setTimeout(() => reject(Object.assign(new Error("timeout"), { code: "ETIMEDOUT" })), remaining);
        write(this.fd, bytes, offset, Math.min(4096, bytes.length - offset), null, (error, written) => {
          clearTimeout(timer);
          if (error) reject(error); else resolve(written);
        });
      }).catch(async (error: NodeJS.ErrnoException) => {
        if (error.code !== "EAGAIN" && error.code !== "EWOULDBLOCK" && error.code !== "EINTR") throw error;
        await new Promise(resolve => setTimeout(resolve, Math.min(10, Math.max(1, deadline - Date.now()))));
        return 0;
      });
      offset += count;
    }
  }
}

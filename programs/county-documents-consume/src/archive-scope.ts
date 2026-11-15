/** Exact tenant scope for anonymous archive forms and cookies, not a robots override. */
export function archiveScope(url: string): boolean {
  const u = new URL(url);
  return (
    u.origin === "https://online.encodeplus.com" &&
    !u.username &&
    !u.password &&
    u.pathname.startsWith("/regs/traviscounty-tx/")
  );
}

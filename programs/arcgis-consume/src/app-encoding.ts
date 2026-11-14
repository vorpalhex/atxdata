import type { Dependencies } from "./archive";
import { itemUrl } from "./sources";
import { v2Format } from "./app-intent";

/** Advisory request preference only; never changes response admission. */
export function identityAppData(
  next: Dependencies["fetch"],
  exact: string,
): Dependencies["fetch"] {
  return (url, init) => {
    if (url !== exact) return next(url, init);
    const headers = new Headers(init.headers);
    headers.set("Accept-Encoding", "identity");
    return next(url, { ...init, headers });
  };
}

/** Call only after CLI validation; preserve other dependency identities. */
export function appRequestDependencies(
  options: {
    command: string;
    source?: string;
    appDataFormat?: string;
    selection?: { item: string };
  },
  dependencies: Partial<Dependencies>,
): Partial<Dependencies> {
  if (
    options.command !== "inspect-app" ||
    options.source !== "austin" ||
    options.appDataFormat !== v2Format ||
    !options.selection
  )
    return dependencies;
  const next =
    dependencies.fetch ?? ((url, init) => globalThis.fetch(url, init));
  return {
    ...dependencies,
    fetch: identityAppData(next, itemUrl(options.selection.item, true)),
  };
}

import { ensure } from "./check";
import { hash } from "./policy-inspection-receipt";
import { referenceVersion } from "./reference-contract";
export type LiteralReference = {
  index: number;
  tag: string;
  attribute: string;
  literal: string;
  url: string | null;
  sha256: string;
  role: "frame" | "script" | "blocked";
  reason: string | null;
};
function target(literal: string, base: string) {
  try {
    ensure(!/[\\\u0000-\u0020\u007f]/.test(literal), "unsafe literal");
    const u = new URL(literal, base);
    ensure(
      u.protocol === "https:" &&
        !u.username &&
        !u.password &&
        !u.port &&
        !u.hash,
      "unsafe target",
    );
    return u.href;
  } catch {
    return null;
  }
}
/** New derivation; old wrapper-v1 reference extraction/receipt is untouched. */
export async function deriveReferences(
  raw: Buffer,
  publishedURL: string,
  maxReferences: number,
) {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(raw);
  let effectiveBase = publishedURL,
    baseCount = 0;
  await new HTMLRewriter()
    .on("base[href]", {
      element(e) {
        baseCount++;
        ensure(baseCount === 1, "ambiguous effective base");
        const literal = e.getAttribute("href")!;
        const u = target(literal, publishedURL);
        ensure(
          u && new URL(u).origin === new URL(publishedURL).origin,
          "cross-origin/invalid effective base",
        );
        effectiveBase = u;
      },
    })
    .transform(new Response(text))
    .arrayBuffer();
  const references: LiteralReference[] = [];
  const add = (tag: string, attribute: string) => ({
    element(e: HTMLRewriterTypes.Element) {
      ensure(
        references.length < maxReferences,
        "reference row ceiling exceeded; no truncation",
      );
      const literal = e.getAttribute(attribute)!,
        url = target(literal, effectiveBase),
        sameOrigin =
          url !== null && new URL(url).origin === new URL(publishedURL).origin;
      const forbidden =
        url !== null &&
        /(?:_Incapsula_Resource|analytics|tracking|(?:^|[/.-])vendor(?:[/.-]|$))/i.test(
          new URL(url).pathname,
        );
      const role =
        sameOrigin && !forbidden
          ? tag === "iframe"
            ? "frame"
            : tag === "script"
              ? "script"
              : "blocked"
          : "blocked";
      const index = references.length;
      references.push({
        index,
        tag,
        attribute,
        literal,
        url,
        sha256: hash(
          JSON.stringify({
            version: referenceVersion,
            index,
            tag,
            attribute,
            literal,
            url,
            effectiveBase,
            parentSha256: hash(raw),
          }),
        ),
        role,
        reason:
          role === "blocked"
            ? "not an admitted same-origin application frame/script"
            : null,
      });
    },
  });
  await new HTMLRewriter()
    .on("iframe[src]", add("iframe", "src"))
    .on("script[src]", add("script", "src"))
    .on("link[href]", add("link", "href"))
    .transform(new Response(text))
    .arrayBuffer();
  return {
    version: referenceVersion,
    parentSha256: hash(raw),
    publishedURL,
    effectiveBase,
    references,
    configResolved: false,
    servicesResolved: false,
    acquiredFeatures: false,
  };
}

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// A design token that refers to itself, or to a token that does not exist, is silently dropped by the browser: the
// keyboard focus outline vanished site-wide that way once. These checks read styles.css as text.
const css = readFileSync(fileURLToPath(new URL("../styles.css", import.meta.url)), "utf8");
const definitions = [...css.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((match) => ({ name: match[1]!, value: match[2]! }));
const refs = (value: string) => [...value.matchAll(/var\((--[\w-]+)/g)].map((match) => match[1]!);

describe("design tokens", () => {
  it("never refer to themselves, directly or through other tokens", () => {
    const graph = new Map<string, Set<string>>();
    for (const { name, value } of definitions) {
      const edges = graph.get(name) ?? new Set<string>();
      refs(value).forEach((ref) => edges.add(ref));
      graph.set(name, edges);
    }
    const cycles: string[] = [];
    for (const start of graph.keys()) {
      const stack = [...(graph.get(start) ?? [])];
      const seen = new Set<string>();
      while (stack.length) {
        const next = stack.pop()!;
        if (next === start) { cycles.push(start); break; }
        if (seen.has(next)) continue;
        seen.add(next);
        stack.push(...(graph.get(next) ?? []));
      }
    }
    expect(cycles).toEqual([]);
  });

  it("are all defined where they are used", () => {
    const defined = new Set(definitions.map((item) => item.name));
    const used = new Set(refs(css));
    expect([...used].filter((name) => !defined.has(name))).toEqual([]);
  });

  it("have no var(--var(...)) left over from a rename", () => {
    expect(css).not.toMatch(/var\(--var\(/);
  });

  it("keeps shared status aliases in the global token scope", () => {
    const root = css.match(/:root\s*{([\s\S]*?)\n}/)?.[1] ?? "";
    for (const token of ["--tone-ok", "--tone-warn", "--tone-bad", "--tone-idle", "--bar-ok", "--bar-warn", "--bar-bad", "--bar-idle"]) {
      expect(root).toContain(`${token}:`);
    }
    expect(css).not.toMatch(/\.system-page\s*{[^}]*--tone-/s);
  });
});

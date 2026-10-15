import { test } from "node:test";
import assert from "node:assert/strict";
import { canonicalUrl, domainOf, looksLikeFundingNews, normalizeCompanyName, normalizeStage } from "../src/lib/normalize.ts";

test("company names that refer to the same startup normalise to the same key", () => {
  const variants = ["Acme AI, Inc.", "Acme AI", "ACME AI Inc", "Acme AI Technologies Pvt. Ltd.", "acme.ai"];
  const keys = new Set(variants.map(normalizeCompanyName));
  assert.equal(keys.size, 1, `got ${[...keys].join(" | ")}`);
});

test("different companies stay different", () => {
  assert.notEqual(normalizeCompanyName("Acme"), normalizeCompanyName("Acme Health"));
});

test("accents and punctuation are ignored", () => {
  assert.equal(normalizeCompanyName("Café-Labs"), normalizeCompanyName("cafe labs"));
});

test("domainOf strips www/paths and ignores news & social hosts", () => {
  assert.equal(domainOf("https://www.acme.ai/about?x=1"), "acme.ai");
  assert.equal(domainOf("acme.io"), "acme.io");
  assert.equal(domainOf("https://www.linkedin.com/company/acme"), null);
  assert.equal(domainOf("https://techcrunch.com/2026/10/12/acme"), null);
  assert.equal(domainOf(null), null);
});

test("round names map onto the thesis vocabulary", () => {
  assert.equal(normalizeStage("Pre-Seed"), "pre-seed");
  assert.equal(normalizeStage("pre seed round"), "pre-seed");
  assert.equal(normalizeStage("Seed"), "seed");
  assert.equal(normalizeStage("seed extension"), "seed");
  assert.equal(normalizeStage("Series A"), "series-a");
  assert.equal(normalizeStage("Series B"), "series-b+");
  assert.equal(normalizeStage(null), "unknown");
});

test("tracking params are removed so the same story isn't stored twice", () => {
  assert.equal(canonicalUrl("https://x.com/a?utm_source=tw&id=3#top"), "https://x.com/a?id=3");
});

test("keyword gate", () => {
  assert.ok(looksLikeFundingNews("Finches raises €2M in pre-seed funding"));
  assert.ok(!looksLikeFundingNews("Apple unveils a new iPhone"));
});

import { coreName, sameCompanyReason } from "../src/lib/normalize.ts";

test("generic trailing words are ignored when comparing names", () => {
  assert.equal(coreName(normalizeCompanyName("Parallel Loop AI")), coreName(normalizeCompanyName("Parallel Loop")));
  assert.equal(coreName(normalizeCompanyName("NuSynth Tech")), coreName(normalizeCompanyName("NuSynth Technologies")));
  assert.equal(coreName("ai"), "ai"); // never strips the only word
});

test("same founder means same company even under a different name", () => {
  const evos = { normalized_name: "evos", founders: [{ name: "Urav Shah" }] };
  const eos = { normalized_name: "evolutionary operating system", founders: [{ name: "urav  shah" }] };
  assert.match(sameCompanyReason(eos, evos) ?? "", /same founder/);
});

test("same round, amount and investor means same company", () => {
  const a = { normalized_name: "foo", round_type: "pre-seed", amount_usd: 9_000_000, investors: ["Uncork Capital"] };
  const b = { normalized_name: "bar baz", round_type: "pre-seed", amount_usd: 9_000_000, investors: ["uncork capital", "Field"] };
  assert.equal(sameCompanyReason(a, b), "same round, amount and investor");
});

test("unrelated startups are not merged", () => {
  const a = { normalized_name: "acme", founders: [{ name: "Jane Doe" }], round_type: "seed", amount_usd: 3e6, investors: ["A"] };
  const b = { normalized_name: "globex", founders: [{ name: "John Roe" }], round_type: "seed", amount_usd: 3e6, investors: ["B"] };
  assert.equal(sameCompanyReason(a, b), null);
});

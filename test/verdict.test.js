"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { compute, scoreToVerdict, scoreSentiment, scoreRate } = require("../verdict.js");

// ── compute(): error path ─────────────────────────────────────────────────────

test("compute: falsy views return the error path", () => {
  for (const views of [0, null, undefined, NaN]) {
    const result = compute(views, 100, 10, 20);
    assert.equal(result.verdict, null);
    assert.equal(result.error, "No view data available.");
  }
});

// ── compute(): all four verdict outcomes ──────────────────────────────────────

test("compute: 6/6 → Legit on Fire", () => {
  // likeRate .20 ≥ high (2), commentRate .05 ≥ high (2), sentiment .952 (2)
  const r = compute(1000, 200, 10, 50);
  assert.equal(r.composite, 6);
  assert.equal(r.maxScore, 6);
  assert.equal(r.verdict.label, "Legit on Fire");
});

test("compute: 5/6 → Solid Video", () => {
  // likeRate .20 (2), commentRate .05 (2), sentiment .5 (1)
  const r = compute(1000, 200, 200, 50);
  assert.equal(r.composite, 5);
  assert.equal(r.verdict.label, "Solid Video");
});

test("compute: 3/6 → Hot Garbage", () => {
  // likeRate .05 (1), commentRate .02 (1), sentiment .5 (1)
  const r = compute(1000, 50, 50, 20);
  assert.equal(r.composite, 3);
  assert.equal(r.verdict.label, "Hot Garbage");
});

test("compute: 1/6 → View Botted", () => {
  // likeRate .05 (1), commentRate 0 (0), sentiment .333 (0)
  const r = compute(1000, 50, 100, 0);
  assert.equal(r.composite, 1);
  assert.equal(r.verdict.label, "View Botted");
});

test("compute: 0/6 → View Botted", () => {
  const r = compute(1000, 0, 5, 0);
  assert.equal(r.composite, 0);
  assert.equal(r.verdict.label, "View Botted");
});

// ── compute(): null signal exclusion ──────────────────────────────────────────

test("compute: null comments excludes the comment signal (maxScore 4)", () => {
  const r = compute(1000, 200, 10, null); // likeRate (2) + sentiment (2) → 4/4
  assert.equal(r.hasComments, false);
  assert.equal(r.maxScore, 4);
  assert.equal(r.composite, 4);
  assert.equal(r.signals.length, 2);
  assert.equal(r.verdict.label, "Legit on Fire");
});

test("compute: with comments excluded, 1/4 is Hot Garbage (not View Botted)", () => {
  // The 0.20 boundary: 1/4 = 0.25 lands in the Hot Garbage band.
  const r = compute(1000, 50, 100, null); // likeRate .05 (1), sentiment .333 (0) → 1/4
  assert.equal(r.maxScore, 4);
  assert.equal(r.composite, 1);
  assert.equal(r.verdict.label, "Hot Garbage");
});

test("compute: zero comments is scored (not excluded)", () => {
  const r = compute(1000, 200, 10, 0); // likeRate (2), commentRate 0 (0), sentiment (2) → 4/6
  assert.equal(r.hasComments, true);
  assert.equal(r.maxScore, 6);
  assert.equal(r.composite, 4);
  assert.equal(r.verdict.label, "Solid Video");
});

test("compute: null dislikes excludes the sentiment signal (maxScore 4)", () => {
  const r = compute(1000, 200, null, 50); // likeRate (2) + commentRate (2) → 4/4
  assert.equal(r.hasSentiment, false);
  assert.equal(r.maxScore, 4);
  assert.equal(r.composite, 4);
  assert.equal(r.signals.length, 2);
  assert.equal(r.verdict.label, "Legit on Fire");
});

test("compute: null comments AND null dislikes leaves only the like-rate signal", () => {
  const r = compute(1000, 200, null, null);
  assert.equal(r.maxScore, 2);
  assert.equal(r.composite, 2);
  assert.equal(r.hasComments, false);
  assert.equal(r.hasSentiment, false);
  assert.equal(r.signals.length, 1);
  assert.equal(r.verdict.label, "Legit on Fire");

  const r2 = compute(1000, 0, null, null);
  assert.equal(r2.verdict.label, "View Botted");
});

// ── compute(): input passthrough ──────────────────────────────────────────────

test("compute: returns the input values", () => {
  const r = compute(1000, 50, 20, 10);
  assert.deepEqual(r.inputs, { views: 1000, likes: 50, dislikes: 20, comments: 10 });
});

// ── scoreToVerdict(): exact threshold boundaries ──────────────────────────────

test("scoreToVerdict: 0.20 boundary is inclusive (View Botted)", () => {
  assert.equal(scoreToVerdict(20, 100).label, "View Botted");
  assert.equal(scoreToVerdict(21, 100).label, "Hot Garbage");
  assert.equal(scoreToVerdict(0, 100).label, "View Botted");
});

test("scoreToVerdict: 0.55 boundary is inclusive (Hot Garbage)", () => {
  assert.equal(scoreToVerdict(55, 100).label, "Hot Garbage");
  assert.equal(scoreToVerdict(56, 100).label, "Solid Video");
});

test("scoreToVerdict: 0.90 boundary is inclusive (Solid Video)", () => {
  assert.equal(scoreToVerdict(90, 100).label, "Solid Video");
  assert.equal(scoreToVerdict(91, 100).label, "Legit on Fire");
  assert.equal(scoreToVerdict(100, 100).label, "Legit on Fire");
});

// ── scoreSentiment(): null handling and boundaries ────────────────────────────

test("scoreSentiment: null/undefined dislikes returns null", () => {
  assert.equal(scoreSentiment(100, null), null);
  assert.equal(scoreSentiment(100, undefined), null);
});

test("scoreSentiment: zero total returns null", () => {
  assert.equal(scoreSentiment(0, 0), null);
});

test("scoreSentiment: boundary ratios", () => {
  assert.equal(scoreSentiment(85, 15), 2); // ratio exactly 0.85
  assert.equal(scoreSentiment(100, 0), 2); // ratio 1.0
  assert.equal(scoreSentiment(40, 60), 1); // ratio exactly 0.40
  assert.equal(scoreSentiment(39, 61), 0); // just below 0.40
  assert.equal(scoreSentiment(0, 5), 0);   // ratio 0
});

// ── scoreRate(): at, above, and below low and high ────────────────────────────

test("scoreRate: boundary conditions against low/high", () => {
  const range = { low: 0.02, high: 0.10 };
  assert.equal(scoreRate(0.10, range), 2);   // at high
  assert.equal(scoreRate(0.1001, range), 2); // above high
  assert.equal(scoreRate(0.0999, range), 1); // within range
  assert.equal(scoreRate(0.02, range), 1);   // at low
  assert.equal(scoreRate(0.0199, range), 0); // below low
  assert.equal(scoreRate(0, range), 0);
});

// ── compute(): tier selection at boundary view counts ─────────────────────────

test("compute: tier boundaries pick the expected rate ranges", () => {
  // Tier 1 top edge — 10_000 is inclusive.
  assert.deepEqual(compute(10000, 2000, null, null).signals[0].expected, { low: 0.02, high: 0.10 });
  // Tier 2 — both edges.
  assert.deepEqual(compute(10001, 500, null, null).signals[0].expected, { low: 0.01, high: 0.05 });
  assert.deepEqual(compute(100000, 5000, null, null).signals[0].expected, { low: 0.01, high: 0.05 });
  // Tier 3 — both edges.
  assert.deepEqual(compute(100001, 500, null, null).signals[0].expected, { low: 0.005, high: 0.03 });
  assert.deepEqual(compute(1000000, 30000, null, null).signals[0].expected, { low: 0.005, high: 0.03 });
  // Tier 4 — both edges.
  assert.deepEqual(compute(1000001, 500, null, null).signals[0].expected, { low: 0.002, high: 0.015 });
  assert.deepEqual(compute(10000000, 150000, null, null).signals[0].expected, { low: 0.002, high: 0.015 });
  // Tier 5 — open-ended.
  assert.deepEqual(compute(10000001, 500, null, null).signals[0].expected, { low: 0.001, high: 0.008 });
  assert.deepEqual(compute(5000000000, 500, null, null).signals[0].expected, { low: 0.001, high: 0.008 });
});

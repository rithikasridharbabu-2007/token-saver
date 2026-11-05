import test from "node:test";
import assert from "node:assert/strict";
import { ProjectIndex } from "../lib/snapshot.js";
import { DEMO_ROOT } from "../lib/workbench.js";
import { DEMO_CASES, inspectContext, scoreEvidence, evaluateBudgets, validateCases } from "../lib/evaluation.js";

test("budget sweep exposes lost evidence instead of rewarding reduction alone", () => {
  const report = new ProjectIndex().scan(DEMO_ROOT);
  const result = evaluateBudgets(report, DEMO_CASES);
  assert.equal(result.recommendedBudget, 700);
  assert.equal(result.runs[0].passedCases, 5);
  assert.equal(result.runs[1].passedCases, 6);
  const small = inspectContext(report, DEMO_CASES[0].question, { budget: 300 }, DEMO_CASES);
  const larger = inspectContext(report, DEMO_CASES[0].question, { budget: 700 }, DEMO_CASES);
  assert.equal(small.evidence.status, "missing");
  assert.equal(larger.evidence.status, "retained");
  assert(small.reductionPercent > larger.reductionPercent);
  assert.equal(result.sourceFingerprint, report.fingerprint);
});

test("unlabeled custom questions never get an invented accuracy score", () => {
  const result = inspectContext(new ProjectIndex().scan(DEMO_ROOT), "Tell me about the error policy", {}, DEMO_CASES);
  assert.equal(result.evidence.status, "unscored");
  assert.equal(result.evidence.evidenceHits, undefined);
});

test("evidence must occur in the labeled file, not in another selected file", () => {
  const selection = { selectedFiles: ["a.js", "b.js"], excerpts: [
    { file: "a.js", content: "unrelated" }, { file: "b.js", content: "required code" }
  ] };
  const result = scoreEvidence(selection, { expectedFiles: ["a.js"], evidence: [{ file: "a.js", contains: "required code" }] });
  assert.equal(result.evidenceHits, 0);
  assert.equal(result.status, "missing");
});

test("rejects missing, malformed, duplicate and out-of-project labels", () => {
  assert.throws(() => validateCases([]), /1–100/);
  assert.throws(() => validateCases([{ id: "x", question: "q", expectedFiles: ["../private"], evidence: [] }]), /project-relative/);
  assert.throws(() => validateCases([DEMO_CASES[0], DEMO_CASES[0]]), /unique id/);
  assert.throws(() => validateCases([{ ...DEMO_CASES[0], evidence: [{ file: "other.js", contains: "x" }] }]), /Evidence/);
});

test("rejects labels absent from eligible source and invalid budget lists", () => {
  const report = new ProjectIndex().scan(DEMO_ROOT);
  assert.throws(() => evaluateBudgets(report, [{ ...DEMO_CASES[0], evidence: [{ file: "src/auth.js", contains: "nonexistent code" }] }]), /absent/);
  assert.throws(() => evaluateBudgets(report, DEMO_CASES, [0]), /budgets/);
});

test("no passing budget is reported as no recommendation", () => {
  const result = evaluateBudgets(new ProjectIndex().scan(DEMO_ROOT), DEMO_CASES, [300]);
  assert.equal(result.recommendedBudget, null);
});

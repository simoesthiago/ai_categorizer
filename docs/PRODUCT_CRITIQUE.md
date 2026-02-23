# Product Critique - AI DePara Categorizer (based on PRD v1.0)

## Proposal overview
The proposal addresses a real recurring problem: semantic categorization at scale for heterogeneous spreadsheet items. The v1.0 scope is pragmatic, with a simple stack and fast time-to-value.

## Strengths
- Well-defined problem with clear operational impact.
- Focused initial scope with measurable acceptance criteria.
- Simple architecture for local operation and quick onboarding.
- Prompt design aimed at deterministic row-level output.
- Basic resilience already considered (retry, logs, failed-batch reprocessing).

## Main gaps and recommended improvements

## 1) API key security (high priority)
- Gap: saving keys in `.env` via UI can expose secrets on shared machines.
- Improvement: use secure local storage (OS keyring) and optional non-persistent key mode.
- Impact: lowers leakage risk and improves security baseline.

## 2) Output quality control (high priority)
- Gap: relying only on free-text model output increases invalid-category risk.
- Improvement: enforce structured output (`JSON`) and validate each row against a category whitelist.
- Impact: reduces silent errors and simplifies exception handling.

## 3) Confidence calibration (high priority)
- Gap: `High/Medium/Low` confidence from the same model is often weakly calibrated.
- Improvement: combine objective heuristics (consistency checks, semantic distance, ambiguity rules) for operational confidence.
- Impact: improves human-review triage quality.

## 4) Sensitive data governance (high priority)
- Gap: PRD does not define treatment of PII/financial/contractual data.
- Improvement: add privacy warnings, masking option, and sensitive-column guardrails.
- Impact: reduces compliance and misuse risk.

## 5) Predictable cost before execution (medium-high priority)
- Gap: cost appears only as a risk, not as a mandatory feature.
- Improvement: pre-run token and cost estimator by model before starting processing.
- Impact: prevents spending surprises and improves model/chunk decisions.

## 6) Execution observability (medium priority)
- Gap: logging is mentioned, but no telemetry standard is defined.
- Improvement: generate per-job execution report (duration, batches, errors, fallback rate, estimated cost).
- Impact: improves diagnostics and continuous optimization.

## 7) Exception UX (medium priority)
- Gap: failed-batch reprocess helps, but does not cover ambiguous single items.
- Improvement: add a review queue for low-confidence rows.
- Impact: increases real precision without blocking throughput.

## 8) Memory scalability (medium priority)
- Gap: full in-memory pandas processing may limit larger files.
- Improvement: stream/chunk dataframe processing with incremental writes.
- Impact: increases capacity without major architecture changes.

## 9) Quality benchmarking (medium priority)
- Gap: `>85%` accuracy target has no defined evaluation protocol.
- Improvement: create a labeled gold dataset and run quality regression checks.
- Impact: prevents prompt/model quality regressions across releases.

## Recommended prioritization (v1.0 + v1.1)
1. API key security hardening.
2. Structured output and strict category validation.
3. Pre-run cost estimator.
4. Low-confidence review queue.
5. Execution reporting and quality benchmark suite.

# Deterministic Extraction vs LLM Extraction

README Intelligence intentionally uses deterministic extraction instead of an LLM or external API.

## Why deterministic extraction

| Requirement | Deterministic rules | LLM extraction |
|---|---|---|
| Repeatability | Same README always produces the same output | Output can vary by model/version/prompt |
| Privacy | Pasted and local README content stays local | Content may leave the browser or require a provider |
| Evidence | Every result maps to a README line and heading path | Evidence requires additional citation validation |
| Cost and latency | No token cost; current parse + extract p95 is under 100 ms | Token cost and network latency vary |
| Failure behavior | Empty or partial result is explicit and testable | Plausible but unsupported claims are possible |
| Language coverage | Best for known English patterns and dictionary entries | Better at unusual wording and implicit meaning |

## Extraction pipeline

```text
Markdown
  -> mdast with source positions
  -> section classification
  -> field-specific deterministic extractors
  -> Zod validation and safe fallback
  -> evidence-linked UI cards
```

The extractors do not use repository manifests to improve the README benchmark. Repository facts are
kept in the separate Reality Check system, where README claims are compared against files from the
repository.

## What the benchmark measures

The labeled fixture set contains 59 real README files. Commands, environment variables, tech stack,
and API endpoints use exact normalized matching. The benchmark reports micro-averaged precision,
recall, and F1, plus parse and extraction timing.

See the generated [benchmark dashboard](BENCHMARK.md) for current aggregate metrics and the largest
false-positive and false-negative examples.

## When an LLM would be useful

An LLM could be added as an optional suggestion layer for ambiguous or unsupported README wording.
It should not silently replace deterministic results. Any future assisted mode should:

1. Preserve deterministic extraction as the baseline.
2. Mark model-generated facts separately from verified README evidence.
3. Require citations to source lines.
4. Be evaluated against the same hand-labeled fixtures.
5. Keep local-only operation available without an API key.

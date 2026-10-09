import type { HealthCheck, HealthReport, Intelligence, ReadmeSignals } from '../types';
import { HEALTH_RULES, type HealthRule } from './rules';

export const HEALTH_LABEL = 'Heuristic score. Based on the presence of common sections, not the quality of the content.';

/** Evaluate all rules. Never throws: a rule that throws is reported as failed. */
export function computeHealthReport(
  intelligence: Intelligence,
  signals: ReadmeSignals,
  rules: HealthRule[] = HEALTH_RULES
): HealthReport {
  const checks: HealthCheck[] = rules.map((rule) => {
    let passed = false;
    let reason: string;
    try {
      const result = rule.evaluate({ intelligence, signals });
      passed = result.passed;
      reason = result.reason;
    } catch {
      reason = 'Check could not be evaluated.';
    }
    return {
      id: rule.id,
      label: rule.label,
      passed,
      weight: rule.weight,
      reason,
      suggestion: passed ? null : rule.suggestion,
    };
  });
  const score = Math.max(0, Math.min(100, checks.reduce((sum, c) => sum + (c.passed ? c.weight : 0), 0)));
  return { score, checks };
}

/** Failed checks ordered by weight (highest impact first). */
export function orderedSuggestions(report: HealthReport): HealthCheck[] {
  return report.checks
    .filter((c) => !c.passed && c.suggestion)
    .sort((a, b) => b.weight - a.weight || a.id.localeCompare(b.id));
}

'use client';

import { useState } from 'react';
import { Activity, CheckCircle2, XCircle, ChevronDown } from 'lucide-react';
import { HEALTH_LABEL, orderedSuggestions, type HealthReport } from '@readme-intel/core';
import { Card } from './Card';

function scoreColor(score: number): string {
  if (score >= 80) return 'var(--success)';
  if (score >= 50) return 'var(--warning)';
  return 'var(--error)';
}

/** Documentation health (F-50 to F-53): score, heuristic label, checklist with reasons, ordered suggestions. */
export function HealthCard({ health }: { health: HealthReport }) {
  const [showChecks, setShowChecks] = useState(false);
  const suggestions = orderedSuggestions(health);
  const passed = health.checks.filter((c) => c.passed).length;

  return (
    <Card id="health" title="Documentation health" icon={Activity}>
      <div className="flex items-center gap-4">
        <svg viewBox="0 0 36 36" className="h-16 w-16 shrink-0 -rotate-90" aria-hidden>
          <circle cx="18" cy="18" r="15.5" fill="none" stroke="var(--border)" strokeWidth="3.5" />
          <circle
            cx="18"
            cy="18"
            r="15.5"
            fill="none"
            stroke={scoreColor(health.score)}
            strokeWidth="3.5"
            strokeLinecap="round"
            strokeDasharray={`${(health.score / 100) * 97.4} 97.4`}
          />
        </svg>
        <div>
          <p className="text-2xl font-bold leading-none" data-testid="health-score">
            {health.score}
            <span className="text-sm font-medium text-fg-2"> / 100</span>
          </p>
          <p className="mt-1 text-xs text-fg-2">
            {passed} of {health.checks.length} checks passed
          </p>
        </div>
      </div>
      <p className="mt-3 text-xs leading-relaxed text-fg-2">{HEALTH_LABEL}</p>

      {suggestions.length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-medium uppercase tracking-wide text-fg-2">Suggestions</p>
          <ol className="mt-1.5 list-decimal space-y-1.5 pl-5 text-sm">
            {suggestions.map((s) => (
              <li key={s.id}>
                {s.suggestion} <span className="text-xs text-fg-2">(+{s.weight})</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      <button
        type="button"
        onClick={() => setShowChecks((v) => !v)}
        aria-expanded={showChecks}
        className="mt-3 inline-flex items-center gap-1 rounded-btn text-xs font-medium text-link hover:underline"
      >
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showChecks ? '' : '-rotate-90'}`} aria-hidden />
        {showChecks ? 'Hide' : 'Show'} all {health.checks.length} checks
      </button>
      {showChecks && (
        <ul className="mt-2 space-y-1.5" data-testid="health-checks">
          {health.checks.map((c) => (
            <li key={c.id} className="flex items-start gap-2 text-sm">
              {c.passed ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-label="Passed" />
              ) : (
                <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-error" aria-label="Failed" />
              )}
              <div className="min-w-0">
                <p>
                  {c.label} <span className="text-xs text-fg-2">({c.weight})</span>
                </p>
                <p className="text-xs text-fg-2">{c.reason}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

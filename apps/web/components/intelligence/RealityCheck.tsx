'use client';

import { useMemo, useState } from 'react';
import { ScanSearch, Gauge, CheckCircle2, XCircle, CircleAlert, CircleHelp, FileQuestion, Info, ExternalLink, ChevronDown, Loader2 } from 'lucide-react';
import { READINESS_LABEL, errorMessage, type Claim, type ClaimStatus, type GitHubErrorCode, type RealityReport } from '@readme-intel/core';
import { Card } from './Card';
import { SourceChip } from './SourceChip';

export type RealityState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; code: GitHubErrorCode; resetAt: string | null }
  | { status: 'ready'; report: RealityReport; skipped: string[] };

const STATUS_META: Record<ClaimStatus, { label: string; Icon: typeof CheckCircle2; text: string; bg: string; help: string }> = {
  contradiction: { label: 'Contradiction', Icon: XCircle, text: 'text-error', bg: 'bg-error-soft', help: 'README and repository disagree.' },
  'readme-only': { label: 'README only', Icon: FileQuestion, text: 'text-warning', bg: 'bg-warning-soft', help: 'Stated in the README, no evidence in the repository. Possibly stale.' },
  'repo-only': { label: 'Undocumented', Icon: Info, text: 'text-info', bg: 'bg-info-soft', help: 'Found in the repository, missing from the README.' },
  unverified: { label: 'Unverified', Icon: CircleHelp, text: 'text-fg-2', bg: 'bg-hover', help: 'Not enough evidence either way.' },
  verified: { label: 'Verified', Icon: CheckCircle2, text: 'text-success', bg: 'bg-success-soft', help: 'Confirmed by repository files.' },
};

type Filter = ClaimStatus | 'issues' | 'all';

function StatusBadge({ status }: { status: ClaimStatus }) {
  const m = STATUS_META[status];
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded-[4px] px-1.5 py-0.5 text-[11px] font-medium ${m.bg}`} title={m.help}>
      <m.Icon className={`h-3 w-3 ${m.text}`} aria-hidden />
      {m.label}
    </span>
  );
}

/** One claim with its evidence tree: README lines on one branch, repository files on the other. */
function ClaimRow({ claim, snapshot }: { claim: Claim; snapshot: RealityReport['snapshot'] }) {
  const [open, setOpen] = useState(claim.status === 'contradiction');
  const branches = claim.readme.length + claim.repo.length;
  return (
    <li className="rounded-btn border border-border bg-bg" data-claim-id={claim.id} data-status={claim.status}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-start gap-2 p-2 text-left">
        <StatusBadge status={claim.status} />
        <span className="min-w-0 flex-1 text-sm leading-snug">{claim.title}</span>
        <ChevronDown className={`mt-0.5 h-3.5 w-3.5 shrink-0 text-fg-2 transition-transform ${open ? '' : '-rotate-90'}`} aria-hidden />
      </button>
      {open && (
        <div className="border-t border-border px-2 pb-2 pt-1.5">
          <p className="text-xs text-fg-2">{claim.detail}</p>
          {branches > 0 && (
            <ul className="mt-1.5 font-mono text-[11px]" aria-label="Evidence">
              {claim.readme.map((r, i) => (
                <li key={`r${i}`} className="flex items-center gap-1 text-fg-2">
                  <span aria-hidden>{i === branches - 1 ? '└─' : '├─'}</span>
                  <span>README</span>
                  {r.line > 0 ? <SourceChip source={r} /> : null}
                </li>
              ))}
              {claim.repo.map((e, i) => {
                const last = claim.readme.length + i === branches - 1;
                const label = `${e.path}${e.kind === 'content' && e.line > 0 ? `:${e.line}` : ''}`;
                const href = e.kind === 'content' ? `https://github.com/${snapshot.owner}/${snapshot.repo}/blob/${encodeURIComponent(snapshot.ref)}/${e.path.split('/').map(encodeURIComponent).join('/')}${e.line > 0 ? `#L${e.line}` : ''}` : null;
                return (
                  <li key={`e${i}`} className="flex min-w-0 items-center gap-1 text-fg-2">
                    <span aria-hidden>{last ? '└─' : '├─'}</span>
                    {href ? <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex min-w-0 items-center gap-1 text-link hover:underline" title={e.kind === 'content' ? e.snippet : undefined}>
                      <span className="truncate">
                        {label}
                      </span>
                      <ExternalLink className="h-3 w-3 shrink-0" aria-hidden />
                    </a> : <span className="truncate" title={e.kind === 'tree-absence' ? 'Path absent from the complete repository tree' : undefined}>{label}</span>}
                  </li>
                );
              })}
              {claim.readme.length === 0 && <li className="text-fg-2">└─ not mentioned in README</li>}
              {claim.repo.length === 0 && <li className="text-fg-2">└─ no repository evidence</li>}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}

interface RealityCheckProps {
  state: RealityState;
  available: boolean;
  onRun: () => void;
}

/** Repository Reality Check card: README claims compared with repository files. */
export function RealityCheckCard({ state, available, onRun }: RealityCheckProps) {
  const [filter, setFilter] = useState<Filter>('issues');
  const report = state.status === 'ready' ? state.report : null;
  const claims = useMemo(() => report?.claims ?? [], [report]);
  const visible = useMemo(() => {
    if (filter === 'all') return claims;
    if (filter === 'issues') return claims.filter((c) => c.status !== 'verified');
    return claims.filter((c) => c.status === filter);
  }, [claims, filter]);

  return (
    <Card id="reality" title="Repository reality check" icon={ScanSearch} count={state.status === 'ready' ? state.report.counts.contradiction : undefined}>
      {!available && <p className="text-sm text-fg-2">Available for GitHub repositories. Open a GitHub link to compare this README with the repository files.</p>}

      {available && state.status === 'idle' && (
        <div>
          <p className="text-sm text-fg-2">Compare the README with the repository: package.json / pyproject, lockfiles, Docker, CI workflows, .env.example, LICENSE and a sample of source files.</p>
          <button type="button" onClick={onRun} className="mt-2 inline-flex items-center gap-1.5 rounded-btn bg-accent px-3 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90" data-testid="run-reality-check">
            <ScanSearch className="h-4 w-4" aria-hidden /> Run reality check
          </button>
          <p className="mt-2 text-[11px] text-fg-2">Reads up to 60 small files through GitHub. Nothing is executed.</p>
        </div>
      )}

      {state.status === 'loading' && (
        <p className="inline-flex items-center gap-2 text-sm text-fg-2" role="status">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Reading repository files...
        </p>
      )}

      {state.status === 'error' && (
        <div role="alert">
          <p className="text-sm text-error">{errorMessage(state.code, state.resetAt)}</p>
          <button type="button" onClick={onRun} className="mt-2 text-sm font-medium text-link hover:underline">
            Try again
          </button>
        </div>
      )}

      {state.status === 'ready' && (
        <div data-testid="reality-results">
          <div className="grid grid-cols-5 gap-1 text-center">
            {(['contradiction', 'readme-only', 'repo-only', 'unverified', 'verified'] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setFilter(s)}
                className={`rounded-btn border px-1 py-1.5 transition-colors ${filter === s ? 'border-[color:var(--link)]' : 'border-border hover:bg-hover'}`}
                aria-pressed={filter === s}
                title={STATUS_META[s].help}
              >
                <span className={`block text-base font-semibold ${STATUS_META[s].text}`}>{state.report.counts[s]}</span>
                <span className="block text-[10px] leading-tight text-fg-2">{STATUS_META[s].label}</span>
              </button>
            ))}
          </div>
          <div className="mt-2 flex gap-2 text-xs">
            <button type="button" onClick={() => setFilter('issues')} aria-pressed={filter === 'issues'} className={filter === 'issues' ? 'font-medium text-fg' : 'text-link hover:underline'}>
              Needs attention
            </button>
            <button type="button" onClick={() => setFilter('all')} aria-pressed={filter === 'all'} className={filter === 'all' ? 'font-medium text-fg' : 'text-link hover:underline'}>
              Show all ({claims.length})
            </button>
          </div>
          {visible.length === 0 ? (
            <p className="mt-2 text-sm text-fg-2">Nothing in this group.</p>
          ) : (
            <ul className="mt-2 space-y-1.5">
                {visible.map((c) => (
                <ClaimRow key={c.id} claim={c} snapshot={state.report.snapshot} />
              ))}
            </ul>
          )}
          <p className="mt-3 text-[11px] leading-relaxed text-fg-2">
            Checked {state.report.snapshot.fileCount} files of {state.report.snapshot.treeSize} at <span className="font-mono">{state.report.snapshot.ref}</span>
            {state.report.snapshot.truncated ? '. GitHub truncated the file list, so "missing file" checks were skipped' : ''}
            {state.skipped.length > 0 ? `. ${state.skipped.length} file(s) could not be read` : ''}. A contradiction is only reported when both sides are explicit.
          </p>
        </div>
      )}
    </Card>
  );
}

/** Setup Readiness card: "can a developer realistically run this?" (separate from documentation health). */
export function ReadinessCard({ state }: { state: RealityState }) {
  const [showAll, setShowAll] = useState(false);
  if (state.status !== 'ready') return null;
  const r = state.report.readiness;
  const failed = r.checks.filter((c) => !c.passed).sort((a, b) => b.weight - a.weight);
  const color = r.score >= 80 ? 'var(--success)' : r.score >= 50 ? 'var(--warning)' : 'var(--error)';
  return (
    <Card id="readiness" title="Setup readiness" icon={Gauge}>
      <div className="flex items-center gap-3">
        <p className="text-2xl font-bold leading-none" data-testid="readiness-score" style={{ color }}>
          {r.score}
          <span className="text-sm font-medium text-fg-2"> / 100</span>
        </p>
        <p className="text-xs text-fg-2">
          {r.checks.length - failed.length} of {r.checks.length} checks passed
        </p>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-fg-2">{READINESS_LABEL}</p>
      {failed.length > 0 && (
        <ul className="mt-2 space-y-1.5">
          {failed.map((c) => (
            <li key={c.id} className="flex items-start gap-2 text-sm">
              <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
              <div className="min-w-0">
                <p>
                  {c.label} <span className="text-xs text-fg-2">(+{c.weight})</span>
                </p>
                <p className="text-xs text-fg-2">{c.reason}</p>
                {c.suggestion && <p className="text-xs">{c.suggestion}</p>}
              </div>
            </li>
          ))}
        </ul>
      )}
      <button type="button" onClick={() => setShowAll((v) => !v)} aria-expanded={showAll} className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-link hover:underline">
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showAll ? '' : '-rotate-90'}`} aria-hidden /> {showAll ? 'Hide' : 'Show'} all {r.checks.length} checks
      </button>
      {showAll && (
        <ul className="mt-2 space-y-1">
          {r.checks.map((c) => (
            <li key={c.id} className="flex items-start gap-2 text-xs">
              {c.passed ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-success" aria-label="Passed" /> : <XCircle className="h-3.5 w-3.5 shrink-0 text-error" aria-label="Failed" />}
              <span>
                <span className="text-fg">{c.label}</span> <span className="text-fg-2">({c.weight}): {c.reason}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

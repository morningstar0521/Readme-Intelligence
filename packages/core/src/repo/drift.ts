import { blobUrl } from './facts';
import type { Claim, ClaimStatus, RealityReport } from './types';

/**
 * Documentation drift: compare the Reality Check of a base revision with a head revision
 * (for example the target branch and a pull request). A pull request "drifts" when it
 * introduces a contradiction between README and repository that the base did not have.
 * Pure functions: no I/O.
 */

export interface StatusChange {
  id: string;
  title: string;
  from: ClaimStatus | null;
  to: ClaimStatus | null;
}

export interface RealityDiff {
  /** Contradictions in head that were not contradictions in base (the regression signal). */
  newContradictions: Claim[];
  /** Contradictions in base that head fixed (claim gone or no longer a contradiction). */
  resolvedContradictions: Claim[];
  /** Contradictions present in both. */
  openContradictions: Claim[];
  /** Env vars read by the code but undocumented in head, that were fine (or absent) in base. */
  newUndocumentedEnv: Claim[];
  readiness: { base: number; head: number; delta: number };
  /** Every claim whose status changed, sorted by id. */
  changes: StatusChange[];
}

export function diffRealityReports(base: RealityReport, head: RealityReport): RealityDiff {
  const baseById = new Map(base.claims.map((c) => [c.id, c]));
  const headById = new Map(head.claims.map((c) => [c.id, c]));

  const newContradictions = head.claims.filter((c) => c.status === 'contradiction' && baseById.get(c.id)?.status !== 'contradiction');
  const openContradictions = head.claims.filter((c) => c.status === 'contradiction' && baseById.get(c.id)?.status === 'contradiction');
  const resolvedContradictions = base.claims.filter((c) => c.status === 'contradiction' && headById.get(c.id)?.status !== 'contradiction');
  const newUndocumentedEnv = head.claims.filter((c) => c.category === 'env' && c.status === 'repo-only' && baseById.get(c.id)?.status !== 'repo-only');

  const ids = new Set([...baseById.keys(), ...headById.keys()]);
  const changes: StatusChange[] = [];
  for (const id of [...ids].sort()) {
    const b = baseById.get(id);
    const h = headById.get(id);
    const from = b?.status ?? null;
    const to = h?.status ?? null;
    if (from !== to) changes.push({ id, title: (h ?? b)!.title, from, to });
  }

  return {
    newContradictions,
    resolvedContradictions,
    openContradictions,
    newUndocumentedEnv,
    readiness: { base: base.readiness.score, head: head.readiness.score, delta: head.readiness.score - base.readiness.score },
    changes,
  };
}

export type FailOn = 'none' | 'contradiction' | 'new-contradiction';

/** Exit decision for CI. "new-contradiction" needs a base report; without one it behaves like "contradiction". */
export function shouldFail(head: RealityReport, diff: RealityDiff | null, failOn: FailOn, minReadiness?: number): { fail: boolean; reason: string } {
  if (minReadiness !== undefined && head.readiness.score < minReadiness) {
    return { fail: true, reason: `Setup Readiness ${head.readiness.score} is below the minimum of ${minReadiness}.` };
  }
  if (failOn === 'none') return { fail: false, reason: 'Reporting only.' };
  const list = failOn === 'new-contradiction' && diff ? diff.newContradictions : head.claims.filter((c) => c.status === 'contradiction');
  if (list.length === 0) return { fail: false, reason: failOn === 'new-contradiction' && diff ? 'No new README contradictions.' : 'No README contradictions.' };
  return { fail: true, reason: `${list.length} ${failOn === 'new-contradiction' && diff ? 'new ' : ''}README contradiction(s): ${list.map((c) => c.id).join(', ')}.` };
}

// ------------------------------------------------------------------ rendering

/** Marker so a CI job can find and update its own pull request comment. */
export const DRIFT_COMMENT_MARKER = '<!-- readme-intelligence:reality-check -->';

export interface RenderOptions {
  /** README path, used for README line links. */
  readmePath: string;
  /** true: link evidence to github.com (needs real owner / repo / ref). false: plain path:line. */
  links: boolean;
  title?: string;
}

const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

function readmeRefs(report: RealityReport, claim: Claim, o: RenderOptions): string {
  const refs = claim.readme.filter((r) => r.line > 0).map((r) => (o.links ? `[README:${r.line}](${blobUrl(report.snapshot, o.readmePath, r.line)})` : `README:${r.line}`));
  return refs.length ? refs.join(', ') : '-';
}

function repoRefs(claim: Claim, o: RenderOptions): string {
  const refs = claim.repo.slice(0, 3).map((e) => {
    const label = `${e.path}${e.line > 0 ? `:${e.line}` : ''}`;
    return o.links ? `[${cell(label)}](${e.url})` : cell(label);
  });
  if (claim.repo.length > 3) refs.push(`+${claim.repo.length - 3} more`);
  return refs.length ? refs.join(', ') : 'not found';
}

function claimTable(report: RealityReport, claims: Claim[], o: RenderOptions): string[] {
  return ['| Claim | README | Repository |', '|---|---|---|', ...claims.map((c) => `| ${cell(c.title)}<br><sub>${cell(c.detail)}</sub> | ${readmeRefs(report, c, o)} | ${repoRefs(c, o)} |`)];
}

const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`);

/** Markdown report for a pull request comment, a job summary or a file. */
export function renderRealityMarkdown(head: RealityReport, diff: RealityDiff | null, o: RenderOptions): string {
  const contradictions = head.claims.filter((c) => c.status === 'contradiction');
  const undocumentedEnv = head.claims.filter((c) => c.category === 'env' && c.status === 'repo-only');
  const failing = head.readiness.checks.filter((c) => !c.passed).sort((a, b) => b.weight - a.weight);
  const out: string[] = [DRIFT_COMMENT_MARKER, `## ${o.title ?? 'README Reality Check'}`, ''];

  const readinessLine = diff && diff.readiness.delta !== 0 ? `**${head.readiness.score}/100** (${signed(diff.readiness.delta)} vs base)` : `**${head.readiness.score}/100**`;
  out.push(`Setup Readiness: ${readinessLine} · Contradictions: **${contradictions.length}**${diff ? ` (${diff.newContradictions.length} new, ${diff.resolvedContradictions.length} resolved)` : ''} · Undocumented env vars: **${undocumentedEnv.length}**`, '');

  if (diff) {
    if (diff.newContradictions.length > 0) {
      out.push('### New contradictions in this change', '', ...claimTable(head, diff.newContradictions, o), '');
    } else {
      out.push('No new contradictions between the README and the repository.', '');
    }
    if (diff.resolvedContradictions.length > 0) {
      out.push('### Resolved', '', ...diff.resolvedContradictions.map((c) => `- ${cell(c.title)}`), '');
    }
    if (diff.newUndocumentedEnv.length > 0) {
      out.push('### Newly undocumented environment variables', '', ...claimTable(head, diff.newUndocumentedEnv, o), '');
    }
    if (diff.openContradictions.length > 0) {
      out.push(`<details><summary>${diff.openContradictions.length} contradiction(s) already on the base branch</summary>`, '', ...claimTable(head, diff.openContradictions, o), '', '</details>', '');
    }
  } else {
    if (contradictions.length > 0) out.push('### Contradictions', '', ...claimTable(head, contradictions, o), '');
    else out.push('No contradictions between the README and the repository.', '');
    if (undocumentedEnv.length > 0) out.push('### Undocumented environment variables', '', ...claimTable(head, undocumentedEnv, o), '');
  }

  if (failing.length > 0) {
    out.push(`<details><summary>Setup Readiness: ${failing.length} failing check(s)</summary>`, '', ...failing.map((c) => `- **${cell(c.label)}** (${c.weight}): ${cell(c.reason)}`), '', '</details>', '');
  }

  const c = head.counts;
  out.push(
    `<sub>${c.verified} verified · ${c.contradiction} contradiction · ${c['readme-only']} README only · ${c['repo-only']} undocumented · ${c.unverified} unverified. ` +
      `Static check of ${head.snapshot.fileCount} of ${head.snapshot.treeSize} files at \`${cell(head.snapshot.ref.slice(0, 12))}\`. Nothing was installed or run. ` +
      'A contradiction is only reported when both sides are explicit.</sub>',
    ''
  );
  return out.join('\n');
}

/** Short plain-text report for a terminal. */
export function renderRealityText(head: RealityReport, diff: RealityDiff | null): string {
  const lines: string[] = [];
  const c = head.counts;
  lines.push(`Setup Readiness ${head.readiness.score}/100${diff && diff.readiness.delta !== 0 ? ` (${signed(diff.readiness.delta)} vs base)` : ''}`);
  lines.push(`Claims: ${c.verified} verified, ${c.contradiction} contradiction, ${c['readme-only']} README only, ${c['repo-only']} undocumented, ${c.unverified} unverified`);
  const show = (label: string, claims: Claim[]) => {
    if (claims.length === 0) return;
    lines.push('', `${label}:`);
    for (const cl of claims) {
      const where = [...cl.readme.filter((r) => r.line > 0).map((r) => `README:${r.line}`), ...cl.repo.slice(0, 2).map((e) => `${e.path}${e.line ? `:${e.line}` : ''}`)].join(', ');
      lines.push(`  [${cl.status}] ${cl.id}  ${cl.title}${where ? `  <- ${where}` : ''}`);
    }
  };
  if (diff) {
    show('New contradictions', diff.newContradictions);
    show('Resolved', diff.resolvedContradictions);
    show('Newly undocumented env vars', diff.newUndocumentedEnv);
    show('Contradictions already on base', diff.openContradictions);
  } else {
    show('Contradictions', head.claims.filter((x) => x.status === 'contradiction'));
    show('README only', head.claims.filter((x) => x.status === 'readme-only'));
    show('Undocumented', head.claims.filter((x) => x.status === 'repo-only'));
  }
  return lines.join('\n');
}

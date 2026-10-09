import type { Code, List, ListItem, Table, TableRow, InlineCode, Paragraph, RootContent } from 'mdast';
import { toString as mdastToString } from 'mdast-util-to-string';
import { visit } from 'unist-util-visit';
import type { EnvVarItem } from '../types';
import type { Block, DocContext } from './context';
import { refFor, lineOf } from './context';
import { collapseWhitespace, truncate } from '../util/text';

/**
 * Environment variables extractor (Extractor spec 4.5).
 * Sources: env-like code blocks, tables with a Variable/Name/Env/Key column,
 * lists and inline code in configuration sections, and `export NAME=value` lines.
 * Secret-looking values are masked before they ever leave this module.
 */

export const MASK = '••••••••';

const ENV_BLOCK_LANGS = new Set([
  'env', 'dotenv', '.env', 'ini', 'properties', 'bash', 'sh', 'shell', 'zsh', 'console', 'conf',
  'powershell', 'ps', 'ps1', 'pwsh', 'cmd',
]);
const ASSIGN_RE = /^(?:export\s+)?([A-Za-z][A-Za-z0-9_]*)\s*=\s*(.*)$/;
const PS_ENV_RE = /^\$env:([A-Za-z][A-Za-z0-9_]*)\s*=\s*(.*)$/i;
const ENV_NAME_RE = /^[A-Za-z][A-Za-z0-9_]{2,}$/;
const INLINE_ENV_RE = /^(?:export\s+|\$env:)?([A-Za-z][A-Za-z0-9_]{2,})(?:\s*=\s*(.*))?$/;
const INLINE_ASSIGNMENT_RE = /(?:^|\s)(?:export\s+|\$env[.:])?([A-Za-z][A-Za-z0-9_]*)\s*=\s*("[^"]*"|'[^']*'|[^\s;]*)/g;

/** All-caps words that are not environment variables. */
const NAME_STOPLIST = new Set([
  'README', 'TODO', 'NOTE', 'JSON', 'YAML', 'HTML', 'HTTP', 'HTTPS', 'HTTP2', 'REST', 'CRUD', 'UUID', 'MIT', 'API',
  'URL', 'URI', 'CSS', 'SQL', 'CLI', 'GUI', 'SDK', 'JWT', 'CORS', 'CSRF', 'OAUTH', 'OAUTH2', 'SSH', 'SSL', 'TLS',
  'TCP', 'UDP', 'DNS', 'AWS', 'GCP', 'LTS', 'GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'TRUE',
  'FALSE', 'NULL', 'NONE', 'WARNING', 'ERROR', 'INFO', 'DEBUG', 'TIP', 'IMPORTANT', 'CAUTION', 'LICENSE', 'FAQ',
  'PDF', 'CSV', 'XML', 'ASCII', 'UTF8', 'UTF', 'IDE', 'GPU', 'CPU', 'RAM', 'USB', 'NPM', 'MVP', 'WIP', 'ETA', 'PATH',
]);

const SECRET_NAME_RE = /(KEY|SECRET|TOKEN|PASSWORD|PASSWD|PASS\b|PRIVATE|CREDENTIAL|AUTH)/;
const SECRET_VALUE_RES = [
  /^sk-[A-Za-z0-9_-]{6,}/,
  /^sk_(?:live|test)_[A-Za-z0-9]{6,}/,
  /^gh[pousr]_[A-Za-z0-9]{10,}/,
  /^github_pat_[A-Za-z0-9_]{10,}/,
  /^AKIA[0-9A-Z]{12,}/,
  /^AIza[0-9A-Za-z_-]{20,}/,
  /^xox[abprs]-[A-Za-z0-9-]{10,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----|-----BEGIN/,
];

/** Placeholder values are not secrets and stay visible. */
export function isPlaceholderValue(value: string): boolean {
  const v = value.trim();
  if (v === '') return true;
  if (/^<[^>]*>$/.test(v) || /^\[[^\]]*\]$/.test(v) || /^\{\{.*\}\}$/.test(v) || /^\$\{.*\}$/.test(v)) return true;
  if (/^(x{3,}|\*{3,}|\.{3}|…|-+|changeme|change_me|change-me|secret|password|token|test|dummy|example|placeholder|none|null|todo)$/i.test(v)) return true;
  if (/your[_\- ]?|_here\b|-here\b|\bhere$|replace[_\- ]?(me|with|this)|xxxx|example|placeholder|dummy|insert[_\- ]/i.test(v)) return true;
  return false;
}

/** Long random-looking token: 20+ chars of base64/hex alphabet with both letters and digits. */
function looksLikeRandomToken(v: string): boolean {
  return /^[A-Za-z0-9+/=_-]{20,}$/.test(v) && /[0-9]/.test(v) && /[A-Za-z]/.test(v);
}

export function looksLikeSecretValue(value: string): boolean {
  const v = value.trim();
  if (!v) return false;
  return SECRET_VALUE_RES.some((re) => re.test(v)) || looksLikeRandomToken(v);
}

/** Decide masking for one name/value pair. */
export function maskValue(name: string, value: string | null): { exampleValue: string | null; masked: boolean } {
  if (value === null) return { exampleValue: null, masked: false };
  const v = value.trim();
  if (v === '') return { exampleValue: null, masked: false };
  if (isPlaceholderValue(v)) return { exampleValue: v, masked: false };
  // Booleans and small numbers are configuration flags, never secrets.
  if (/^(true|false|yes|no|on|off|\d{1,6})$/i.test(v)) {
    return looksLikeSecretValue(v) ? { exampleValue: MASK, masked: true } : { exampleValue: v, masked: false };
  }
  if (SECRET_NAME_RE.test(name) || looksLikeSecretValue(v)) return { exampleValue: MASK, masked: true };
  return { exampleValue: v, masked: false };
}

/** Required flag from free text: optional -> false, required/mandatory/must -> true, default -> false. */
export function requiredFromText(text: string | null | undefined): boolean | null {
  if (!text) return null;
  if (/\boptional\b|\bnot required\b/i.test(text)) return false;
  if (/\b(required|mandatory|must)\b/i.test(text)) return true;
  if (/\bdefaults?\b|\bdefault value\b/i.test(text)) return false;
  return null;
}

function requiredFromCell(text: string): boolean | null {
  const t = text.trim().toLowerCase();
  if (!t) return null;
  if (/^(yes|y|true|required|mandatory|✓|✔|✅|x|\*)$/.test(t) || t.startsWith('yes') || t.startsWith('required')) return true;
  if (/^(no|n|false|optional|✗|✘|❌|-|–|—)$/.test(t) || t.startsWith('no') || t.startsWith('optional')) return false;
  return requiredFromText(t);
}

function unquote(value: string): string {
  const v = value.trim();
  if ((v.startsWith('"') && v.endsWith('"') && v.length >= 2) || (v.startsWith("'") && v.endsWith("'") && v.length >= 2)) {
    return v.slice(1, -1);
  }
  return v;
}

interface RawEnv {
  name: string;
  value: string | null;
  description: string | null;
  required: boolean | null;
  line: number;
  block: Block;
}

function isEnvLikeName(name: string): boolean {
  if (!ENV_NAME_RE.test(name) || NAME_STOPLIST.has(name.toUpperCase())) return false;
  return name.includes('_') || (name === name.toUpperCase() && name.length >= 4);
}

/** Share of non-empty, non-comment lines that are NAME=value assignments. */
function assignmentRatio(value: string): number {
  let total = 0;
  let hits = 0;
  for (const raw of value.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith(';')) continue;
    total++;
    if (/^(?:export\s+)?[A-Za-z][A-Za-z0-9_]*=/.test(line)) hits++;
  }
  return total === 0 ? 0 : hits / total;
}

/** Parse env assignments from a code block. */
export function parseEnvBlock(code: Code): { name: string; value: string; description: string | null; offset: number }[] {
  const lang = (code.lang ?? '').toLowerCase();
  const ratio = assignmentRatio(code.value);
  const isEnvLang = ENV_BLOCK_LANGS.has(lang);
  const shellLike = ['bash', 'sh', 'shell', 'zsh', 'console'].includes(lang);
  // Majority rule (spec): any block where >= 50% of lines are strict NAME=value (no spaces around "=").
  if (!isEnvLang && ratio < 0.5) return [];

  const out: { name: string; value: string; description: string | null; offset: number }[] = [];
  const lines = code.value.split('\n');
  let pendingComment: string[] = [];

  lines.forEach((raw, offset) => {
    let line = raw.trim();
    if (!line) {
      pendingComment = [];
      return;
    }
    if (line.startsWith('#') || line.startsWith(';')) {
      const text = line.replace(/^[#;]+\s?/, '').trim();
      // Commented-out assignments ("# DEBUG=true") are documented optional vars.
      const commented = ASSIGN_RE.exec(text);
      if (commented && isEnvLang && !shellLike) {
        out.push({ name: commented[1]!, value: unquote(commented[2] ?? ''), description: pendingComment.join(' ') || null, offset });
        pendingComment = [];
        return;
      }
      if (text) pendingComment.push(text);
      return;
    }
    line = line.replace(/^\$\s+/, '');
    const ps = PS_ENV_RE.exec(line);
    const m = ASSIGN_RE.exec(line) ?? (ps ? ([ps[0], ps[1]!.toUpperCase(), ps[2]] as unknown as RegExpExecArray) : null);
    if (!m) {
      pendingComment = [];
      return;
    }
    const name = m[1]!;
    let rest = m[2] ?? '';
    let inlineComment: string | null = null;
    const quoted = /^(["'])(.*?)\1(.*)$/.exec(rest.trim());
    if (quoted) {
      rest = quoted[2] ?? '';
      const tail = (quoted[3] ?? '').trim();
      if (tail.startsWith('#')) inlineComment = tail.replace(/^#+\s?/, '').trim() || null;
    } else {
      const hashIdx = rest.search(/\s#/);
      if (hashIdx !== -1) {
        inlineComment = rest.slice(hashIdx).replace(/^\s*#+\s?/, '').trim() || null;
        rest = rest.slice(0, hashIdx);
      }
      rest = rest.trim();
      // In shell blocks, "NAME=value cmd ..." is a one-off prefix, not a documented variable.
      if (shellLike && /\s/.test(rest)) {
        pendingComment = [];
        return;
      }
    }
    const description = inlineComment ?? (pendingComment.length ? pendingComment.join(' ') : null);
    out.push({ name, value: rest, description, offset });
    pendingComment = [];
  });

  return out;
}

const NAME_HEADER_RE = /^(env(ironment)?\s*(var(iable)?s?)?|variables?|var|name|key|setting|option|parameter)s?$/i;
const DESC_HEADER_RE = /(description|purpose|meaning|details|notes?|explanation|usage|what)/i;
const REQUIRED_HEADER_RE = /(required|mandatory|optional)/i;
const VALUE_HEADER_RE = /(default|example|value|sample)/i;

function cellText(row: TableRow, index: number): string {
  const cell = row.children[index];
  return cell ? collapseWhitespace(mdastToString(cell)) : '';
}

function envFromTable(table: Table, block: Block): RawEnv[] {
  const [header, ...rows] = table.children;
  if (!header) return [];
  const headers = header.children.map((c) => collapseWhitespace(mdastToString(c)));
  const nameIdx = headers.findIndex((h) => NAME_HEADER_RE.test(h.replace(/[`*_]/g, '').trim()));
  if (nameIdx === -1) return [];
  const descIdx = headers.findIndex((h, i) => i !== nameIdx && DESC_HEADER_RE.test(h));
  const reqIdx = headers.findIndex((h, i) => i !== nameIdx && REQUIRED_HEADER_RE.test(h));
  const valIdx = headers.findIndex((h, i) => i !== nameIdx && i !== descIdx && VALUE_HEADER_RE.test(h));

  const out: RawEnv[] = [];
  for (const row of rows) {
    const name = cellText(row, nameIdx).replace(/[`*]/g, '').trim();
    if (!/^[A-Z][A-Z0-9_]{2,}$/.test(name) || !isEnvLikeName(name)) continue;
    const description = descIdx !== -1 ? cellText(row, descIdx) || null : null;
    let required: boolean | null = reqIdx !== -1 ? requiredFromCell(cellText(row, reqIdx)) : null;
    if (required === null) required = requiredFromText(description);
    const value = valIdx !== -1 ? cellText(row, valIdx).replace(/^`|`$/g, '') || null : null;
    out.push({ name, value, description, required, line: lineOf(row), block });
  }
  return out;
}

function envFromList(list: List, block: Block): RawEnv[] {
  const out: RawEnv[] = [];
  for (const item of list.children as ListItem[]) {
    const first = item.children[0];
    if (!first || first.type !== 'paragraph') continue;
    const para = first as Paragraph;
    let name: string | null = null;
    const head = para.children[0];
    if (head?.type === 'inlineCode') {
      const candidate = (head as InlineCode).value.replace(/=.*$/, '').trim();
      if (isEnvLikeName(candidate)) name = candidate;
    } else if (head?.type === 'strong' || head?.type === 'text') {
      const candidate = (/^([A-Z][A-Z0-9_]{2,})\b/.exec(mdastToString(head)) ?? [])[1];
      if (candidate && isEnvLikeName(candidate) && candidate.includes('_')) name = candidate;
    }
    if (!name) continue;
    const full = collapseWhitespace(mdastToString(para));
    const description = full
      .slice(full.indexOf(name) + name.length)
      .replace(/^[`*\s]*(=\s*\S+)?[`*\s]*[:\-–—]?\s*/, '')
      .trim();
    out.push({
      name,
      value: null,
      description: description ? truncate(description, 300) : null,
      required: requiredFromText(description),
      line: lineOf(item),
      block,
    });
  }
  return out;
}

function envFromInlineCode(node: RootContent, block: Block): RawEnv[] {
  const out: RawEnv[] = [];
  visit(node, 'inlineCode', (ic: InlineCode) => {
    const value = ic.value.trim();
    let matched = false;
    let assignment: RegExpExecArray | null;
    while ((assignment = INLINE_ASSIGNMENT_RE.exec(value)) !== null) {
      matched = true;
      const name = assignment[1]!;
      if (isEnvLikeName(name)) out.push({ name, value: unquote(assignment[2] ?? ''), description: null, required: null, line: lineOf(ic) || block.line, block });
    }
    if (matched) return;
    const m = INLINE_ENV_RE.exec(value);
    if (!m || !isEnvLikeName(m[1]!) || (!m[2] && m[1] !== m[1]!.toUpperCase())) return;
    out.push({ name: m[1]!, value: m[2] ?? null, description: null, required: null, line: lineOf(ic) || block.line, block });
  });
  return out;
}

const ENV_PROSE_RE = /\b(environment|env)\s+variables?\b|\b\.env(?:\.[A-Za-z0-9_-]+)?\b|\b(?:configure|provide|define|pass)\b/i;

/** Variables explicitly named in setup/configuration prose, for example `API_KEY`. */
function envFromProse(node: RootContent, block: Block): RawEnv[] {
  if (node.type !== 'paragraph' && node.type !== 'blockquote' && node.type !== 'list') return [];
  const text = collapseWhitespace(mdastToString(node));
  const configurationSection = block.section === 'configuration' || block.section === 'installation' || block.section === 'prerequisites';
  const hasInlineAssignment = /`[A-Z][A-Z0-9_]{2,}\s*=/.test(text);
  if (!ENV_PROSE_RE.test(text) && !configurationSection && !hasInlineAssignment) return [];
  const out: RawEnv[] = [];
  visit(node, 'inlineCode', (ic: InlineCode) => {
    const value = ic.value.trim();
    let matched = false;
    let assignment: RegExpExecArray | null;
    while ((assignment = INLINE_ASSIGNMENT_RE.exec(value)) !== null) {
      matched = true;
      const name = assignment[1]!;
      if (isEnvLikeName(name)) out.push({ name, value: unquote(assignment[2] ?? ''), description: text, required: requiredFromText(text), line: lineOf(ic) || block.line, block });
    }
    if (matched) return;
    const m = INLINE_ENV_RE.exec(value);
    if (!m || !isEnvLikeName(m[1]!) || (!m[2] && m[1] !== m[1]!.toUpperCase())) return;
    if (!m[2]) {
      const before = text.slice(0, text.indexOf(ic.value));
      const hasExplicitContext = /\b(?:environment|env(?:ironment)?|variable)\b/i.test(text) || /\b(?:pass|configure|provide|define)\s+(?:the\s+)?$/i.test(before.slice(-48));
      if (!hasExplicitContext) return;
    }
    out.push({ name: m[1]!, value: m[2] ?? null, description: text, required: requiredFromText(text), line: lineOf(ic) || block.line, block });
  });
  if (configurationSection) {
    const seen = new Set(out.map((item) => item.name));
    const plain = /\b(?:set|configure|provide|define|under|via|using)\s+(?:the\s+)?([A-Z][A-Z0-9_]{2,})\b/gi;
    let match: RegExpExecArray | null;
    while ((match = plain.exec(text)) !== null) {
      const name = match[1]!.toUpperCase();
      if (seen.has(name) || !isEnvLikeName(name) || !name.includes('_')) continue;
      seen.add(name);
      out.push({ name, value: null, description: text, required: requiredFromText(text), line: block.line, block });
    }
  }
  return out;
}

/** Environment access in language examples documents a variable without assigning it. */
function envFromCodeUsage(code: Code, block: Block): RawEnv[] {
  const out: RawEnv[] = [];
  const patterns = [
    /\bos\.environ(?:\.get)?\s*\[\s*["']([A-Za-z][A-Za-z0-9_]*)["']\s*\]/g,
    /\bos\.getenv\s*\(\s*["']([A-Za-z][A-Za-z0-9_]*)["']/g,
    /\bprocess\.env(?:\.([A-Za-z][A-Za-z0-9_]*)|\[\s*["']([A-Za-z][A-Za-z0-9_]*)["']\s*\])/g,
    /\bgetenv\s*\(\s*["']([A-Za-z][A-Za-z0-9_]*)["']/g,
    /--env\s+([A-Za-z][A-Za-z0-9_]*)\s*=/g,
  ];
  for (const re of patterns) {
    let match: RegExpExecArray | null;
    while ((match = re.exec(code.value)) !== null) {
      const name = (match[1] ?? match[2])!;
      if (!isEnvLikeName(name)) continue;
      const line = (code.position?.start.line ?? block.line) + code.value.slice(0, match.index).split('\n').length;
      out.push({ name, value: null, description: null, required: null, line, block });
    }
  }
  return out;
}

function merge(raw: RawEnv[]): EnvVarItem[] {
  const byName = new Map<string, { item: RawEnv; description: string | null; required: boolean | null; value: string | null }>();
  for (const r of raw) {
    const existing = byName.get(r.name);
    if (!existing) {
      byName.set(r.name, { item: r, description: r.description, required: r.required, value: r.value });
      continue;
    }
    if (!existing.description && r.description) existing.description = r.description;
    if (existing.required === null && r.required !== null) existing.required = r.required;
    if ((existing.value === null || existing.value === '') && r.value) existing.value = r.value;
  }
  const out: EnvVarItem[] = [];
  for (const { item, description, required, value } of byName.values()) {
    const { exampleValue, masked } = maskValue(item.name, value);
    const source = refFor(item.block);
    source.line = item.line || item.block.line;
    out.push({
      name: item.name,
      required: required ?? requiredFromText(description),
      description: description ? truncate(collapseWhitespace(description), 300) : null,
      exampleValue,
      masked,
      source,
    });
  }
  return out;
}

export function extractEnvVars(ctx: DocContext): EnvVarItem[] {
  const raw: RawEnv[] = [];
  for (const block of ctx.blocks) {
    if (block.isHeading) continue;
    const node = block.node;

    // 1 + 4: code blocks (env-like languages, majority NAME=value, export lines)
    visit(node, 'code', (code: Code) => {
      const firstLine = (code.position?.start.line ?? block.line) + 1;
      for (const e of parseEnvBlock(code)) {
        raw.push({
          name: e.name,
          value: e.value,
          description: e.description,
          required: requiredFromText(e.description),
          line: firstLine + e.offset,
          block,
        });
      }
      raw.push(...envFromCodeUsage(code, block));
    });

    // 2: tables with a Variable / Name / Env / Key column (anywhere)
    visit(node, 'table', (table: Table) => {
      raw.push(...envFromTable(table, block));
    });

    // 3: lists and inline code inside configuration/setup sections
    if (block.section === 'configuration' || block.section === 'installation' || block.section === 'prerequisites') {
      if (node.type === 'list') raw.push(...envFromList(node, block));
      if (node.type === 'paragraph' || node.type === 'list' || node.type === 'blockquote') {
        raw.push(...envFromInlineCode(node, block));
      }
    }
    raw.push(...envFromProse(node, block));
  }
  return merge(raw);
}

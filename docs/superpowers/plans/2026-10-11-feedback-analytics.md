# Feedback and Privacy-Preserving Analytics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add targeted GitHub extraction feedback and cookieless Vercel Analytics while keeping local-first privacy claims accurate.

**Architecture:** Use a static GitHub issue template and shared external feedback link in both app surfaces. Mount `@vercel/analytics/next` in the root App Router layout without custom events or content payloads.

**Tech Stack:** Next.js 14 App Router, React, TypeScript, Vercel Web Analytics, GitHub issue templates, Markdown documentation.

---

### Task 1: Add the feedback issue template

**Files:**
- Create: `.github/ISSUE_TEMPLATE/extraction-feedback.yml`

- [ ] **Step 1: Add a structured issue form**

Create a form that asks for repository, command-match result, missing or incorrect extraction, and optional reproduction details. Include a visible instruction not to paste secrets or private repository contents.

- [ ] **Step 2: Verify the template content**

Run `sed -n '1,240p' .github/ISSUE_TEMPLATE/extraction-feedback.yml` and confirm the required questions are present.

### Task 2: Add shared feedback links

**Files:**
- Create: `apps/web/components/common/FeedbackLink.tsx`
- Modify: `apps/web/components/landing/Landing.tsx`
- Modify: `apps/web/components/layout/TopBar.tsx`

- [ ] **Step 1: Add the static feedback link component**

Use the repository's GitHub issue-template URL with `target="_blank"`, `rel="noopener noreferrer"`, accessible text, and the existing link styling.

- [ ] **Step 2: Add the link to landing and viewer navigation**

Render the shared link near the existing landing actions and in the viewer top bar without adding feedback state or application requests.

- [ ] **Step 3: Run web lint and typecheck**

Run `pnpm --filter @readme-intel/web lint` and `pnpm --filter @readme-intel/web typecheck`. Expected: both exit 0.

### Task 3: Add Vercel Analytics and correct privacy language

**Files:**
- Modify: `apps/web/package.json`
- Modify: `apps/web/app/layout.tsx`
- Modify: `apps/web/middleware.ts`
- Modify: `README.md`
- Modify: `docs/SECURITY.md`

- [ ] **Step 1: Add the analytics dependency**

Add `@vercel/analytics` to the web workspace using pnpm so the lockfile records the exact resolved version.

- [ ] **Step 2: Mount page-view analytics**

Render `<Analytics />` from `@vercel/analytics/next` in the root layout after the application body. Do not add custom events or repository data.

- [ ] **Step 3: Allow the Vercel collector in CSP**

Add Vercel's documented analytics collector origins to `script-src` and `connect-src` while retaining the nonce-based policy. Keep `frame-src 'none'` and all existing restrictions.

- [ ] **Step 4: Correct documentation**

Document anonymized, cookieless aggregate analytics and explicitly state that local Markdown, pasted text, README contents, extracted values, and secrets are not sent. Replace the landing promise `no tracking` with this precise statement.

- [ ] **Step 5: Run full verification**

Run `pnpm check` and `pnpm --filter @readme-intel/web build`. Expected: both exit 0 with no test, lint, typecheck, or build errors.

### Task 4: Review the final diff

**Files:** All files changed above.

- [ ] **Step 1: Inspect scope and wording**

Run `git diff --check` and `git diff --stat`, then inspect the complete diff. Confirm no local-content analytics event, API route, unrelated refactor, or unsupported privacy claim was added.

- [ ] **Step 2: Report dashboard action**

Tell the user to open Vercel Project Settings/Analytics, enable Web Analytics, and redeploy or promote a deployment. Explain that the code integration alone does not enable dashboard collection.

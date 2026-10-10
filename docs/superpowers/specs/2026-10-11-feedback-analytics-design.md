# Feedback and Privacy-Preserving Analytics

## Goal

Make useful extraction failures easy to report and measure basic product usage without breaking the app's local-first privacy promise.

## Approved scope

- Add a GitHub issue template for extraction feedback.
- Add a visible `Give feedback` link on the landing page and README viewer.
- Ask for the repository tested and whether extracted commands matched the user's needs.
- Add Vercel Web Analytics through the Next.js App Router using its anonymized, cookieless default behavior.
- Document that analytics records aggregate page usage only and never receives local Markdown, README contents, extracted values, or secrets.
- Replace the inaccurate `no tracking` wording with a precise privacy statement.

## Architecture

The feedback URL is a static external GitHub issue-template URL, so no feedback API or application storage is needed. A small shared link component keeps the two UI surfaces consistent. Vercel's `Analytics` component is mounted in the root layout and receives no custom events or repository data.

## Error handling and privacy boundaries

Opening feedback is a normal external navigation and must use `target="_blank"`, `rel="noopener noreferrer"`. The issue template must tell reviewers not to include secrets. Analytics must remain page-view-only; local and pasted documents continue to stay in the browser.

## Verification

- Check the issue template contains the required questions and privacy warning.
- Run the web lint and typecheck.
- Run the repository check suite and production build.
- Inspect the final diff for scope and privacy wording consistency.

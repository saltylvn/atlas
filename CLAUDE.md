# Atlas (atlas-optim)

Personal chief-of-staff PWA for one owner (Tyler): morning brief, week plan, people/comms, jobs and applications (logged from email), news, and a security center. See README.md and docs/.

## Rules for changes
- Next.js 16: `proxy.ts` (not middleware), async `cookies()`/`searchParams`. Check `node_modules/next/dist/docs/` before using an API.
- Every page and server action goes through `getContext()` (lib/context.ts). Never query a store or Supabase directly from a page.
- Every server action validates input with zod and returns `ActionResult`. Security-relevant actions call `audit()`.
- Pure logic lives in `lib/domain/` with tests in `test/`. No I/O there.
- Outbound HTTP only via `lib/security/safeFetch.ts`; a new host goes on `ALLOWED_HOSTS`.
- Model calls only via `lib/ai/model.ts` (it routes to `claude.ts` or `gemini.ts`), gated by `takeAiCall`, with an offline fallback. AI output is display-only.
- Agents draft; they never send, apply or delete outside the app.
- New table: migration with RLS (`owner_id = auth.uid()` and `is_owner_aal2()`), Store collection, demo seed.
- Secrets: server-only env, listed in `.env.example`, never logged.
- Mobile-first: 16px inputs, 44px tap targets, test at 375px and 768px.

## Commands
`npm run dev` (demo mode without Supabase) · `npm run check` (lint, types, tests) · `npm run build`

# Going live

Supabase (database + auth) and Vercel (hosting), the same stack as your other apps. About 30 minutes.

## 1. Supabase

1. Create a project. Copy the URL, the publishable key, and a secret key (Settings > API keys).
2. SQL editor: run each file in `supabase/migrations/` in order, then:
   ```sql
   insert into private.config (key, value) values ('owner_email', 'you@example.com');
   ```
3. Authentication > Providers > Google: enable it with a Google OAuth client (Web). Authorized redirect URI: `https://<project>.supabase.co/auth/v1/callback`.
4. Authentication > Multi-Factor: make sure TOTP is enabled.
5. Authentication > URL Configuration: Site URL = your Vercel URL; Redirect URLs = `https://<your-domain>/auth/callback` (and `http://localhost:3000/auth/callback` for local live testing).

## 2. Vercel

1. Import the repo. Set the variables from `.env.example` (mark secrets Sensitive). Leave `ATLAS_OWNER_USER_ID` empty for now.
2. Deploy, open the site, **Continue with Google**, then enroll your authenticator on the next screen.
3. Supabase > Authentication > Users: copy your user id into `ATLAS_OWNER_USER_ID` and redeploy (lets scheduled jobs write your rows).

## 3. Gmail (read-only)

Recommended: an **app password**. It never expires and needs no Google review.

1. Vercel env: `ATLAS_VAULT_KEY` (`openssl rand -base64 32`, Sensitive), plus `SUPABASE_SECRET_KEY` and `ATLAS_OWNER_USER_ID` from earlier. Redeploy.
2. Google Account > Security: **2-Step Verification** on. Then [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords): create one named **Atlas**.
3. Atlas > Connectors > Gmail: paste the 16 letters and tap **Connect Gmail**. Atlas signs in once to check it, stores it encrypted, and runs the first sync.

Alternative: **Google sign-in (OAuth)**. Gmail read access is a *restricted* scope, so an unreviewed app works only in Google's Testing mode, for listed test users, and Google expires the connection every 7 days.

1. Google Auth Platform > **Data access**: add `.../auth/gmail.readonly`. **Audience**: Testing, with your address under Test users.
2. **Clients** > your Web client > Authorized redirect URIs: add `https://<your-domain>/api/connect/google/callback`.
3. Vercel env: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (Sensitive), `ATLAS_SITE_URL`. Redeploy, then Connectors > Gmail > **use Google sign-in**. Start it from Safari, not the Home Screen app.

## 4. Morning notification and Siri capture

1. `npx web-push generate-vapid-keys`, then set `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` (Sensitive) in Vercel.
2. `CRON_SECRET` (`openssl rand -hex 32`, Sensitive). Vercel calls `/api/cron/morning` at 14:00 UTC Monday-Saturday and `/api/cron/afternoon` at 19:00 UTC Monday-Friday (`vercel.json`). Hobby runs each within its hour, so the Morning Brief is ready before 9:00 AM and the 2:00 PM Brief before 2:00 PM Mountain time, summer or winter. Each saved brief pings your phone.
3. `ATLAS_CAPTURE_TOKEN` (`openssl rand -hex 32`, Sensitive) for the Siri Shortcut. Connectors shows the steps.
4. Redeploy. On the iPhone, open Atlas **from the Home Screen** > Connectors > **Turn on for this device** > **Send a test**.

## 5. Keep Supabase awake

Supabase Free pauses a project after 7 days with no database activity. A scheduled GitHub Action prevents that:

1. Generate a token: `openssl rand -hex 32`.
2. Vercel: set `ATLAS_KEEPALIVE_TOKEN` to it (Sensitive) and redeploy.
3. GitHub repo > Settings > Secrets and variables > Actions: add `ATLAS_URL` (your site, e.g. `https://atlas-yourname.vercel.app`) and `ATLAS_KEEPALIVE_TOKEN` (same value).
4. Actions > **Keep Supabase awake** > Run workflow once; it should print `HTTP 200`.

It then runs every Monday and Thursday. If a run fails, GitHub emails you. (The daily morning job also touches the database, so the two overlap on purpose.)

## 6. Ask Atlas (search over your own data)

1. The `knowledge` migration turns on the `vector` extension and adds the passage table and `search_knowledge()`.
2. Deploy the embeddings function with JWT verification off (it checks the secret key itself): `supabase functions deploy embed --no-verify-jwt`. It uses `SUPABASE_SECRET_KEYS`, which Supabase provides to every function.
3. Atlas > Ask Atlas > **Index now**. Needs `SUPABASE_SECRET_KEY` in Vercel (already set for the scheduled jobs).
4. Optional: `GEMINI_API_KEY` or `ANTHROPIC_API_KEY` (Sensitive) for written answers. See [RAG.md](RAG.md).

## 6b. The Career desk

No new settings. The `career_desk` migration adds three tables and three agents. Vercel calls `/api/cron/evening` at 00:00 and 01:00 UTC for the Mentor's evening review; the handler runs it once, at about 6 PM your time. See [CAREER-DESK.md](CAREER-DESK.md).

## 7. Phone and iPad

Safari > your Atlas URL > Share > **Add to Home Screen**. It opens full screen like an app.

## Checks

- The keep-alive workflow run shows `HTTP 200`.
- `/api/health` returns `{"ok":true,"mode":"live"}`.
- Signing in with any other Google account bounces back to the login page with "isn't allowed".
- Settings > Integrations shows green for each configured piece.
- Connectors shows Gmail connected with a recent sync, and **Send a test** reaches your phone.

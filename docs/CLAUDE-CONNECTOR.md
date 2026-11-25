# Talk with Claude about your job search (Atlas's MCP connector)

How it was built and why: [MCP-BUILD.md](MCP-BUILD.md).

Claude reads Atlas through a read-only connector, so you can ask about your queue, your
applications, the market and your proof project, or practise an interview out loud in
Claude's voice mode on your phone. Atlas never applies, sends or changes anything from here.

## How it works

```
Claude (web, desktop, phone, Claude Code)
   │  MCP over HTTPS, OAuth token
   ▼
Atlas  /api/mcp  ── checks the token (lib/mcp/auth.ts), then 9 read-only tools (lib/mcp/tools.ts)
   ▲
   │  sign-in and consent
Supabase Auth (OAuth 2.1 server) ── consent screen hosted by Atlas at /oauth/consent
```

- **Sign-in:** Supabase Auth is the OAuth server (Dynamic Client Registration, PKCE). Claude
  registers itself, sends you to Atlas's consent page, and gets a token for your account.
- **Who gets in:** only an OAuth token for the owner's account, only while **Claude access** is
  on in Settings. Approving needs you signed in with your second factor. A browser session
  token is refused.
- **What it can do:** read only. The tools file is checked in CI for any write.
- **Logged:** every call (tool, app, time, outcome) in the audit log. Arguments and answers are
  not logged.
- **Cost:** $0. The tools return data the rules already computed, with no Gemini calls. Claude
  does the talking, on your Claude plan.

## One-time setup

1. **Supabase dashboard** (your Atlas project), **Authentication > OAuth Server**:
   - Turn on the **OAuth 2.1 server**.
   - Set **Authorization Path** to `/oauth/consent`.
   - Turn on **Dynamic client registration**, so Claude can register itself.
   - Check **Authentication > URL Configuration > Site URL** is your Atlas address. The
     consent screen is served at Site URL + Authorization Path.
2. **Atlas > Settings > Connect Claude:** turn **Claude access** on and copy the connector URL
   (`https://<your Atlas>/api/mcp`).
3. **claude.ai** (in a browser), **Settings > Connectors > Add custom connector**:
   - Name: `Atlas`
   - URL: paste the connector URL.
   - Press **Connect**. Claude opens Atlas's consent page.
   - Sign in with Google and your authenticator code if asked, then press **Approve**.
4. **Phone:** open the Claude app. The connector you added on claude.ai appears there too.
   - In a chat, make sure **Atlas** is on in the tools menu.

Claude Code (optional): `claude mcp add --transport http atlas https://<your Atlas>/api/mcp`,
then `/mcp` in Claude Code to sign in the same way.

## Using it

Type or speak, for example:

- "Use Atlas: what should I apply to today, and why?"
- "What does my funnel say about why I'm not getting replies?"
- "What's my proof project, and what should I build first?"
- "Which skills do junior Software Engineer postings ask for most, and what do they pay?"
- **Practise an interview (voice mode):** "Use Atlas to run a mock interview for my
  Northwind Labs interview. One question at a time, and give me feedback after each answer."

For the best practice session, press **Prepare for the interview** on the application in Atlas
first. Claude then has your stories, gaps and questions to ask. Without it, Claude still gets
the likely questions and can search your resumes and projects.

Walking: start voice mode with earbuds in. Claude asks, you answer, and it follows up and
coaches from your real material only.

## Tools Claude can use

| Tool | What it reads |
|---|---|
| `apply_queue` | Queued jobs and today's top five, with why |
| `job_snapshot` | One job: posting facts, Pitch's tailoring, company research |
| `applications` | Sent applications, status and last heard (and their ids) |
| `funnel` | Reply rate and what your applications say |
| `market` | Latest market report; pay, skills, years and certifications per role |
| `proof_project` | Your open proof project and the ones GitHub closed |
| `interview_prep` | Interview Prep's questions, stories, gaps and questions to ask |
| `practice_interview` | The same prep, plus how to run a mock interview |
| `my_projects` | Your public GitHub projects (stack, skills, languages), or one in full with its README |
| `search_material` | The best passages from your resumes and projects for a query |

## The public demo connector (for showing the build)

A second endpoint, `/api/mcp-demo`, serves the same eleven tools over a **fictional** job search
(a made-up person, Sam Rivera, at made-up companies). It needs no sign-in, so an interviewer can
add it to their own Claude and try it in a couple of minutes.

- **Turn it on:** set `ATLAS_MCP_DEMO=1` in Vercel (Production) and redeploy. It is off by default.
- **Share it:** in Claude, Settings > Connectors > Add custom connector, URL
  `https://<your Atlas>/api/mcp-demo`. No authentication.
- **Try:** "Use the Atlas demo: what should Sam apply to today?" or "Run a mock interview for
  Sam's interview."
- **Why it is safe:** it cannot reach your data. Its code imports no real data source, and CI
  fails if that changes. It is read-only, writes nothing, and is limited to 40 requests per
  caller and 400 in total per 10 minutes.
- **Turn it off:** remove `ATLAS_MCP_DEMO` and redeploy.

## Turning it off

- **Settings > Connect Claude > Claude access: off** refuses every request immediately.
- **Revoke** next to an app ends its tokens. It has to ask you again to come back.
- Tokens last about an hour; Claude refreshes them while the app is approved.

## If something goes wrong

- **Claude says it can't connect:** check the four Supabase settings in step 1, and that
  Claude access is on.
- **The consent page says the request expired:** requests last 10 minutes. Press Connect again
  in Claude.
- **"Claude access is off":** turn it on in Settings, then reconnect.
- **Answers are thin:** run the Analyst (Refresh on Growth) and Prepare on the application, so
  there is data to read.

## Not doing

- No write tools: Claude cannot mark a job applied, send a follow-up or change settings.
- No audio in Atlas: voice is Claude's own voice mode.
- No local server holding Atlas's secret key on your laptop.

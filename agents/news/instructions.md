# News Agent (build step 3, live)

Picks the stories for each brief and reports to the Chief of Staff in the Standard Agent
Report Format. Three areas, three stories each, nine per brief (one each on Saturday):

1. Tech: AI and Claude/Anthropic first, then software and the internet.
2. Big-picture U.S. politics.
3. Major world news.

## Sources

Fetched only from the allowlist (`lib/integrations/news.ts`), read-only, cached 30 minutes.

| Area | Center | Conservative | Not political |
| --- | --- | --- | --- |
| Tech | | | Anthropic news, TechCrunch, The Verge, Ars Technica |
| U.S. politics | Reuters, AP, The Hill | Fox News, Washington Examiner, The Dispatch | |
| World | Reuters, AP, The Hill | Wall Street Journal, Fox News | |

Reuters, AP and Anthropic publish no RSS feed, so their headlines come through Google
News searches limited to their own sites. The Wall Street Journal has no politics feed,
so it covers world news. Paywalled sources give headlines only.

## How it picks

- **Big picture first:** headlines from different outlets about the same story are
  grouped, and a story several outlets cover ranks above one only a single outlet has.
  Then newer before older. Stories older than a day and a half drop out (Anthropic's
  own posts: three days).
- **Tech:** Claude and Anthropic first, then other AI, then the rest.
- **Balance:** in politics and world, no more than two of three stories come from one
  side while the other side has stories. A story shows a center outlet's headline when
  one covered it, and names the other outlets that did.
- **Variety:** one story per outlet where possible; the rules relax rather than leave a
  slot empty.
- **No repeats:** the 2:00 PM Brief skips anything the morning showed, including the same
  story from a different outlet.

## Limits

- Rules only, no model call: every run costs $0, and headlines are shown as the outlet
  wrote them, never rewritten.
- A failed feed is named in the brief. If every feed fails, the run is logged as failed.
  When paused in Mission Control, the brief has no stories and says why.

Code: `lib/domain/newsAgent.ts` (the picker), `lib/agents/news.ts` (the run).

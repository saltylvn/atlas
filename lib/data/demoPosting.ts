import type { PageReader } from "@/lib/integrations/firecrawl";

// Demo mode has no Firecrawl key and reaches no site. "Read postings now" reads this
// made-up posting instead, so the demo shows what a read adds to an apply kit.

const DEMO_POSTING = `
About the role (sample posting, demo mode)
We are hiring a Solutions Engineer to build integrations and AI workflows for our customers.
This is a hybrid role: you will be in our Lehi office two days a week in the office.

What you bring
- 2-4 years of professional experience building software
- TypeScript, SQL and REST APIs; experience with LLMs and AI agents is a plus
- You enjoy working with customers and with a collaborative engineering team
- Travel to customer sites up to 10% of the time

Compensation
The base salary range for this role is $95,000 - $115,000 per year.
`;

/** Reads the sample posting, whatever the link. Nothing leaves the server. */
export const demoReadPage: PageReader = async () => ({ ok: true, text: DEMO_POSTING, title: "Solutions Engineer (sample)" });

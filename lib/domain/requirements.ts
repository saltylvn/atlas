// What a posting asks for beyond skills (owner's choice, 23 Nov 2026): the years of experience it
// states, and the certifications it names. Read from the posting's text by rules; only these
// facts are kept, never the text. For the Career Map (lib/domain/careerMap.ts).
//
// Pure: text in, facts out.

/** "5+ years", "3-5 years of experience", "minimum of 4 years", "seven years": the smallest asked. */
const YEARS = /\b(?:(\d{1,2})|(one|two|three|four|five|six|seven|eight|nine|ten|twelve|fifteen))\s*(?:\+|\s*(?:-|–|to)\s*\d{1,2})?\s*\+?\s*(?:years?|yrs?)\b(?:'s)?(?:\s+of)?(?:\s+(?:\w+\s+){0,4}?)?\s*(?:experience|exp\b|work|working|professional|industry|hands-on|relevant|in\b|building|developing|with\b)/gi;
const WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, fifteen: 15 };

/**
 * The years of experience a posting asks for, or null. When it names several ("3+ years of Python,
 * 5+ years of experience"), the largest is the bar for the role; amounts over 20 are not believed.
 */
export function yearsAsked(text: string): number | null {
  const found: number[] = [];
  for (const m of text.slice(0, 20_000).matchAll(YEARS)) {
    const n = m[1] ? Number(m[1]) : WORDS[m[2]!.toLowerCase()]!;
    if (n >= 1 && n <= 20) found.push(n);
  }
  return found.length ? Math.max(...found) : null;
}

/** Certifications tech postings commonly name, each with the patterns that mean it. */
export const CERTS: readonly [string, RegExp][] = [
  ["AWS certification", /\baws certified\b|\baws (solutions architect|developer|sysops|devops)( - | )?(associate|professional)\b|\baws certification\b/i],
  ["Azure certification", /\bazure (administrator|solutions architect|developer|devops engineer|security engineer)\b|\baz-\d{3}\b|\bazure certification\b/i],
  ["Google Cloud certification", /\b(google cloud|gcp) (certified|certification|professional)\b/i],
  ["Kubernetes (CKA/CKAD)", /\bcka\b|\bckad\b|\bcks\b|certified kubernetes/i],
  ["CompTIA Security+", /\bsecurity\+|\bsecurity plus\b/i],
  ["CompTIA A+ or Network+", /\b(a\+|network\+|comptia a|comptia network)/i],
  ["CISSP", /\bcissp\b/i],
  ["CISM or CISA", /\bcism\b|\bcisa\b/i],
  ["OSCP", /\boscp\b/i],
  ["CEH", /\bceh\b|certified ethical hacker/i],
  ["CCNA or CCNP", /\bccna\b|\bccnp\b/i],
  ["Terraform certification", /terraform associate|hashicorp certified/i],
  ["Salesforce certification", /salesforce certified|salesforce (administrator|developer) certification/i],
  ["ITIL", /\bitil\b/i],
  ["PMP or Scrum", /\bpmp\b|\bcsm\b|certified scrummaster|scrum master certification/i],
  ["Security clearance", /\b(secret|top secret|ts\/sci|ts sci) clearance\b|\bactive clearance\b|\bclearance required\b/i],
];

/** The certifications a posting names. */
export function certsIn(text: string): string[] {
  const t = text.slice(0, 20_000);
  return CERTS.filter(([, re]) => re.test(t)).map(([name]) => name);
}

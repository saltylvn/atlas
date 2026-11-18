// Reading the text of a job email, to tell a rejection or an interview invite from a plain
// "we received your application". Many rejections arrive under a subject like "Update on
// your application" or "Thank you for applying", so the subject alone cannot tell.
//
// Rules only, no AI model: the email's text never leaves Atlas. Only job emails are read
// (the Email Agent tags them from sender and subject first), each one once. What is kept
// is the verdict and the one sentence that decided it, with addresses, phone numbers and
// links removed. The text itself is never stored or logged. Pure: no I/O.

import { roleFromSubject } from "./applications";
import { scrub, scrubPhones } from "./knowledge";

export type TextVerdict = "interview" | "rejection" | "none";

export interface Reading {
  verdict: TextVerdict;
  /** The sentence that decided it, cleaned; "" when nothing did. */
  quote: string;
  /** The job the email is about ("Senior AI Engineer"), when it names one; else "". */
  role: string;
}

/** How much of an email's text is read: the decision is always near the top. */
export const MAX_TEXT_CHARS = 12_000;
/** The longest quote kept. */
export const MAX_QUOTE_CHARS = 200;

// A rejection, said plainly. "Unfortunately" alone is not one: confirmations use it too
// ("unfortunately we cannot reply to every applicant").
const REJECTION: RegExp[] = [
  /\bnot (?:to )?(?:be )?(?:move|moving|proceed|proceeding|progress|progressing|advance|advancing|continue|continuing)(?: forward)? with your (?:application|candidacy|profile)\b/i,
  /\b(?:decided|chosen|elected|opted|made the decision) to (?:move|proceed|go|pursue|continue|progress)(?: forward)? with (?:other|another|a different|different|more qualified)\b/i,
  /\b(?:moving|proceeding|going|move|proceed|go) forward with (?:other|another|a different) (?:candidates?|applicants?)\b/i,
  /\bother (?:candidates|applicants) whose (?:experience|qualifications|skills|background|profiles?)\b/i,
  /\bwill not be (?:moving|proceeding|progressing|advancing|continuing)\b/i,
  /\b(?:you|your application) (?:was|were|has|have) not (?:been )?(?:selected|chosen|successful)\b/i,
  /\bno longer (?:being )?(?:considered|under consideration|in consideration)\b/i,
  /\b(?:position|role|requisition|opening|job) (?:has|have) (?:now )?been (?:filled|closed)\b/i,
  /\bregret to (?:inform|let you know|tell you|share)\b/i,
  /\bunable to (?:offer you|move forward|proceed|progress)\b/i,
  /\bnot (?:the right |a )(?:fit|match) for (?:this|the) (?:role|position)\b/i,
];

// An invitation to talk, not a promise that someone may reach out one day.
const INTERVIEW: RegExp[] = [
  /\binvit(?:e|ing) you (?:to|for) (?:an? |the |a quick |a short |our )?(?:interview|phone (?:screen|interview|call)|video (?:call|interview)|call|conversation|chat|meeting|next round|onsite|on-site|technical|virtual)/i,
  /\b(?:would|'d|’d) (?:like|love) to (?:schedule|set up|arrange|invite you|speak with you|talk with you|chat with you|meet with you|connect with you|move you forward)\b/i,
  /\b(?:schedule|set up|book|arrange) (?:an?|your|the|a quick|a short) (?:interview|phone screen|screening|screening call|call|video call|chat|conversation|meeting|time to (?:talk|chat|speak))\b/i,
  /\b(?:share|send|provide|let (?:us|me) know|reply with) (?:me |us )?(?:your|a few times (?:of|for) your|some) availability\b/i,
  /\b(?:select|pick|choose|book|grab) a time\b/i,
  /\byou(?:'ve| have) been (?:selected|invited|chosen|moved forward|advanced) (?:for|to)\b/i,
  /\b(?:move|moved|advance|advanced) (?:you )?(?:forward )?to the next (?:round|stage|step)\b/i,
  /\bnext step (?:is|will be|would be) (?:an?|a quick|a short|the) (?:interview|call|phone screen|chat|conversation|technical|video)/i,
  /\b(?:calendly\.com|goodtime\.io|cal\.com\/|calendar\.app\.google|ashbyhq\.com\/[^\s]*schedul|greenhouse\.io\/[^\s]*schedul)/i,
];

// A sentence that only describes what might happen is not a decision.
const HYPOTHETICAL = /\b(?:if|in the event|should (?:you|we|your)|unless|whether|once (?:we|our|the))\b/i;
const PROMISE = /\bwill (?:reach out|contact you|be in touch|get back|follow up|let you know|review|be reviewing|notify)\b/i;

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”", mdash: "—", ndash: "–", hellip: "…" };

/** An HTML email as plain text: no scripts or styles, a break per block, links kept as their address. */
export function htmlToText(html: string): string {
  return html
    .slice(0, MAX_TEXT_CHARS * 4)
    .replace(/<(script|style|head|title)\b[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a\s*>/gi, (_m, href: string, label: string) => `${label} ${/^https?:/i.test(href) ? href : ""} `)
    .replace(/<(br|\/p|\/div|\/li|\/tr|\/h[1-6]|p|div|li|tr|h[1-6])\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === "#") {
        const code = e[1]?.toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : " ";
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/[ \t\r\f\v]+/g, " ")
    .replace(/\n\s*\n+/g, "\n");
}

/** The part of a message's structure to read: plain text first, else HTML. Never an attachment. */
export interface StructureNode {
  type: string;
  part?: string;
  disposition?: string;
  childNodes?: StructureNode[];
}

export function pickTextPart(root: StructureNode | undefined): { part: string; html: boolean } | null {
  const found: { plain?: string; html?: string } = {};
  const walk = (n: StructureNode, depth: number) => {
    if (depth > 8) return;
    const type = n.type.toLowerCase();
    if (n.childNodes?.length) {
      // An attached email (message/rfc822) is someone else's message: not read.
      if (type === "message/rfc822") return;
      for (const c of n.childNodes) walk(c, depth + 1);
      return;
    }
    if (n.disposition?.toLowerCase() === "attachment") return;
    const part = n.part ?? "1";
    if (type === "text/plain" && !found.plain) found.plain = part;
    if (type === "text/html" && !found.html) found.html = part;
  };
  if (root) walk(root, 0);
  if (found.plain) return { part: found.plain, html: false };
  if (found.html) return { part: found.html, html: true };
  return null;
}

/** The email's own words: quoted earlier messages and signatures' legal footers dropped. */
function ownWords(text: string): string {
  const lines = text.slice(0, MAX_TEXT_CHARS).split("\n");
  const out: string[] = [];
  for (const l of lines) {
    const line = l.trim();
    // The earlier message in a reply chain starts here; your own words would be below it.
    if (/^on .{4,200} wrote:$/i.test(line) || /^-{2,}\s*original message\s*-{2,}$/i.test(line) || /^from: .+$/i.test(line)) break;
    if (line.startsWith(">")) continue;
    out.push(line);
  }
  return out.join("\n");
}

const sentencesOf = (text: string): string[] =>
  ownWords(text)
    .split(/\n+|(?<=[.!?])\s+(?=[A-Z“"‘'(])/)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s.length >= 12 && s.length <= 600);

/** A decided sentence, safe to keep: no addresses, phone numbers or links, at most 200 characters. */
export function cleanQuote(s: string): string {
  const q = scrubPhones(scrub(s)).replace(/\b[\w.-]+\.(?:com|io|co|ai|org|net)\/\S*/gi, "").replace(/\s+/g, " ").replace(/\s+([,.!?])/g, "$1").trim();
  return q.length > MAX_QUOTE_CHARS ? `${q.slice(0, MAX_QUOTE_CHARS - 1).trimEnd()}…` : q;
}

/** What a job email's text says: a rejection, an interview invite, or neither (a rejection wins), and the role it names. */
export function readVerdict(text: string): Reading {
  const sentences = sentencesOf(text);
  const role = roleFromText(text);
  const rejected = sentences.find((s) => !HYPOTHETICAL.test(s) && REJECTION.some((r) => r.test(s)));
  if (rejected) return { verdict: "rejection", quote: cleanQuote(rejected), role };
  const invited = sentences.find((s) => !HYPOTHETICAL.test(s) && !PROMISE.test(s) && INTERVIEW.some((r) => r.test(s)));
  if (invited) return { verdict: "interview", quote: cleanQuote(invited), role };
  return { verdict: "none", quote: "", role };
}

// ---------------------------------------------------------------------------
// The role an email is about
//
// "Thank you for applying for the Senior AI Engineer role", "Position: Solutions
// Architect", "your application for Forward Deployed Engineer at Acme". A candidate must
// name a kind of job (engineer, analyst, manager...), so "this position" or "the next
// step" is never taken for a role.

const JOB_NOUN =
  /\b(engineer|engineering|developer|architect|manager|analyst|scientist|designer|specialist|consultant|lead|director|administrator|admin|technician|intern|internship|associate|representative|coordinator|programmer|strategist|officer|head of|vp|advocate|writer|researcher|operator|sre|devops|support|partner|executive|recruiter|tester|qa|owner|evangelist|instructor|trainer|agent)\b/i;
const LABELED = /^(?:position|role|job title|job|title|position title|requisition title|opening)\s*[:\-–—]\s*(.{3,120})$/i;
const IN_SENTENCE: RegExp[] = [
  /\b(?:application|applying|applied|candidacy|interest)\s+(?:for|to|in)\s+(?:the\s+|our\s+|a\s+|an\s+)?(?:position of\s+)?["“]?([A-Z][^"”.,;:!?()\n]{2,100}?)["”]?\s+(?:role|position|opening|opportunity|job|req\w*)\b/,
  /\b(?:application|applying|applied|candidacy|interest)\s+(?:for|to|in)\s+(?:the\s+|our\s+)?(?:position of\s+)?["“]?([A-Z][^"”.,;:!?()\n]{2,100}?)["”]?\s+(?:at|with)\s+[A-Z0-9]/,
  /\bposition of\s+["“]?([A-Z][^"”.,;:!?\n]{2,100}?)["”]?(?:\s+(?:at|with)\b|[.,;!]|$)/,
  /\bfor (?:the|our)\s+["“]?([A-Z][^"”.,;:!?()\n]{2,100}?)["”]?\s+(?:role|position|opening)\b/,
];

/** A role as written, or "" when it does not look like one. */
export function cleanRole(raw: string): string {
  const r = raw
    // "your interest in Novaline and the Applied AI Engineer role": the role is after "and the".
    .replace(/^.*\band (?:the|our|this|your)\s+/i, "")
    .replace(/["“”]/g, "")
    // A requisition number is not part of the title: "AI Engineer (R-12345)", "AI Engineer - 4521".
    .replace(/\s*[-–—|:]?\s*\(?\b(?:req(?:uisition)?|job)?\s*(?:id|#|no\.?)?\s*[:#]?\s*[A-Z]{0,4}-?\d{3,}[\w-]*\)?\s*$/i, "")
    .replace(/\s+/g, " ")
    .replace(/^[\s:,!.\-–—|]+|[\s:,!.\-–—|]+$/g, "")
    .trim();
  if (r.length < 3 || r.length > 100 || r.split(" ").length > 12) return "";
  if (/\b(you|your|us|our|we|this|that)\b/i.test(r) || !JOB_NOUN.test(r)) return "";
  return r;
}

/** The role an email's text names, from a labeled line or a sentence about the application; else "". */
export function roleFromText(text: string): string {
  const own = ownWords(text);
  for (const line of own.split("\n").slice(0, 120)) {
    const m = LABELED.exec(line.trim());
    const r = m ? cleanRole(m[1]!) : "";
    if (r) return r;
  }
  for (const s of sentencesOf(text).slice(0, 80)) {
    for (const p of IN_SENTENCE) {
      const m = p.exec(s);
      const r = m ? cleanRole(m[1]!) : "";
      if (r) return r;
    }
    const r = cleanRole(roleFromSubject(s));
    if (r) return r;
  }
  return "";
}

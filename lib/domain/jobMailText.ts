// Reading the text of a job email, to tell what kind of answer it is: a rejection, an
// interview invite, an assessment, a request for times, an offer or a request for something,
// or none of these (a plain "we received your application"). Many rejections arrive under a
// subject like "Update on your application" or "Thank you for applying", so the subject
// alone cannot tell.
//
// Everything in this file is rules: no AI model, no I/O. Only job emails are read (the Email
// Agent tags them from sender and subject first, and every email from a company with an open
// application is read too), each one once. What is kept is the verdict and the one sentence
// that decided it, with addresses, phone numbers and links removed. The text itself is never
// stored or logged.
//
// What may leave Atlas, and when (docs/design-pipeline.md, 5.5; docs/SECURITY.md):
//   - By default, nothing. The rules here read every job email, and its text goes nowhere.
//   - Only while the setting "Let the AI model read what rules cannot" is on (it starts off):
//     an email that arrived after you turned it on, from a company with an open application,
//     that these rules read as "none", is sent to the AI model once (lib/agents/mailReader.ts).
//     What is sent is `textForModel` below and nothing more: the email's own words (no quoted
//     earlier message), with email addresses, phone numbers and links removed, cut so that
//     the subject and the text together are at most 4,000 characters. Company and people's
//     names stay in. At most 12 emails a day. Never from the 15-minute watch.

import { roleFromSubject } from "./applications";
import { scrub, scrubPhones } from "./knowledge";
import { TEXT_VERDICTS, type TextVerdict } from "./types";

export { TEXT_VERDICTS, type TextVerdict };

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
/** The most of one email (subject and text together) that may go to the AI model (5.5). */
export const MAX_MODEL_CHARS = 4_000;

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
  // What you are invited to must be a conversation: "invite you to our virtual open house" and
  // "would like to invite you to view these jobs" are not interviews.
  /\binvit(?:e|ing) you (?:to|for) (?:an? |the |a quick |a short |our )?(?:interview|phone (?:screen|interview|call)|video (?:call|interview)|call|conversation|chat|meeting|next round|onsite|on-site|(?:technical|virtual) (?:interview|screen|call|round|onsite|on-site|conversation|discussion|chat|meeting))/i,
  /\b(?:would|'d|’d) (?:like|love) to (?:schedule|set up|arrange|speak with you|talk with you|chat with you|meet with you|connect with you|move you forward)\b/i,
  /\b(?:schedule|set up|book|arrange) (?:an?|your|the|a quick|a short) (?:interview|phone screen|screening|screening call|call|video call|chat|conversation|meeting|time to (?:talk|chat|speak))\b/i,
  /\b(?:share|send|provide|let (?:us|me) know|reply with) (?:me |us )?(?:your|a few times (?:of|for) your|some) availability\b/i,
  /\b(?:select|pick|choose|book|grab) a time\b/i,
  /\byou(?:'ve| have) been (?:selected|invited|chosen|moved forward|advanced) (?:for|to)\b/i,
  /\b(?:move|moved|advance|advanced) (?:you )?(?:forward )?to the next (?:round|stage|step)\b/i,
  /\bnext step (?:is|will be|would be) (?:an?|a quick|a short|the) (?:interview|call|phone screen|chat|conversation|technical|video)/i,
  /\b(?:calendly\.com|goodtime\.io|cal\.com\/|calendar\.app\.google|ashbyhq\.com\/[^\s]*schedul|greenhouse\.io\/[^\s]*schedul)/i,
];

// An offer, made to you in so many words. "Offer" alone is not one: companies offer benefits,
// describe what happens before an offer, and decline to make one. A false offer is the most
// expensive mistake this reader can make, so anything short of plain is left undecided.
const OFFER: RegExp[] = [
  /\b(?:pleased|delighted|excited|thrilled|happy|glad) to (?:extend|offer|make)(?: to)? you (?:an?|the|our|this) (?:formal |official |verbal |written |conditional )?(?:offer|position|role|job)\b/i,
  /\b(?:extend(?:ing)?|mak(?:e|ing)) you (?:an?|our) (?:formal |official |verbal |written |conditional )?offer\b/i,
  /\b(?:would|'d|’d) like to (?:offer you (?:the|a|this|our) (?:position|role|job)|extend (?:you )?an offer|make you an offer)\b/i,
  /\boffer of employment\b/i,
  /\b(?:attached|enclosed|here) is (?:your|the|our) (?:formal |official |written )?offer(?: letter)?\b/i,
  /\byour (?:formal |official |written )?offer letter is (?:attached|enclosed|ready|below)\b/i,
];
// A sentence about offers in general, or one that says no.
const NOT_AN_OFFER = /\b(?:not|unable|cannot|no longer|regret|if|when|once|before|prior to|until|unless|should|may|might)\b|n['’]t\b/i;

// A test to take: named as one, and asked of you (not a step the company's process may include).
const TEST = "(?:assessment|take[- ]home(?: (?:assignment|exercise|project|challenge|test))?|(?:coding|technical|programming|skills?|online|written|aptitude) (?:challenge|test|exercise|assignment|assessment|screen)|work sample|case study|homework assignment)";
const SOME_WORDS = "(?:[\\w'’-]+ ){0,5}?";
const ASSESSMENT: RegExp[] = [
  new RegExp(`\\b(?:complete|take|finish|submit|start|begin) ${SOME_WORDS}${TEST}\\b`, "i"),
  new RegExp(`\\binvit(?:e|ing|ed) you to (?:(?:complete|take|participate in|do|sit) )?${SOME_WORDS}${TEST}\\b`, "i"),
  new RegExp(`\\bnext step ${SOME_WORDS}(?:is|will be|would be) ${SOME_WORDS}${TEST}\\b`, "i"),
  new RegExp(`\\b(?:your|the|this) ${SOME_WORDS}${TEST} (?:is (?:ready|attached|below|due)|link|must be (?:completed|submitted)|should take|will take)\\b`, "i"),
  /\b(?:hackerrank\.com|codesignal\.com|codility\.com|coderbyte\.com|testgorilla\.com|coderpad\.io)\b/i,
];
const NAMES_A_TEST = new RegExp(`\\b${TEST}\\b`, "i");
const NOT_ASKED_YET = /\b(?:may|might|typically|usually|some candidates|process (?:includes|consists|involves))\b/i;

// A request for times that names no interview (those are invites, above): what works for
// you, when you are free, or a meeting that has to move.
const DAY = "(?:(?:mon|tues|wednes|thurs|fri|satur|sun)day|tomorrow|today|(?:this|next) week|\\d{1,2}(?::\\d{2})?\\s?(?:a\\.?m\\.?|p\\.?m\\.?))";
const SCHEDULING: RegExp[] = [
  /\b(?:what|which) (?:times?|days?|dates?)(?: (?:and|or) times?)? (?:work|works|would work|are best|is best|suits?)\b/i,
  /\bwhen (?:are|would) you (?:be )?(?:available|free)\b/i,
  new RegExp(`\\b(?:are|would) you (?:be )?(?:available|free)\\b.{0,60}?\\b${DAY}`, "i"),
  new RegExp(`\\b(?:does|would|will|do)\\b.{0,60}?\\b${DAY}.{0,40}?\\bwork (?:for|with) you\\b`, "i"),
  /\b(?:send|share|give|provide|suggest|propose|let (?:me|us) know)(?: me| us)? (?:(?:a few|some|a couple of|two or three|2-3|several) )?(?:times|time slots|slots|windows|dates)\b/i,
  /\b(?:need|have|had|want|like) to reschedule\b/i,
  /\breschedul(?:e|ing) (?:our|your|the)\b/i,
  /\bmove (?:our|your|the) (?:call|interview|meeting|conversation|chat) to\b/i,
];

// A request for something of yours: a document, a fact, a form.
const ASKS = "(?:please|kindly|could you|can you|would you|we(?:'d|’d| would) (?:like|need) you to|we need you to|you(?:'ll|’ll| will) need to|we ask that you)";
const SEND = "(?:send|provide|share|submit|upload|forward|complete|fill (?:out|in)|confirm|verify|attach|return|sign)";
const THING =
  "(?:resume|résumé|cv|portfolio|references?|transcripts?|(?:work|writing|code) samples?|cover letter|(?:salary|compensation|pay) (?:expectations?|requirements?|range)|work authorization|visa status|start date|notice period|linkedin|github|certifications?|proof of|background check|(?:additional|more|further|the following|some|a few|the requested|the missing) (?:information|details|documents?|materials?|items?)|form|questionnaire)";
const INFO_REQUEST: RegExp[] = [
  new RegExp(`\\b${ASKS}\\b.{0,40}?\\b${SEND}\\b.{0,80}?\\b${THING}\\b`, "i"),
  /\b(?:what(?:'s|’s| is| are)|(?:could|can) you share) your (?:salary|compensation|pay) (?:expectations?|requirements?|range)\b/i,
  /\bare you (?:legally )?(?:authorized|eligible) to work\b/i,
  /\b(?:do|will|would) you (?:now or in the future )?(?:require|need) (?:visa )?sponsorship\b/i,
  /\b(?:when|how soon) (?:could|can|would) you (?:be able to )?start\b/i,
  /\bwhat is your (?:earliest )?(?:start date|notice period)\b/i,
];
// Surveys and account notices are not requests from the hiring team.
const NOT_A_REQUEST = /\b(?:voluntary|optional|self[- ]identif\w*|demographic|survey|feedback|eeo|equal (?:employment )?opportunity|your account|password|unsubscribe|email address)\b/i;

// An event open to every applicant is not an interview.
const AN_EVENT = /\b(?:webinar|open house|info(?:rmation)? session|career fair|hiring event|meetup|workshop|talent (?:community|network)|newsletter)\b/i;

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

/** The email's own words: the quoted earlier message, and everything under it, dropped. */
export function ownWords(text: string): string {
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

/**
 * What a job email's text says, and the role it names. One verdict per email, the weightiest
 * first: a rejection, an offer, an interview invite, an assessment, a request for times, a
 * request for something. "none" when no rule decides it.
 */
export function readVerdict(text: string): Reading {
  const sentences = sentencesOf(text);
  const role = roleFromText(text);
  const said = (verdict: TextVerdict, s: string | undefined): Reading | null => (s ? { verdict, quote: cleanQuote(s), role } : null);
  const decided = sentences.filter((s) => !HYPOTHETICAL.test(s));
  const hit = (rules: RegExp[]) => (s: string) => rules.some((r) => r.test(s));
  return (
    said("rejection", decided.find(hit(REJECTION))) ??
    said("offer", decided.find((s) => !NOT_AN_OFFER.test(s) && hit(OFFER)(s))) ??
    // "We invite you to a technical assessment" is a test to take, not an interview.
    said("interview", decided.find((s) => !PROMISE.test(s) && !NAMES_A_TEST.test(s) && !AN_EVENT.test(s) && hit(INTERVIEW)(s))) ??
    said("assessment", decided.find((s) => !PROMISE.test(s) && !NOT_ASKED_YET.test(s) && hit(ASSESSMENT)(s))) ??
    said("scheduling", decided.find((s) => !PROMISE.test(s) && hit(SCHEDULING)(s))) ??
    said("info_request", decided.find((s) => !PROMISE.test(s) && !NOT_A_REQUEST.test(s) && hit(INFO_REQUEST)(s))) ?? { verdict: "none", quote: "", role }
  );
}

/**
 * The only form in which a job email's text may go to the AI model (5.5): its own words (no
 * quoted earlier message), with email addresses, phone numbers and links removed, cut to
 * `max` characters. Names stay in: the reading needs them.
 */
export function textForModel(text: string, max: number = MAX_MODEL_CHARS): string {
  const clean = scrubPhones(scrub(ownWords(text)))
    .replace(/\b[\w.-]+\.(?:com|io|co|ai|org|net)\/\S*/gi, "")
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
  return clean.slice(0, Math.max(0, max)).trimEnd();
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

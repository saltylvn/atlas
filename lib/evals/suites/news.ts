import { keywords, names, sameStory } from "@/lib/domain/newsAgent";
import type { EvalCase, EvalSuite } from "../types";

// The News Agent's hardest job is knowing when two outlets cover the same story, so a
// brief never shows it twice and stories several outlets cover rank higher.

/** [headline from one outlet, headline from another, same story?, why the rules miss it] */
const PAIRS: [string, string, boolean, string?][] = [
  ["Nvidia CEO Jensen Huang unveils new AI chips at GTC", "Jensen Huang unveils Nvidia's new AI chips", true],
  ["Supreme Court to decide if Trump's asylum restrictions are legal", "Supreme Court will hear Trump asylum case", true],
  ["Israel and Hamas agree to ceasefire deal", "Ceasefire deal reached between Israel and Hamas", true],
  ["US, China hold first Board of Trade meeting", "China and U.S. hold first trade board meeting", true],
  ["Hurricane Milton makes landfall in Florida", "Florida braces as Hurricane Milton makes landfall", true],
  ["Ukraine says Russia launched 100 drones overnight", "Russia launches overnight drone attack on Ukraine", true],
  ["Musk's xAI raises $10 billion", "xAI raises $10bn in new funding round, Musk says", true],
  ["Senate passes government funding bill, averting shutdown", "Government shutdown averted as Senate passes funding bill", true],
  ["Anthropic releases Claude Opus 5 with longer memory", "Claude Opus 5 arrives: Anthropic's new model has longer memory", true],
  ["Fed holds interest rates steady", "Federal Reserve leaves rates unchanged", true, "Different words for the same thing (\"Fed\" and \"Federal Reserve\", \"holds steady\" and \"unchanged\"). Keyword matching needs shared words."],
  ["Biden signs executive order on AI safety", "White House issues AI safety order", true, "\"Biden\" and \"White House\" mean the same actor here; keyword matching can't know that."],
  // Different stories that share a name or a topic
  ["Apple unveils new iPhone", "Apple faces EU antitrust fine", false],
  ["OpenAI releases GPT-5.5 model", "Anthropic releases Claude Opus 5 model", false],
  ["Tesla recalls 200,000 vehicles over software glitch", "Tesla stock jumps after earnings beat", false],
  ["Google announces Gemini 3", "Google lays off hundreds in cloud unit", false],
  ["Supreme Court hears arguments on tariffs", "Supreme Court declines to take up gun case", false],
  ["Microsoft earnings beat expectations on cloud growth", "Amazon earnings beat expectations on cloud growth", false, "Six of seven key words match; only the company differs."],
  ["Trump meets Xi in Beijing", "Trump signs spending bill", false],
  ["Earthquake strikes central Japan", "Typhoon nears southern Japan", false],
  ["Meta unveils new smart glasses", "Meta fined by EU regulators", false],
];

/** [headline in one area, headline in another, share a full name?] */
const NAMES: [string, string, boolean, string?][] = [
  ["The unfolding Jensen Huang scandal: a timeline", "Lawmakers question Jensen Huang over chip exports", true],
  ["Sam Altman testifies before Senate panel", "What Sam Altman told senators about AI rules", true],
  ["Chris Van Hollen announces run for Senate majority leader", "Schumer challenged by Van Hollen in leadership race", true],
  ["White House weighs new chip export rules", "White House hosts tech leaders", false],
  ["Supreme Court takes up tariff case", "Supreme Court ruling shakes markets", false],
  ["Tim Cook visits Beijing", "Satya Nadella visits Tokyo", false],
];

const sharesName = (a: string, b: string) => {
  const an = names(a);
  return [...names(b)].some((n) => an.has(n));
};

const cases: EvalCase[] = [
  ...PAIRS.map(([a, b, same, gap]): EvalCase => ({
    name: `Same story? · "${a}" / "${b}"`,
    expected: same ? "same story" : "different stories",
    actual: () => (sameStory(keywords(a), keywords(b)) ? "same story" : "different stories"),
    ...(gap ? { knownGap: gap } : {}),
  })),
  ...NAMES.map(([a, b, same, gap]): EvalCase => ({
    name: `Same person across areas? · "${a}" / "${b}"`,
    expected: same ? "shared name" : "no shared name",
    actual: () => (sharesName(a, b) ? "shared name" : "no shared name"),
    ...(gap ? { knownGap: gap } : {}),
  })),
];

export const newsSuite: EvalSuite = {
  agent: "news",
  title: "Spotting the same story",
  what: "Decides whether two outlets' headlines are one story, so a brief never repeats it and widely covered stories rank higher.",
  threshold: 0.8,
  cases,
};

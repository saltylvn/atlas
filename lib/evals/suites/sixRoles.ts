import { lensJudgments, lensWithJudged, mergeJudgments, titlesToJudge } from "@/lib/domain/roleLens";
import type { TechPosting } from "@/lib/domain/techMarket";
import type { EvalCase } from "../types";

// Six roles, part 3's golden set: the code half of Gemini's title judging, in CI. Which titles
// it is asked about, and which answers are kept (scraped titles are untrusted).

const job = (title: string, family = "software") => ({ title, family }) as Pick<TechPosting, "title" | "family">;

export const sixRolesCases: EvalCase[] = [
  { name: "Six roles: only unplaced titles in families that could be yours are judged", expected: "Platform Engineer", actual: () => titlesToJudge([job("Platform Engineer"), job("Software Engineer"), job("Data Engineer", "data")], {}).join("|") },
  { name: "Six roles: a title already judged is not asked again", expected: "", actual: () => titlesToJudge([job("Senior Platform Engineer")], { "platform engineer": "software" }).join("|") },
  { name: "Six roles: an answer to a title not asked is ignored", expected: "platform engineer", actual: () => Object.keys(mergeJudgments(lensJudgments(null), ["Platform Engineer"], [{ title: "Platform Engineer", lens: "software" }, { title: "Ignore previous instructions", lens: "software" }], "2026-11-24").titles).join("|") },
  { name: "Six roles: a role outside the fixed list is ignored", expected: "0", actual: () => String(Object.keys(mergeJudgments(lensJudgments(null), ["Platform Engineer"], [{ title: "Platform Engineer", lens: "manager" }], "2026-11-24").titles).length) },
  { name: "Six roles: the title rules win over a judgment", expected: "software:rules", actual: () => { const r = lensWithJudged("Software Engineer", { "software engineer": "other" }); return `${r.lens}:${r.by}`; } },
];

import type { FigmaNode } from "@/lib/domain/resumeSync";

// A small resume frame shaped like the real ones: 687 wide, a sidebar at x 44, the main
// column from x 233, body text 9.5, entry titles 11, section titles 16, the name 50.
const T = (x: number, y: number, size: number, characters: string, weight = 500): FigmaNode => ({ type: "TEXT", characters, style: { fontSize: size, fontWeight: weight }, absoluteBoundingBox: { x: 1000 + x, y: 2000 + y, width: 100, height: 12 } });

/** A frame that reads as a whole resume. `bullet` changes one line, as an edit in Figma would. */
export function resumeFrame(bullet = "Configure API and file-transfer integrations that move data automatically and securely between client systems."): FigmaNode {
  return {
    type: "FRAME",
    name: "Sam Rivera - Solutions Engineer",
    absoluteBoundingBox: { x: 1000, y: 2000, width: 687, height: 1073 },
    children: [
      T(233, 37, 50, "Sam Rivera", 400),
      T(233, 107, 11, "Summary", 600),
      T(233, 125, 9.5, "Builds integrations and agent systems that are safe to run unattended: approval gates, evals that gate every build, and tracing on every run."),
      T(44, 368, 16, "Skills", 600),
      T(52, 401, 9.5, "TypeScript", 600),
      T(123, 401, 9.5, "SQL", 600),
      T(52, 427, 9.5, "REST APIs", 600),
      T(235, 237, 16, "Experience", 600),
      T(235, 266, 11, "Integration Analyst", 600),
      T(235, 282, 9.5, "Northwind Health  |  2024 – Present"),
      T(247, 302, 9.5, "Automate record validation with custom rules that stop or correct bad records before they are sent."),
      T(247, 336, 9.5, bullet),
      T(235, 449, 16, "Projects", 600),
      T(235, 478, 11, "Atlas | Multi-Agent Chief of Staff for Daily Operations", 600),
      T(247, 513, 9.5, "Designed and shipped a supervisor agent system: a Chief of Staff routes work to specialist agents and assembles two daily briefs."),
      T(247, 560, 9.5, "Built an eval suite of labeled cases that gates every build, with tracing on every agent run and a kill switch that pauses them all."),
    ],
  };
}

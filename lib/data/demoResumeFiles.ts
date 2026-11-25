import "server-only";
import type { FileSource } from "@/lib/domain/resumeProof";
import { docText, resumeFromFigma, type FigmaNode } from "@/lib/domain/resumeSync";

// The demo's stand-ins for Notion's resume files, so the resume preview can be tried with
// `npm run dev` and no accounts. Fictional person, fictional resume, no network, no model.

const T = (x: number, y: number, size: number, characters: string, weight = 500): FigmaNode => ({ type: "TEXT", characters, style: { fontSize: size, fontWeight: weight }, absoluteBoundingBox: { x: 1000 + x, y: 2000 + y, width: 100, height: 12 } });

const LINES = [
  "Sam Rivera",
  "Summary",
  "Builds integrations and agent systems that are safe to run unattended: approval gates, evals that gate every build, and tracing on every run.",
  "Experience",
  "Integration Analyst, Northwind Health, 2024 to present",
  "Automate record validation with custom rules that stop or correct bad records before they are sent.",
  "Configure API and file-transfer integrations that move data automatically and securely between client systems.",
  "Projects",
  "Orbit: a supervisor agent system that routes work to specialist agents and assembles two daily briefs.",
];

/** A frame that reads as a whole resume, in the shape the real ones have. */
function demoFrame(): FigmaNode {
  return {
    type: "FRAME",
    name: "Sam Rivera (demo)",
    absoluteBoundingBox: { x: 1000, y: 2000, width: 687, height: 1073 },
    children: [
      T(233, 37, 50, LINES[0]!, 400),
      T(233, 107, 11, LINES[1]!, 600),
      T(233, 125, 9.5, LINES[2]!),
      T(44, 368, 16, "Skills", 600),
      T(52, 401, 9.5, "TypeScript", 600),
      T(123, 401, 9.5, "SQL", 600),
      T(52, 427, 9.5, "REST APIs", 600),
      T(235, 237, 16, LINES[3]!, 600),
      T(235, 266, 11, "Integration Analyst", 600),
      T(235, 282, 9.5, "Northwind Health  |  2024 to present"),
      T(247, 302, 9.5, LINES[5]!),
      T(247, 336, 9.5, LINES[6]!),
      T(235, 449, 16, LINES[7]!, 600),
      T(235, 478, 11, "Orbit | Multi-Agent Chief of Staff", 600),
      T(247, 513, 9.5, "Designed and shipped a supervisor agent system: a Chief of Staff routes work to specialist agents and assembles two daily briefs."),
      T(247, 560, 9.5, "Built an eval suite of labeled cases that gates every build, with tracing on every agent run and a kill switch that pauses them all."),
    ],
  };
}

/** A small, valid one-page PDF with real (selectable) text: the demo's stand-in for Figma's export. */
export function demoPdf(title: string, lines: readonly string[] = LINES): Uint8Array {
  const esc = (s: string) => s.replace(/[^\x20-\x7e]/g, "?").replace(/([\\()])/g, "\\$1");
  const wrapped = lines.flatMap((l) => l.match(/.{1,88}(\s|$)/g)?.map((x) => x.trim()) ?? [l]);
  const text = [`BT /F1 16 Tf 54 730 Td (${esc(title)}) Tj ET`, ...wrapped.map((l, n) => `BT /F1 10 Tf 54 ${700 - n * 16} Td (${esc(l)}) Tj ET`)].join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${text.length} >>\nstream\n${text}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, n) => {
    offsets.push(out.length);
    out += `${n + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(out, "latin1"));
}

/** Every role has the same demo frame; the PDF names the role, so you can see which was asked for. */
export function demoResumeFiles(roles: readonly string[]): { sources: () => Promise<FileSource[]>; download: (file: { name: string; url: string }) => Promise<Uint8Array> } {
  return {
    // Each role has a PDF in its row, as the Resumes database in Notion does.
    sources: async () => roles.map((role, n) => ({ role, file: { name: `${role} (demo resume).pdf`, url: `https://prod-files-secure.s3.us-west-2.amazonaws.com/demo/${n + 1}.pdf` } })),
    download: async (file) => demoPdf(file.name.replace(/\.pdf$/, ""), ["Sam Rivera", ...docText(resumeFromFigma(demoFrame())!).split("\n")]),
  };
}

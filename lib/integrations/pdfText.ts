import "server-only";

// The text inside a PDF, in the order the file stores it: what a job board's parser has to
// work with. Used to check a resume exported from Figma (lib/domain/pdfReadable.ts).
//
// One small library, unpdf (PDF.js built for servers), loaded only when a resume is checked.
// It reads; it renders nothing and fetches nothing. A PDF it cannot read gives null: the
// check then says "not checked", and never blocks or passes anything by itself.

export interface PdfText {
  pages: number;
  text: string;
}

export type PdfTextReader = (bytes: Uint8Array) => Promise<PdfText | null>;

const MAX_CHARS = 200_000;
const WAIT_MS = 10_000;

export const pdfText: PdfTextReader = async (bytes) => {
  try {
    const { extractText } = await import("unpdf");
    // A copy: the reader takes ownership of the buffer it is given, and the caller still
    // needs the original bytes untouched (they are hashed and kept).
    const reading = extractText(new Uint8Array(bytes), { mergePages: true });
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), WAIT_MS).unref?.());
    const out = await Promise.race([reading, timeout]);
    if (!out) return null;
    return { pages: out.totalPages, text: out.text.slice(0, MAX_CHARS) };
  } catch {
    return null;
  }
};

/** The first page's size in points (1/72 inch), or null when the PDF cannot be read. */
export async function pdfPageSize(bytes: Uint8Array): Promise<{ width: number; height: number } | null> {
  try {
    const { getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const view = (await pdf.getPage(1)).getViewport({ scale: 1 });
    const ok = (n: number) => Number.isFinite(n) && n >= 50 && n <= 5000;
    return ok(view.width) && ok(view.height) ? { width: Math.round(view.width), height: Math.round(view.height) } : null;
  } catch {
    return null;
  }
}


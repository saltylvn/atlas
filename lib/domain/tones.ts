// Message tones, in their own zod-free module so client components can import the
// list without pulling the AI schemas (and zod) into the browser bundle.
export const TONES = ["warm", "concise", "formal", "playful"] as const;
export type Tone = (typeof TONES)[number];

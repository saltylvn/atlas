"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { getContext } from "@/lib/context";
import { PROJECT_KINDS, PROJECT_STATUSES } from "@/lib/domain/types";
import { firstIssue, formObject, id, localDay, type ActionResult } from "./_shared";

const NewProject = z.object({
  title: z.string().trim().min(1).max(160),
  kind: z.enum(PROJECT_KINDS),
  status: z.enum(PROJECT_STATUSES).default("idea"),
  why: z.string().trim().max(1000).default(""),
  nextStep: z.string().trim().max(300).default(""),
  link: z
    .string()
    .trim()
    .max(500)
    .refine((v) => v === "" || /^https:\/\/[^\s]+$/.test(v), "must start with https://")
    .transform((v) => (v === "" ? null : v)),
  reviewOn: z.union([localDay, z.literal("")]).transform((v) => (v === "" ? null : v)),
});

function refresh() {
  revalidatePath("/projects");
  revalidatePath("/");
}

export async function createProject(_: unknown, fd: FormData): Promise<ActionResult> {
  const p = NewProject.safeParse({ link: "", reviewOn: "", ...formObject(fd) });
  if (!p.success) return { ok: false, error: firstIssue(p.error) };
  const { store } = await getContext();
  if ((await store.projects.list()).length >= 300) return { ok: false, error: "300 projects is the limit. Archive some first." };
  await store.projects.create(p.data);
  await audit(store, { actor: "owner", action: "project.create", target: p.data.kind, detail: "", outcome: "success" });
  refresh();
  return { ok: true, message: "Saved" };
}

export async function setProjectStatus(projectId: string, status: string): Promise<ActionResult> {
  const p = z.object({ projectId: id, status: z.enum(PROJECT_STATUSES) }).safeParse({ projectId, status });
  if (!p.success) return { ok: false, error: "Bad input" };
  const { store } = await getContext();
  await store.projects.update(p.data.projectId, { status: p.data.status });
  refresh();
  return { ok: true };
}

export async function deleteProject(projectId: string): Promise<ActionResult> {
  const p = id.safeParse(projectId);
  if (!p.success) return { ok: false, error: "Bad id" };
  const { store } = await getContext();
  await store.projects.remove(p.data);
  await audit(store, { actor: "owner", action: "project.delete", target: p.data, detail: "", outcome: "success" });
  refresh();
  return { ok: true };
}

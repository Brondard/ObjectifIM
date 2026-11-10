"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { DISCIPLINES, PHASE_TYPES, PRIORITIES, SESSION_TYPES, keysOf } from "@/domain/labels";
import { isLocalDate } from "@/lib/time";
import { createClient, requireUser } from "@/lib/supabase/server";

const date = z.string().refine(isLocalDate, "Date invalide");
const optionalText = z.string().trim().transform((v) => v || null);

function fail(message: string): never {
  redirect(`/?error=${encodeURIComponent(message)}`);
}

function parse<T extends z.ZodType>(schema: T, formData: FormData): z.infer<T> {
  const result = schema.safeParse(Object.fromEntries(formData));
  if (!result.success) fail(result.error.issues.map((i) => `${i.path.join(".")} : ${i.message}`).join(" · "));
  return result.data;
}

const SeasonInput = z
  .object({ name: z.string().trim().min(1), start_date: date, end_date: date, goal: optionalText })
  .refine((s) => s.end_date > s.start_date, "La fin doit suivre le début");

export async function createSeason(formData: FormData) {
  const input = parse(SeasonInput, formData);
  const { supabase } = await requireUser();
  const { error } = await supabase.from("seasons").insert(input);
  if (error) fail(error.message);
  revalidatePath("/");
}

const PhaseInput = z
  .object({
    season_id: z.uuid(),
    type: z.enum(keysOf(PHASE_TYPES)),
    name: z.string().trim().min(1),
    start_date: date,
    end_date: date,
  })
  .refine((p) => p.end_date >= p.start_date, "La fin doit suivre le début");

export async function createPhase(formData: FormData) {
  const input = parse(PhaseInput, formData);
  const { supabase } = await requireUser();
  const { error } = await supabase.from("phases").insert(input);
  if (error) fail(error.code === "23P01" ? "Cette phase chevauche une phase existante" : error.message);
  revalidatePath("/");
}

const SessionInput = z.object({
  date,
  discipline: z.enum(keysOf(DISCIPLINES)),
  session_type: z.enum(keysOf(SESSION_TYPES)),
  priority: z.enum(keysOf(PRIORITIES)),
  duration_min: z.coerce.number().int().positive().max(24 * 60),
  title: optionalText,
});

export async function createPlannedSession(formData: FormData) {
  const { duration_min, ...input } = parse(SessionInput, formData);
  const { supabase } = await requireUser();
  const { error } = await supabase
    .from("planned_sessions")
    .insert({ ...input, target_duration_s: duration_min * 60 });
  if (error) fail(error.message);
  revalidatePath("/");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

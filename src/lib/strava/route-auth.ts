import "server-only";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** Utilisateur de la session pour une route API ; réponse 401 sinon. */
export async function sessionUser() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) return { error: NextResponse.json({ error: "non connecté" }, { status: 401 }) } as const;
  return { supabase, userId } as const;
}

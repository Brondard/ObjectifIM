/** Les JSON Schema publiés dans `schemas/`, générés depuis Zod. */
import { z } from "zod";
import { STRUCTURE_VERSION, SessionStructure } from "./session-structure";

export function buildJsonSchemas(): Record<string, unknown> {
  return {
    [`session-structure.v${STRUCTURE_VERSION}.json`]: {
      $id: `https://github.com/Brondard/ObjectifIM/schemas/session-structure.v${STRUCTURE_VERSION}.json`,
      title: "Structure d'une séance",
      ...z.toJSONSchema(SessionStructure, { target: "draft-2020-12" }),
    },
  };
}

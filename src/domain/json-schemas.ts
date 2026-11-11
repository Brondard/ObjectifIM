/** Les JSON Schema publiés dans `schemas/`, générés depuis Zod. */
import { z } from "zod";
import { BLOCK_FORMAT_VERSION, PlanBlock } from "./plan/block";
import { STRUCTURE_VERSION, SessionStructure } from "./session-structure";

export function buildJsonSchemas(): Record<string, unknown> {
  return {
    [`session-structure.v${STRUCTURE_VERSION}.json`]: {
      $id: `https://github.com/Brondard/ObjectifIM/schemas/session-structure.v${STRUCTURE_VERSION}.json`,
      title: "Structure d'une séance",
      ...z.toJSONSchema(SessionStructure, { target: "draft-2020-12" }),
    },
    [`plan-block.v${BLOCK_FORMAT_VERSION}.json`]: {
      $id: `https://github.com/Brondard/ObjectifIM/schemas/plan-block.v${BLOCK_FORMAT_VERSION}.json`,
      title: "Bloc d'entraînement à importer",
      description: "Contrat d'import : un bloc couvre une période ; le réimporter remplace les séances prévues non réalisées de cette période.",
      ...z.toJSONSchema(PlanBlock, { target: "draft-2020-12", io: "input" }),
    },
  };
}

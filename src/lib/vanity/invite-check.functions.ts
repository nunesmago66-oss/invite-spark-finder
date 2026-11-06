import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
import { z } from "zod";

import { isValidCode, normalizeCode } from "./check-rules";
import { checkInviteOnDiscord } from "./invite-check.server";

const inputSchema = z.object({
  code: z
    .string()
    .max(64)
    .transform(normalizeCode)
    .refine(isValidCode, "Código inválido: use 2–3 caracteres (a-z, 0-9, -)."),
});

export const checkInvite = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => inputSchema.parse(data))
  .handler(async ({ data }) => {
    const clientKey =
      getRequestHeader("cf-connecting-ip") ??
      getRequestHeader("x-forwarded-for")?.split(",")[0]?.trim() ??
      "unknown";
    return checkInviteOnDiscord(data.code, clientKey);
  });

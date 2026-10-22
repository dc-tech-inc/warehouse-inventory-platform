import * as z from "zod";

// PostgreSQL text cannot store NUL (0x00); reject it here so it is a 400, not a 500 from the driver.
export const safeText = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((value) => !value.includes("\u0000"), { error: "Must not contain NUL characters" });

export const IdParams = z.object({ id: z.uuid() });

export const PageQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
});
export type PageQuery = z.infer<typeof PageQuery>;

export interface Page<T> {
  items: T[];
  total: number;
}

/** `?flag=true|false` as a boolean. */
export const boolFlag = z.enum(["true", "false"]).transform((value) => value === "true");

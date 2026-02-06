import { z } from "zod";

const allowFromEntry = z.union([z.string(), z.number()]);

const groupConfigSchema = z.object({
  allow: z.boolean().optional(),
  enabled: z.boolean().optional(),
  tools: z
    .object({
      allow: z.array(z.string()).optional(),
      deny: z.array(z.string()).optional(),
    })
    .optional(),
});

const telegramUserAccountSchema = z.object({
  name: z.string().optional(),
  enabled: z.boolean().optional(),
  apiId: z.number().optional(),
  apiHash: z.string().optional(),
  sessionString: z.string().optional(),
  dmPolicy: z.enum(["pairing", "allowlist", "open", "disabled"]).optional(),
  allowFrom: z.array(allowFromEntry).optional(),
  groupPolicy: z.enum(["disabled", "allowlist", "open"]).optional(),
  groups: z.object({}).catchall(groupConfigSchema).optional(),
  messagePrefix: z.string().optional(),
  responsePrefix: z.string().optional(),
});

export const TelegramUserConfigSchema = telegramUserAccountSchema.extend({
  accounts: z.object({}).catchall(telegramUserAccountSchema).optional(),
  defaultAccount: z.string().optional(),
});

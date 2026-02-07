import { Type } from "@sinclair/typebox";
import { NonEmptyString } from "./primitives.js";

export const InboxAddParamsSchema = Type.Object(
  {
    summary: Type.String({ minLength: 1, maxLength: 500 }),
    sessionKey: Type.Optional(NonEmptyString),
  },
  { additionalProperties: false },
);

export const InboxListParamsSchema = Type.Object(
  {
    limit: Type.Optional(Type.Integer({ minimum: 1 })),
    unreadOnly: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

export const InboxMarkReadParamsSchema = Type.Object(
  {
    ids: Type.Array(NonEmptyString, { minItems: 1 }),
  },
  { additionalProperties: false },
);

export const InboxDismissParamsSchema = Type.Object(
  {
    ids: Type.Array(NonEmptyString, { minItems: 1 }),
  },
  { additionalProperties: false },
);

export type InboxAddParams = { summary: string; sessionKey?: string };
export type InboxListParams = { limit?: number; unreadOnly?: boolean };
export type InboxMarkReadParams = { ids: string[] };
export type InboxDismissParams = { ids: string[] };

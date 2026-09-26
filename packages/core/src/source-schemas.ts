import { z } from 'zod';
import type { JsonValue } from './index.js';

export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() => z.union([
  z.null(), z.boolean(), z.number().finite(), z.string(),
  z.array(jsonValueSchema), z.record(jsonValueSchema),
]));
export const metadataSchema = z.record(jsonValueSchema);
export const sessionMetadataSchema = z.object({
  provider: z.string().min(1).optional(),
  agent_name: z.string().min(1).optional(),
  model_name: z.string().min(1).optional(),
  external_session_id: z.string().min(1).optional(),
  client_name: z.string().min(1).optional(),
}).strict();
export type SessionMetadata = z.infer<typeof sessionMetadataSchema>;

const message = z.object({ content: z.string().min(1), metadata: metadataSchema.optional() }).strict();
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const sourcePayloadSchemas = {
  'conversation.user_message': message,
  'conversation.assistant_message': message,
  'tool.call': z.object({ call_id: z.string().min(1), tool_name: z.string().min(1), input: jsonValueSchema }).strict(),
  'tool.result': z.object({ call_id: z.string().min(1), output: jsonValueSchema, is_error: z.boolean().optional() }).strict(),
  'command.executed': z.object({ command_id: z.string().min(1), command: z.string().min(1), cwd: z.string().min(1).optional() }).strict(),
  'command.result': z.object({ command_id: z.string().min(1), exit_code: z.number().int(), stdout: z.string(), stderr: z.string() }).strict(),
  'file.changed': z.object({ path: z.string().min(1), change_type: z.enum(['added', 'modified', 'deleted']),
    before_hash: hash.optional(), after_hash: hash.optional(), diff: z.string().optional() }).strict(),
  'test.result': z.object({ status: z.enum(['passed', 'failed', 'skipped']), summary: z.string(),
    command: z.string().min(1).optional(), metadata: metadataSchema.optional() }).strict(),
};
export type SourceEventType = keyof typeof sourcePayloadSchemas;
export type SourceEventData = {
  [K in SourceEventType]: { event_type: K; payload: z.infer<(typeof sourcePayloadSchemas)[K]> }
}[SourceEventType];

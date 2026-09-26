import { posix } from 'node:path';
import { z } from 'zod';
import { contentHash, hashSchema, registerExtensionEventSchema, sha256, timestampSchema, type CodeEventType } from '@graphit/core';

export const languages = ['typescript', 'tsx', 'javascript', 'jsx', 'python'] as const;
export type Language = typeof languages[number];
export function normalizePath(input: string): string {
  const path = input.replaceAll('\\', '/');
  if (!path || path.startsWith('/') || /^[A-Za-z]:/.test(path) || path.includes('\0') || path.split('/').includes('..')) throw new Error('Unsafe repository-relative path');
  const normalized = posix.normalize(path).replace(/^\.\//, '');
  if (normalized === '.' || normalized.startsWith('../')) throw new Error('Unsafe repository-relative path');
  return normalized;
}
export const pathSchema = z.string().refine((value) => {
  try { return normalizePath(value) === value; } catch { return false; }
}, 'Expected a normalized repository-relative path');
const integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const spanSchema = z.object({ contentHash: hashSchema, startByte: integer, endByte: integer,
  startLine: integer.min(1), startColumn: integer, endLine: integer.min(1), endColumn: integer }).strict();
export type SourceSpan = z.infer<typeof spanSchema>;
export const symbolKinds = ['file', 'module', 'class', 'interface', 'type', 'function', 'method', 'variable', 'constant', 'parameter', 'import', 'export'] as const;
export const symbolSchema = z.object({ key: z.string().min(1), kind: z.enum(symbolKinds), name: z.string().min(1),
  qualifiedName: z.string().min(1), discriminator: z.string(), signature: z.string().nullable(),
  parent: z.string().nullable(), exported: z.boolean(), span: spanSchema }).strict();
export type ExtractedSymbol = z.infer<typeof symbolSchema>;
export const importSchema = z.object({ key: z.string(), module: z.string(),
  bindings: z.array(z.object({ imported: z.string(), local: z.string() }).strict()),
  style: z.enum(['named', 'namespace', 'default', 'side_effect', 'python_module']), span: spanSchema }).strict();
export type ExtractedImport = z.infer<typeof importSchema>;
export const relationshipSchema = z.object({ sourceKey: z.string(), targetName: z.string(),
  kind: z.enum(['CALLS', 'REFERENCES', 'EXTENDS', 'IMPLEMENTS', 'EXPORTS']), receiver: z.string().nullable(),
  scopeKey: z.string(), unsafe: z.boolean(), span: spanSchema }).strict();
export type ExtractedRelationship = z.infer<typeof relationshipSchema>;
export const diagnosticSchema = z.object({ code: z.string(), message: z.string(), path: pathSchema,
  severity: z.enum(['error', 'warning']), span: spanSchema.nullable() }).strict();
export type Diagnostic = z.infer<typeof diagnosticSchema>;
export const extractionSchema = z.object({ path: pathSchema, language: z.enum(languages), contentHash: hashSchema,
  parserId: z.string().min(1), parserVersion: z.string().min(1), symbols: z.array(symbolSchema),
  imports: z.array(importSchema), relationships: z.array(relationshipSchema), diagnostics: z.array(diagnosticSchema) }).strict();
export type ExtractedFile = z.infer<typeof extractionSchema>;

export function spanForBytes(bytes: Uint8Array, start: number, end: number): SourceSpan {
  const position = (offset: number): { line: number; column: number } => {
    let line = 1; let lineStart = 0;
    for (let i = 0; i < offset; i++) if (bytes[i] === 10) { line++; lineStart = i + 1; }
    return { line, column: offset - lineStart };
  };
  const from = position(start); const to = position(end);
  return { contentHash: sha256(bytes), startByte: start, endByte: end, startLine: from.line, startColumn: from.column, endLine: to.line, endColumn: to.column };
}
export function validateExtraction(input: unknown, bytes: Uint8Array, path: string, language: Language): ExtractedFile {
  const result = extractionSchema.parse(input);
  if (result.path !== path || result.language !== language || result.contentHash !== sha256(bytes)) throw new Error('Parser result source identity mismatch');
  const keys = new Set(result.symbols.map((symbol) => symbol.key));
  if (keys.size !== result.symbols.length || !keys.has('$file') || !keys.has('$module')) throw new Error('Invalid parser symbol keys');
  const file = result.symbols.find((symbol) => symbol.key === '$file')!;
  const module = result.symbols.find((symbol) => symbol.key === '$module')!;
  if (file.kind !== 'file' || file.parent !== null || module.kind !== 'module' || module.parent !== '$file' ||
    result.symbols.some((symbol) => symbol.key !== '$file' && symbol.parent === null)) throw new Error('Invalid parser roots');
  const identities = result.symbols.map((symbol) => contentHash({ kind: symbol.kind, name: symbol.qualifiedName, discriminator: symbol.discriminator }));
  if (new Set(identities).size !== identities.length) throw new Error('Duplicate logical parser symbols');
  for (const symbol of result.symbols) if (symbol.parent && !keys.has(symbol.parent)) throw new Error('Missing parser parent');
  for (const symbol of result.symbols) {
    const ancestors = new Set([symbol.key]); let parent = symbol.parent;
    while (parent) { if (ancestors.has(parent)) throw new Error('Cyclic parser parents'); ancestors.add(parent); parent = result.symbols.find((item) => item.key === parent)!.parent; }
  }
  for (const item of [...result.imports, ...result.relationships]) {
    if ('key' in item && !keys.has(item.key)) throw new Error('Missing import symbol');
    if ('sourceKey' in item && (!keys.has(item.sourceKey) || !keys.has(item.scopeKey))) throw new Error('Missing relationship scope');
  }
  const facts = [...result.symbols, ...result.imports, ...result.relationships, ...result.diagnostics];
  for (const { span } of facts) if (span) {
    if (span.startByte > span.endByte || span.endByte > bytes.length || contentHash(span) !== contentHash(spanForBytes(bytes, span.startByte, span.endByte))) throw new Error('Invalid parser evidence span');
  }
  return result;
}

export interface ParserAdapter {
  readonly language: Language;
  readonly parserId: string;
  readonly parserVersion: string;
  parse(bytes: Uint8Array, path: string): ExtractedFile;
}
export interface ParserRegistry {
  get(language: Language, parserId?: string, parserVersion?: string): ParserAdapter;
}

export const metricsSchema = z.object({ files_scanned: integer, files_parsed: integer, files_reused: integer,
  bytes_read: integer, symbols_extracted: integer, edges_extracted: integer, duration_ms: z.number().finite().nonnegative() }).strict();
export type IndexMetrics = z.infer<typeof metricsSchema>;
export const observationSchema = z.object({ index_run_id: z.string().uuid(), path: pathSchema, language: z.enum(languages),
  content_hash: hashSchema, byte_length: integer, parser_id: z.string().min(1), parser_version: z.string().min(1), observed_at: timestampSchema,
  git: z.object({ commit_sha: z.string().regex(/^[a-f0-9]{40,64}$/).nullable(), branch: z.string().nullable(), is_dirty: z.boolean() }).strict().optional() }).strict();
export type FileObservation = z.infer<typeof observationSchema> & { event_id: string; sequence: number };
const finish = z.object({ index_run_id: z.string().uuid(), completed_at: timestampSchema,
  files_seen: integer, files_changed: integer, files_unchanged: integer, files_deleted: integer, parse_errors: integer,
  errors: z.array(z.object({ path: z.string(), message: z.string() }).strict()), metrics: metricsSchema }).strict();
export const codePayloadSchemas = {
  'code.index.started': z.object({ index_run_id: z.string().uuid(), root_path: z.string().min(1), started_at: timestampSchema }).strict(),
  'code.file.observed': observationSchema,
  'code.file.deleted': z.object({ index_run_id: z.string().uuid(), path: pathSchema, previous_content_hash: hashSchema, observed_at: timestampSchema }).strict(),
  'code.index.completed': finish,
  'code.index.failed': finish,
};
for (const type of Object.keys(codePayloadSchemas) as CodeEventType[]) registerExtensionEventSchema(type, codePayloadSchemas[type]);
export interface IndexRun extends Omit<z.infer<typeof finish>, 'completed_at'> {
  completed_at: string | null;
  project_id: string; root_path: string; started_at: string; started_sequence: number; status: 'running' | 'completed' | 'failed';
}
export type EdgeType = 'CONTAINS' | 'DEFINES' | 'IMPORTS' | 'EXPORTS' | 'CALLS' | 'REFERENCES' | 'EXTENDS' | 'IMPLEMENTS';
export interface CodeSymbol extends ExtractedSymbol {
  logical_symbol_id: string; symbol_version_id: string; project_id: string; file_id: string; path: string; language: Language; observation_event_id: string;
}
export interface CodeEdge {
  id: string; project_id: string; source_id: string; target_id: string; edge_type: EdgeType; span: SourceSpan;
  resolution_type: 'SYNTACTIC' | 'LEXICAL' | 'LOCAL_IMPORT' | 'RECEIVER'; classification: 'EXTRACTED' | 'RESOLVED'; observation_event_id: string;
}
export interface CodeFile { id: string; observation: FileObservation; extraction: ExtractedFile }
export interface CodeImport extends ExtractedImport { id: string; file_id: string; path: string; target_file_id: string | null; observation_event_id: string }
export interface CodeGraph { files: CodeFile[]; symbols: CodeSymbol[]; edges: CodeEdge[]; imports: CodeImport[]; diagnostics: Diagnostic[] }
export const emptyGraph = (): CodeGraph => ({ files: [], symbols: [], edges: [], imports: [], diagnostics: [] });
export function logicalSymbolId(projectId: string, file: ExtractedFile, symbol: ExtractedSymbol): string {
  return contentHash({ domain: 'graphit:symbol:v1', projectId, path: file.path, language: file.language,
    kind: symbol.kind, qualifiedName: symbol.qualifiedName, discriminator: symbol.discriminator });
}

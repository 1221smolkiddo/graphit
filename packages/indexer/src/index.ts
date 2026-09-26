import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { sha256 } from '@graphit/core';
import { EventStore } from '@graphit/storage';
import { CodeGraphService, assembleGraph, logicalSymbolId, replayCodeHistory, validateExtraction,
  type CodeFile, type ExtractedFile, type FileObservation, type IndexMetrics, type IndexRun, type ParserRegistry } from '@graphit/codegraph';
import { readRepositoryFile, scanRepository } from './scan.js';
export * from './scan.js';
export * from './parser.js';

export interface IndexOptions { rebuild?: boolean; ignoreNames?: readonly string[] }
const zeroMetrics = (): IndexMetrics => ({ files_scanned: 0, files_parsed: 0, files_reused: 0, bytes_read: 0, symbols_extracted: 0, edges_extracted: 0, duration_ms: 0 });
function gitMetadata(root: string): FileObservation['git'] {
  const git = (...args: string[]): string => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  try {
    git('rev-parse', '--show-toplevel');
    let commit_sha: string | null = null;
    try { commit_sha = git('rev-parse', 'HEAD'); } catch { /* An unborn repository has no commit. */ }
    let branch: string | null = null;
    try { branch = git('symbolic-ref', '--short', '-q', 'HEAD') || null; } catch { /* Detached HEAD retains commit metadata. */ }
    return { commit_sha, branch, is_dirty: git('status', '--porcelain').length > 0 };
  } catch { return undefined; }
}

export class RepositoryIndexer {
  constructor(readonly store: EventStore, readonly graph: CodeGraphService, readonly parsers: ParserRegistry) { graph.setParserRegistry(parsers); }

  index(projectId: string, rootPath: string, options: IndexOptions = {}): IndexRun {
    const started = performance.now();
    const root = realpathSync(resolve(rootPath));
    if (this.store.findProject(root)?.project?.id !== projectId) throw new Error('Index path must be the project root, not a subtree or another project');
    const canonicalRoot = this.store.getState(projectId).project!.root_path;
    const unfinished = this.graph.getRuns(projectId).find((run) => run.status === 'running');
    if (unfinished) {
      if (!options.rebuild) throw new Error('An unfinished index run exists; --rebuild explicitly recovers it');
      const observations = this.store.readEvents(projectId).filter((event) => event.sequence > unfinished.started_sequence && event.event_type === 'code.file.observed');
      const deletions = this.store.readEvents(projectId).filter((event) => event.sequence > unfinished.started_sequence && event.event_type === 'code.file.deleted');
      this.store.withProjectTransaction(projectId, (tx) => tx.append({ event_type: 'code.index.failed', payload: {
        index_run_id: unfinished.index_run_id, completed_at: new Date().toISOString(), files_seen: observations.length,
        files_changed: observations.length, files_unchanged: 0, files_deleted: deletions.length, parse_errors: 0,
        errors: [{ path: '.', message: 'Unfinished run explicitly recovered by --rebuild' }], metrics: { ...zeroMetrics(), files_scanned: observations.length },
      } }));
    }
    const previous = options.rebuild ? this.graph.rebuildCodeProjection(projectId) : this.graph.getGraph(projectId);
    const index_run_id = randomUUID();
    this.store.withProjectTransaction(projectId, (tx) => tx.append({ event_type: 'code.index.started', payload: {
      index_run_id, root_path: canonicalRoot, started_at: new Date().toISOString(),
    } }));
    const metrics = zeroMetrics(); const errors: { path: string; message: string }[] = [];
    const changed: { bytes: Uint8Array; observation: Omit<FileObservation, 'event_id' | 'sequence'>; extraction?: ExtractedFile }[] = [];
    const deleted: CodeFile[] = [];
    let parseErrors = 0;
    this.graph.clearStaged();
    try {
      const scan = scanRepository(root, options.ignoreNames);
      errors.push(...scan.errors); metrics.files_scanned = scan.files.length;
      const git = gitMetadata(root);
      for (const file of scan.files) {
        try {
          const bytes = readRepositoryFile(root, file); metrics.bytes_read += bytes.byteLength;
          const hash = sha256(bytes); const adapter = this.parsers.get(file.language);
          const old = previous.files.find((item) => item.extraction.path === file.path);
          if (old?.observation.content_hash === hash && old.observation.parser_id === adapter.parserId && old.observation.parser_version === adapter.parserVersion) {
            metrics.files_reused++; continue;
          }
          const observation = { index_run_id, path: file.path, language: file.language, content_hash: hash, byte_length: bytes.length,
            parser_id: adapter.parserId, parser_version: adapter.parserVersion, observed_at: new Date().toISOString(), ...(git ? { git } : {}) };
          const item: typeof changed[number] = { bytes, observation }; changed.push(item);
          metrics.files_parsed++;
          try {
            const extraction = validateExtraction(adapter.parse(bytes, file.path), bytes, file.path, file.language);
            if (extraction.parserId !== adapter.parserId || extraction.parserVersion !== adapter.parserVersion) throw new Error('Parser identity mismatch');
            item.extraction = extraction;
            metrics.symbols_extracted += extraction.symbols.length;
            const diagnostics = extraction.diagnostics.filter((diagnostic) => diagnostic.severity === 'error');
            if (diagnostics.length) { parseErrors++; errors.push(...diagnostics.map((diagnostic) => ({ path: file.path, message: diagnostic.message }))); }
            else this.graph.stageExtraction(extraction);
          } catch (error) { parseErrors++; errors.push({ path: file.path, message: String(error) }); }
        } catch (error) { errors.push({ path: file.path, message: String(error) }); }
      }
      // An incomplete scan cannot establish deletion.
      if (!scan.errors.length) for (const file of previous.files) if (!scan.files.some((item) => item.path === file.extraction.path)) deleted.push(file);
      this.store.withProjectTransaction(projectId, (tx) => {
        const next = new Map(previous.files.map((file) => [file.extraction.path, file]));
        for (const item of changed) {
          tx.putSourceBlob(item.bytes);
          const event = tx.append({ event_type: 'code.file.observed', payload: item.observation });
          if (item.extraction) next.set(item.observation.path, { id: logicalSymbolId(projectId, item.extraction, item.extraction.symbols.find((symbol) => symbol.key === '$file')!),
            observation: { ...item.observation, event_id: event.id, sequence: event.sequence }, extraction: item.extraction });
        }
        for (const file of deleted) {
          tx.append({ event_type: 'code.file.deleted', payload: { index_run_id, path: file.extraction.path,
            previous_content_hash: file.observation.content_hash, observed_at: new Date().toISOString() } });
          next.delete(file.extraction.path);
        }
        if (!errors.length) metrics.edges_extracted = assembleGraph(projectId, [...next.values()], file => this.store.readSourceBlob(file.observation.content_hash).content).edges.length;
        metrics.duration_ms = performance.now() - started;
        tx.append({ event_type: errors.length ? 'code.index.failed' : 'code.index.completed', payload: {
          index_run_id, completed_at: new Date().toISOString(), files_seen: metrics.files_scanned, files_changed: changed.length,
          files_unchanged: metrics.files_reused, files_deleted: deleted.length, parse_errors: parseErrors, errors, metrics: { ...metrics },
        } });
      });
    } catch (error) {
      // Publication rolled back. Retain the bytes we parsed in a failed observation batch.
      const run = replayCodeHistory(this.store.readEvents(projectId)).runs.find((item) => item.index_run_id === index_run_id)!;
      if (run.status === 'running') this.store.withProjectTransaction(projectId, (tx) => {
        for (const item of changed) {
          tx.putSourceBlob(item.bytes);
          tx.append({ event_type: 'code.file.observed', payload: item.observation });
        }
        tx.append({ event_type: 'code.index.failed', payload: {
          index_run_id, completed_at: new Date().toISOString(), files_seen: metrics.files_scanned,
          files_changed: changed.length, files_unchanged: metrics.files_reused, files_deleted: 0,
          parse_errors: parseErrors, errors: [...errors, { path: '.', message: String(error) }],
          metrics: { ...metrics, duration_ms: performance.now() - started },
        } });
      });
    } finally { this.graph.clearStaged(); }
    return this.graph.getRuns(projectId).find((run) => run.index_run_id === index_run_id)!;
  }
}

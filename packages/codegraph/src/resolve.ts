import { posix } from 'node:path';
import { contentHash, sha256 } from '@graphit/core';
import { emptyGraph, logicalSymbolId, type CodeEdge, type CodeFile, type CodeGraph, type CodeSymbol,
  type ExtractedImport, type ExtractedRelationship, type SourceSpan } from './domain.js';

function localModule(file: CodeFile, item: ExtractedImport, files: readonly CodeFile[]): CodeFile | undefined {
  const path = file.extraction.path; const module = item.module;
  let candidates: string[];
  if (file.extraction.language === 'python') {
    const dots = module.match(/^\.+/)?.[0].length ?? 0;
    let base = dots ? posix.dirname(path) : '';
    for (let level = 1; level < dots; level++) base = posix.dirname(base);
    if (dots > posix.dirname(path).split('/').filter((part) => part !== '.').length + 1) return undefined;
    const target = posix.join(base, module.slice(dots).replaceAll('.', '/'));
    candidates = [`${target}.py`, posix.join(target, '__init__.py')];
  } else {
    if (!module.startsWith('.')) return undefined;
    const target = posix.join(posix.dirname(path), module);
    if (target.startsWith('../') || target.startsWith('/')) return undefined;
    const exact = files.find((candidate) => candidate.extraction.path === target);
    if (exact) return exact;
    const stem = /\.(?:mjs|cjs|js|jsx)$/.test(target) ? target.replace(/\.(?:mjs|cjs|js|jsx)$/, '') : target;
    candidates = ['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs'].flatMap((extension) => [stem + extension, posix.join(stem, 'index' + extension)]);
  }
  const matches = files.filter((candidate) => candidates.includes(candidate.extraction.path));
  return matches.length === 1 ? matches[0] : undefined;
}

export function assembleGraph(projectId: string, files: CodeFile[], sourceForFile?: (file: CodeFile) => Uint8Array): CodeGraph {
  const graph = emptyGraph();
  graph.files = [...files].sort((a, b) => a.extraction.path < b.extraction.path ? -1 : a.extraction.path > b.extraction.path ? 1 : 0);
  const symbols = new Map<string, Map<string, CodeSymbol>>();
  for (const file of graph.files) {
    const local = new Map<string, CodeSymbol>();
    for (const item of file.extraction.symbols) {
      const logical_symbol_id = logicalSymbolId(projectId, file.extraction, item);
      const symbol: CodeSymbol = { ...item, logical_symbol_id,
        symbol_version_id: contentHash({ domain: 'graphit:symbol-version:v1', logical_symbol_id, span: item.span,
          parser: file.observation.parser_version }), project_id: projectId, file_id: file.id, path: file.extraction.path,
        language: file.extraction.language, observation_event_id: file.observation.event_id };
      local.set(item.key, symbol); graph.symbols.push(symbol);
    }
    symbols.set(file.id, local); graph.diagnostics.push(...file.extraction.diagnostics);
  }
  const edgeIds = new Set<string>();
  const edge = (file: CodeFile, source: CodeSymbol, target: CodeSymbol, type: CodeEdge['edge_type'], span: SourceSpan,
    resolution: CodeEdge['resolution_type']): void => {
    const item: Omit<CodeEdge, 'id'> = { project_id: projectId, source_id: source.logical_symbol_id, target_id: target.logical_symbol_id,
      edge_type: type, span, resolution_type: resolution, classification: resolution === 'SYNTACTIC' ? 'EXTRACTED' : 'RESOLVED',
      observation_event_id: file.observation.event_id };
    const id = contentHash({ domain: 'graphit:edge:v1', ...item });
    if (!edgeIds.has(id)) { edgeIds.add(id); graph.edges.push({ id, ...item }); }
  };
  const targets = new Map<ExtractedImport, CodeFile | undefined>();
  for (const file of graph.files) {
    const local = symbols.get(file.id)!; const root = local.get('$file')!; const module = local.get('$module')!;
    for (const symbol of local.values()) {
      if (symbol.parent) edge(file, local.get(symbol.parent)!, symbol, 'CONTAINS', symbol.span, 'SYNTACTIC');
      if (!['file', 'module', 'import', 'export', 'parameter'].includes(symbol.kind)) edge(file, root, symbol, 'DEFINES', symbol.span, 'SYNTACTIC');
      if (symbol.exported) edge(file, module, symbol, 'EXPORTS', symbol.span, 'SYNTACTIC');
    }
    for (const item of file.extraction.imports) {
      const target = localModule(file, item, graph.files); targets.set(item, target);
      graph.imports.push({ ...item, id: contentHash({ domain: 'graphit:import:v1', projectId, path: file.extraction.path, item }),
        file_id: file.id, path: file.extraction.path, target_file_id: target?.id ?? null, observation_event_id: file.observation.event_id });
      if (target) edge(file, module, symbols.get(target.id)!.get('$module')!, 'IMPORTS', item.span, 'LOCAL_IMPORT');
      else graph.diagnostics.push({ code: 'UNRESOLVED_IMPORT', message: `External, missing or ambiguous import: ${item.module}`,
        path: file.extraction.path, severity: 'warning', span: item.span });
    }
  }
  function localBindings(file: CodeFile, name: string, scope: string): CodeSymbol[] {
    const local = symbols.get(file.id)!;
    let current: string | null = scope;
    while (current) {
      if (current !== '$module') {
        const shadow = file.extraction.imports.find((entry) => local.get(entry.key)?.parent === current && entry.bindings.some((binding) => binding.local === name));
        if (shadow) return [local.get(shadow.key)!];
      }
      // Class members are not lexical bindings inside methods (bare f() is not this.f()).
      const bindings = local.get(current)?.kind === 'class' ? [] : [...local.values()].filter((symbol) => symbol.name === name && symbol.parent === current && symbol.kind !== 'export' && symbol.kind !== 'import');
      if (bindings.length) return bindings;
      current = local.get(current)?.parent ?? null;
    }
    return [];
  }
  function exportedTargets(file: CodeFile, name: string, visited = new Set<string>()): CodeSymbol[] {
    const identity = file.id + ':' + name;
    if (visited.has(identity) || visited.size >= 64) return [];
    const next = new Set(visited).add(identity);
    const local = symbols.get(file.id)!;
    if (file.extraction.relationships.some((item) => item.unsafe && item.targetName === name)) return [];
    const direct = [...local.values()].filter((symbol) => symbol.parent === '$module' && symbol.exported && symbol.name === name);
    const aliases = [...local.values()].filter((symbol) => symbol.kind === 'export' && symbol.name === name);
    // Multiple declarations of the export name are invalid/ambiguous, even if
    // two paths might eventually point at the same symbol.
    if (direct.length + aliases.length > 1) return [];
    for (const alias of aliases) for (const relation of file.extraction.relationships.filter((item) => item.kind === 'EXPORTS' && item.span.startByte >= alias.span.startByte && item.span.endByte <= alias.span.endByte)) {
      if (relation.unsafe || relation.receiver) return [];
      direct.push(...moduleBinding(file, relation.targetName, next, alias));
    }
    return [...new Map(direct.map((symbol) => [symbol.logical_symbol_id, symbol])).values()];
  }
  const sourceText = new Map<string, string>();
  function valueExport(file: CodeFile, alias: CodeSymbol): boolean {
    // The v1 IR does not distinguish type-only exports. Consult immutable source
    // for the new forwarding case; missing evidence must never imply a value.
    if (!sourceForFile) return false;
    let text = sourceText.get(file.id);
    if (text === undefined) {
      const bytes = sourceForFile(file);
      if (sha256(bytes) !== file.extraction.contentHash) throw new Error('Resolver source identity mismatch');
      text = Buffer.from(bytes).toString('utf8'); sourceText.set(file.id, text);
    }
    for (const match of text.matchAll(/\bexport\s*\{[^{};]*\}\s*(?:;|(?=\r?\n|$))/g)) {
      const start = Buffer.byteLength(text.slice(0, match.index));
      const end = start + Buffer.byteLength(match[0]);
      if (start <= alias.span.startByte && end >= alias.span.endByte && !/\btype\b/.test(match[0])) return true;
    }
    return false;
  }
  function moduleBinding(file: CodeFile, name: string, visited: Set<string>, alias: CodeSymbol): CodeSymbol[] {
    if (file.extraction.relationships.some(item => item.unsafe && item.targetName === name)) return [];
    const bindings = localBindings(file, name, '$module');
    const imported = file.extraction.imports.flatMap(entry => entry.bindings
      .filter(binding => binding.local === name && symbols.get(file.id)!.get(entry.key)?.parent === '$module')
      .map(binding => ({ entry, binding })));
    if (bindings.length) return imported.length ? [] : bindings;
    if (imported.length !== 1) return [];
    const { entry, binding } = imported[0]!;
    if (/\btype\b/.test(symbols.get(file.id)!.get(entry.key)!.name) || !valueExport(file, alias)) return [];
    const target = targets.get(entry);
    // Namespace-object forwarding requires additional semantics. Never guess.
    return target && binding.imported !== '*' ? exportedTargets(target, binding.imported, visited) : [];
  }
  function resolve(file: CodeFile, item: ExtractedRelationship): { target?: CodeSymbol; resolution: CodeEdge['resolution_type'] } {
    if (item.unsafe) return { resolution: 'LEXICAL' };
    const local = symbols.get(file.id)!;
    if (item.receiver && ['this', 'self', 'cls'].includes(item.receiver)) {
      const owner = local.get(item.scopeKey);
      const scope = owner?.kind === 'method' && owner.parent ? local.get(owner.parent) : undefined;
      const receiverIsBound = file.extraction.language !== 'python' ? item.receiver === 'this' :
        [...local.values()].filter((symbol) => symbol.parent === owner?.key && symbol.kind === 'parameter')[0]?.name === item.receiver;
      if (!receiverIsBound || scope?.kind !== 'class') return { resolution: 'RECEIVER' };
      const methods = scope ? [...local.values()].filter((symbol) => symbol.parent === scope.key && symbol.name === item.targetName && symbol.kind === 'method') : [];
      return methods.length === 1 ? { target: methods[0]!, resolution: 'RECEIVER' } : { resolution: 'RECEIVER' };
    }
    const name = item.receiver ?? item.targetName;
    const bindings = localBindings(file, name, item.scopeKey);
    if (bindings.length) {
      if (item.receiver || bindings.length !== 1) return { resolution: 'LEXICAL' };
      return { target: bindings[0]!, resolution: 'LEXICAL' };
    }
    const imported = file.extraction.imports.flatMap((entry) => entry.bindings.filter((binding) => binding.local === name)
      .map((binding) => ({ entry, binding })));
    if (imported.length !== 1) return { resolution: 'LOCAL_IMPORT' };
    const { entry, binding } = imported[0]!;
    // Imports in nested function scopes are not promoted to module-wide bindings.
    if (local.get(entry.key)?.parent !== '$module') return { resolution: 'LOCAL_IMPORT' };
    const targetFile = targets.get(entry);
    if (!targetFile || (!!item.receiver !== (binding.imported === '*'))) return { resolution: 'LOCAL_IMPORT' };
    const found = exportedTargets(targetFile, item.receiver ? item.targetName : binding.imported);
    return found.length === 1 ? { target: found[0]!, resolution: 'LOCAL_IMPORT' } : { resolution: 'LOCAL_IMPORT' };
  }
  for (const file of graph.files) for (const item of file.extraction.relationships) {
    const found = resolve(file, item);
    const suitable = found.target && (item.kind !== 'CALLS' || ['function', 'method'].includes(found.target.kind)) &&
      (!['EXTENDS', 'IMPLEMENTS'].includes(item.kind) || ['class', 'interface'].includes(found.target.kind));
    if (suitable) edge(file, symbols.get(file.id)!.get(item.sourceKey)!, found.target!, item.kind, item.span, found.resolution);
    else graph.diagnostics.push({ code: `UNRESOLVED_${item.kind}`, message: `Unresolved or ambiguous ${item.receiver ? item.receiver + '.' : ''}${item.targetName}`,
      path: file.extraction.path, severity: 'warning', span: item.span });
  }
  graph.symbols.sort((a, b) => a.logical_symbol_id.localeCompare(b.logical_symbol_id, 'en'));
  graph.edges.sort((a, b) => a.id.localeCompare(b.id, 'en'));
  graph.imports.sort((a, b) => a.id.localeCompare(b.id, 'en'));
  return graph;
}

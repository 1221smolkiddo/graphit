import type { CodeGraph, Diagnostic } from './domain.js';

export const unresolvedCategories = ['external_package', 'dynamic_call', 'ambiguous_local_symbol',
  'namespace_member_ambiguity', 'unsupported_syntax_pattern', 're_export_resolution', 'aliasing',
  'parser_limitation', 'missing_local_module'] as const;
export type UnresolvedCategory = typeof unresolvedCategories[number];

/** A derived diagnostic audit, not canonical events and never a source of resolved edges.
 * Categories explain available syntactic evidence, not inferred runtime behavior. */
export function auditUnresolved(graph: CodeGraph) {
  const counts = Object.fromEntries(unresolvedCategories.map(category => [category, 0])) as Record<UnresolvedCategory, number>;
  const files = new Map(graph.files.map(file => [file.extraction.path, file]));
  const categorize = (diagnostic: Diagnostic): UnresolvedCategory => {
    const file = files.get(diagnostic.path);
    if (!file) return 'parser_limitation';
    if (diagnostic.code === 'UNRESOLVED_EXPORT') return 're_export_resolution';
    if (diagnostic.code === 'UNSUPPORTED_SCOPE' || diagnostic.code.startsWith('UNSUPPORTED_')) return 'unsupported_syntax_pattern';
    const sameSpan = (span: { startByte: number; endByte: number }) => span.startByte === diagnostic.span?.startByte && span.endByte === diagnostic.span.endByte;
    const relation = file.extraction.relationships.find(item => sameSpan(item.span));
    const name = relation?.receiver ?? relation?.targetName;
    const imports = file.extraction.imports.filter(item => sameSpan(item.span) || item.bindings.some(binding => binding.local === name));
    if (imports.some(item => item.module.startsWith('#'))) return 'aliasing';
    if (file.extraction.language !== 'python' && imports.some(item => !item.module.startsWith('.'))) return 'external_package';
    if (diagnostic.code === 'UNRESOLVED_IMPORT') return 'missing_local_module';
    if (relation?.unsafe) return 'dynamic_call';
    for (const item of imports) {
      const targetId = graph.imports.find(entry => entry.path === diagnostic.path && entry.key === item.key)?.target_file_id;
      const binding = item.bindings.find(binding => binding.local === name);
      const targetName = relation?.receiver ? relation.targetName : binding?.imported;
      if (targetId && graph.symbols.filter(symbol => symbol.file_id === targetId && symbol.parent === '$module' && symbol.exported && symbol.name === targetName).length > 1) return 'ambiguous_local_symbol';
    }
    if (imports.some(item => graph.imports.some(entry => entry.path === diagnostic.path && entry.key === item.key && entry.target_file_id !== null))) {
      return relation?.receiver ? 'namespace_member_ambiguity' : 're_export_resolution';
    }
    if (relation?.receiver) return 'namespace_member_ambiguity';
    if (name && file.extraction.symbols.filter(symbol => symbol.name === name && symbol.kind !== 'export').length > 1) return 'ambiguous_local_symbol';
    return relation?.kind === 'CALLS' ? 'dynamic_call' : 'parser_limitation';
  };
  const diagnostics = graph.diagnostics.filter(item => /^(UNRESOLVED_|UNSUPPORTED_|SYNTAX_ERROR)/.test(item.code))
    .map(item => { const category = categorize(item); counts[category]++; return { ...item, category }; });
  return { total: diagnostics.length, counts, diagnostics };
}

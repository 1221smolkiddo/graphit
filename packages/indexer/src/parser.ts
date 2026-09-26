import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import type { Node, Tree } from '@vscode/tree-sitter-wasm';
import { sha256 } from '@graphit/core';
import { languages, spanForBytes, validateExtraction, type ExtractedFile, type ExtractedSymbol,
  type Language, type ParserAdapter, type ParserRegistry, type SourceSpan } from '@graphit/codegraph';

const require = createRequire(import.meta.url);
const runtime = require('@vscode/tree-sitter-wasm') as typeof import('@vscode/tree-sitter-wasm');
const wasmDirectory = dirname(require.resolve('@vscode/tree-sitter-wasm'));
let initialization: Promise<void> | undefined;
const grammarName = (language: Language): string => language === 'jsx' ? 'javascript' : language;
const children = (node: Node): Node[] => node.namedChildren.filter((child): child is Node => child !== null);
const field = (node: Node, name: string): Node | null => node.childForFieldName(name);
const identifiers = new Set(['identifier', 'type_identifier', 'shorthand_property_identifier_pattern']);
const functions = new Set(['function_declaration', 'function_signature', 'function_definition', 'function_expression', 'generator_function_declaration', 'generator_function', 'arrow_function']);

/** Tree-sitter's JS binding indexes UTF-16 strings. Persisted spans are UTF-8 bytes. */
function byteMap(text: string): number[] {
  const map: number[] = []; let index = 0; let bytes = 0;
  for (const character of text) {
    map[index] = bytes;
    if (character.length === 2) map[index + 1] = bytes;
    index += character.length; bytes += Buffer.byteLength(character);
  }
  map[index] = bytes;
  return map;
}

function extract(tree: Tree, text: string, bytes: Uint8Array, path: string, adapter: ParserAdapter): ExtractedFile {
  const map = byteMap(text);
  const hash = sha256(bytes);
  const span = (node: Node): SourceSpan => spanForBytes(bytes, map[node.startIndex]!, map[node.endIndex]!);
  const full = spanForBytes(bytes, 0, bytes.length);
  const result: ExtractedFile = { path, language: adapter.language, contentHash: hash, parserId: adapter.parserId,
    parserVersion: adapter.parserVersion, symbols: [], imports: [], relationships: [], diagnostics: [] };
  const byKey = new Map<string, ExtractedSymbol>();
  const python = adapter.language === 'python';
  const unsupportedScopes = new Set<string>();
  const add = (kind: ExtractedSymbol['kind'], name: string, node: Node, parent: string | null, exported = false, signature: string | null = null): string => {
    const key = kind === 'file' ? '$file' : kind === 'module' ? '$module' : `s${result.symbols.length}`;
    const prefix = parent && parent !== '$module' && parent !== '$file' ? byKey.get(parent)!.qualifiedName + '.' : '';
    const symbol: ExtractedSymbol = { key, kind, name, qualifiedName: prefix + name, discriminator: '', signature, parent, exported, span: span(node) };
    if (kind === 'file' || kind === 'module') symbol.span = full;
    result.symbols.push(symbol); byKey.set(key, symbol); return key;
  };
  add('file', path, tree.rootNode, null);
  add('module', path, tree.rootNode, '$file');
  const diagnose = (code: string, message: string, node: Node, severity: 'warning' | 'error' = 'warning'): void => {
    result.diagnostics.push({ code, message, path, severity, span: span(node) });
  };
  const signature = (node: Node): string => text.slice(node.startIndex, field(node, 'body')?.startIndex ?? node.endIndex).replace(/\s+/g, ' ').trim();
  const bindingNames = (node: Node): Node[] => {
    if (identifiers.has(node.type)) return [node];
    if (node.type.includes('type') && node.type !== 'typed_parameter' && node.type !== 'typed_default_parameter') return [];
    const named = field(node, 'pattern') ?? field(node, 'name');
    if (named) return bindingNames(named);
    return children(node).filter((child) => child.id !== field(node, 'type')?.id && child.id !== field(node, 'value')?.id).flatMap(bindingNames);
  };
  const params = (node: Node, scope: string): void => {
    const parameters = field(node, 'parameters') ?? field(node, 'parameter');
    if (!parameters) return;
    const items = identifiers.has(parameters.type) ? [parameters] : children(parameters);
    for (const parameter of items) for (const name of bindingNames(parameter)) add('parameter', name.text, name, scope);
  };
  const relation = (kind: 'CALLS' | 'REFERENCES' | 'EXTENDS' | 'IMPLEMENTS' | 'EXPORTS', target: Node, owner: string, scope: string, unsafe = false): void => {
    const property = field(target, 'property') ?? field(target, 'attribute');
    const object = field(target, 'object');
    const simple = identifiers.has(target.type);
    result.relationships.push({ kind, sourceKey: owner, scopeKey: scope,
      targetName: property?.text ?? target.text, receiver: object?.text ?? null,
      unsafe: unsafe || (!simple && !(property && object && /^(this|self|cls|[A-Za-z_$][\w$]*)$/.test(object.text))), span: span(target) });
  };
  function imports(node: Node, scope: string): void {
    const key = add('import', node.text.replace(/\s+/g, ' '), node, scope);
    if (!python) {
      const source = field(node, 'source');
      if (!source) { diagnose('UNSUPPORTED_IMPORT', 'Import form is not statically supported', node); return; }
      const module = source.text.slice(1, -1);
      const clause = children(node).find((child) => child.type === 'import_clause');
      if (!clause) { result.imports.push({ key, module, bindings: [], style: 'side_effect', span: span(node) }); return; }
      const bindings: { imported: string; local: string }[] = [];
      let style: 'named' | 'namespace' | 'default' = 'named';
      for (const child of children(clause)) {
        if (child.type === 'identifier') { bindings.push({ imported: 'default', local: child.text }); style = 'default'; }
        if (child.type === 'namespace_import') { bindings.push({ imported: '*', local: children(child).at(-1)!.text }); style = 'namespace'; }
        if (child.type === 'named_imports') for (const specifier of children(child)) {
          const name = field(specifier, 'name'); const alias = field(specifier, 'alias');
          if (name) bindings.push({ imported: name.text, local: alias?.text ?? name.text });
        }
      }
      result.imports.push({ key, module, bindings, style, span: span(node) });
    } else {
      const moduleNode = field(node, 'module_name');
      const items = children(node).filter((child) => child.id !== moduleNode?.id);
      const names = items.map((item) => ({ imported: field(item, 'name')?.text ?? item.text, local: field(item, 'alias')?.text ?? field(item, 'name')?.text ?? item.text }));
      if (node.type === 'import_from_statement') {
        result.imports.push({ key, module: moduleNode?.text ?? '', bindings: names, style: 'named', span: span(node) });
      } else for (const item of names) {
        result.imports.push({ key, module: item.imported, bindings: [{ imported: '*', local: item.local }], style: 'python_module', span: span(node) });
      }
    }
  }
  function walk(node: Node, scope: string, exported = false): void {
    if (node.type === 'ERROR' || node.isMissing) diagnose('SYNTAX_ERROR', node.isMissing ? `Missing ${node.type}` : 'Tree-sitter syntax error', node, 'error');
    // P2 has declaration scopes, not a complete block/comprehension binding model.
    // Retain evidence, but do not resolve lexical relationships across these boundaries.
    const nestedBlock = ['statement_block', 'block'].includes(node.type) && node.parent &&
      !functions.has(node.parent.type) && !['method_definition', 'class_definition'].includes(node.parent.type);
    if (nestedBlock || ['catch_clause', 'for_in_statement', 'for_statement', 'with_statement', 'lambda',
      'list_comprehension', 'dictionary_comprehension', 'set_comprehension', 'generator_expression', 'global_statement', 'nonlocal_statement'].includes(node.type)) {
      unsupportedScopes.add(scope);
      diagnose('UNSUPPORTED_SCOPE', 'Complex binding scope retained without definitive lexical resolution', node);
    }
    if (node.type === 'import_statement' || node.type === 'import_from_statement') { imports(node, scope); return; }
    if (node.type === 'export_statement') {
      const declaration = field(node, 'declaration');
      if (declaration) { walk(declaration, scope, true); return; }
      const clause = children(node).find((child) => child.type === 'export_clause');
      if (clause && !field(node, 'source')) for (const specifier of children(clause)) {
        const name = field(specifier, 'name');
        if (name) { add('export', field(specifier, 'alias')?.text ?? name.text, specifier, scope); relation('EXPORTS', name, '$module', scope); }
      } else diagnose('UNRESOLVED_EXPORT', 'Re-export/default expression needs additional module semantics', node);
      return;
    }
    if (['class_declaration', 'abstract_class_declaration', 'class_definition', 'interface_declaration', 'type_alias_declaration'].includes(node.type)) {
      const name = field(node, 'name');
      if (!name) return;
      const kind = node.type === 'interface_declaration' ? 'interface' : node.type === 'type_alias_declaration' ? 'type' : 'class';
      const key = add(kind, name.text, node, scope, exported || (python && scope === '$module'), signature(node));
      const bases = field(node, 'superclasses');
      if (bases) for (const base of children(bases)) relation('EXTENDS', base, key, scope);
      for (const heritage of children(node).filter((child) => child.type === 'class_heritage' || child.type === 'extends_type_clause')) {
        for (const clause of children(heritage)) {
          if (heritage.type === 'extends_type_clause') relation('EXTENDS', clause, key, scope);
          else for (const base of children(clause)) relation(clause.type === 'implements_clause' ? 'IMPLEMENTS' : 'EXTENDS', base, key, scope);
        }
      }
      const body = field(node, 'body'); if (body) walk(body, key);
      return;
    }
    if (functions.has(node.type) || node.type === 'method_definition' || node.type === 'method_signature') {
      const name = field(node, 'name');
      const method = node.type.startsWith('method_') || (python && byKey.get(scope)?.kind === 'class');
      const key = add(method ? 'method' : 'function', name?.text ?? '<anonymous>', node, scope,
        exported || (python && scope === '$module'), signature(node));
      params(node, key);
      const body = field(node, 'body'); if (body) walk(body, key);
      return;
    }
    if (node.type === 'variable_declarator' || (python && node.type === 'assignment')) {
      const name = field(node, python ? 'left' : 'name');
      const value = field(node, python ? 'right' : 'value');
      if (name) {
        if (value && functions.has(value.type) && identifiers.has(name.type)) {
          const key = add('function', name.text, node, scope, exported || (python && scope === '$module'), signature(value));
          params(value, key); const body = field(value, 'body'); if (body) walk(body, key); return;
        }
        for (const binding of bindingNames(name)) add(node.parent?.text.trimStart().startsWith('const ') || (python && /^[A-Z_][A-Z0-9_]*$/.test(binding.text)) ? 'constant' : 'variable',
          binding.text, node, scope, exported || (python && scope === '$module'));
      }
      if (value) walk(value, scope);
      return;
    }
    if (node.type === 'required_parameter' || node.type === 'optional_parameter') return;
    if (node.type === 'call_expression' || node.type === 'call') {
      const target = field(node, 'function'); if (target) relation('CALLS', target, scope, scope);
      const args = field(node, 'arguments'); if (args) walk(args, scope);
      return;
    }
    if (node.type === 'assignment_expression' || node.type === 'augmented_assignment' || node.type === 'update_expression') {
      const target = field(node, 'left') ?? field(node, 'argument');
      if (target) {
        diagnose('REBINDING', `Assignment to ${target.text} makes callable resolution unsafe in this scope`, target);
        result.relationships.push({ kind: 'REFERENCES', sourceKey: scope, scopeKey: scope, targetName: target.text, receiver: null, unsafe: true, span: span(target) });
      }
      const value = field(node, 'right'); if (value) walk(value, scope); return;
    }
    if (node.type === 'member_expression' || node.type === 'attribute') { relation('REFERENCES', node, scope, scope); return; }
    if (node.type === 'identifier' || node.type === 'shorthand_property_identifier') {
      if (!['pair', 'labeled_statement', 'break_statement'].includes(node.parent?.type ?? '')) relation('REFERENCES', node, scope, scope);
      return;
    }
    for (const child of children(node)) walk(child, scope, exported);
  }
  for (const child of children(tree.rootNode)) walk(child, '$module');
  if (tree.rootNode.hasError && !result.diagnostics.some((diagnostic) => diagnostic.severity === 'error')) diagnose('SYNTAX_ERROR', 'Tree contains a syntax error', tree.rootNode, 'error');
  // Repeated qualified names use signatures, then occurrence order only for identical declarations.
  const groups = new Map<string, ExtractedSymbol[]>();
  for (const symbol of result.symbols) {
    const group = `${symbol.kind}:${symbol.qualifiedName}`; const items = groups.get(group) ?? []; items.push(symbol); groups.set(group, items);
  }
  for (const symbols of groups.values()) if (symbols.length > 1) {
    const counts = new Map<string, number>();
    for (const symbol of symbols) {
      const digest = sha256(symbol.signature ?? symbol.name); const ordinal = counts.get(digest) ?? 0;
      symbol.discriminator = `${digest}:${ordinal}`; counts.set(digest, ordinal + 1);
    }
  }
  // A lexical reassignment conservatively blocks definitive call/reference targets in that scope.
  const writes = result.relationships.filter((item) => item.unsafe).map((item) => item.targetName);
  for (const item of result.relationships) {
    if (writes.includes(`${item.receiver ? item.receiver + '.' : ''}${item.targetName}`) || (item.receiver && writes.includes(item.receiver))) item.unsafe = true;
    let scope: string | null = item.scopeKey;
    while (scope) { if (unsupportedScopes.has(scope)) item.unsafe = true; scope = byKey.get(scope)?.parent ?? null; }
  }
  return validateExtraction(result, bytes, path, adapter.language);
}

export async function createParserRegistry(): Promise<ParserRegistry> {
  initialization ??= runtime.Parser.init(); await initialization;
  const adapters = new Map<Language, ParserAdapter>();
  const runtimeHash = sha256(readFileSync(join(wasmDirectory, 'tree-sitter.wasm')));
  for (const language of languages) {
    const grammarBytes = readFileSync(join(wasmDirectory, `tree-sitter-${grammarName(language)}.wasm`));
    const grammar = await runtime.Language.load(grammarBytes);
    const adapter: ParserAdapter = {
      language, parserId: `graphit/tree-sitter/${language}`,
      parserVersion: `extractor-1;runtime-${runtimeHash};grammar-${sha256(grammarBytes)}`,
      parse(bytes, path): ExtractedFile {
        const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
        const parser = new runtime.Parser(); parser.setLanguage(grammar);
        let tree: Tree | null = null;
        try { tree = parser.parse(text); if (!tree) throw new Error('Tree-sitter returned no tree'); return extract(tree, text, bytes, path, adapter); }
        finally { tree?.delete(); parser.delete(); }
      },
    };
    adapters.set(language, adapter);
  }
  return { get(language, id, version) {
    const adapter = adapters.get(language);
    if (!adapter || (id !== undefined && id !== adapter.parserId) || (version !== undefined && version !== adapter.parserVersion)) throw new Error('Recorded parser version is unavailable');
    return adapter;
  } };
}

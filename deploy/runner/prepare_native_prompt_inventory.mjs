// Operator-only static preparation. No native code or candidate expression is executed.
// Catalog rows are candidates; only complete parsed literal matches become anchors.
import fs from 'node:fs';
import crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';

const [sourcePath, layoutPath, catalogPath, parserPath, outputPath, version, parserSha, catalogSha] = process.argv.slice(2);
if (!catalogSha || process.argv.length !== 10) throw new Error('Expected source, layout, catalog, parser, output, version and exact parser/catalog SHA256 arguments');
const digest = body => crypto.createHash('sha256').update(body).digest('hex');
const parserBytes = fs.readFileSync(parserPath), catalogBytes = fs.readFileSync(catalogPath);
if (digest(parserBytes) !== parserSha || digest(catalogBytes) !== catalogSha) throw new Error('Preparation dependency digest mismatch');
const {parse} = await import(pathToFileURL(parserPath));
const source = fs.readFileSync(sourcePath), layout = JSON.parse(fs.readFileSync(layoutPath, 'utf8'));
const catalog = JSON.parse(catalogBytes.toString('utf8'));
if (catalog.version !== version || !Array.isArray(catalog.prompts)) throw new Error('Catalog version/root mismatch');
const rows = catalog.prompts.filter(row => /^(system-prompt-|system-reminder-|tool-description-)/.test(row.id || '') && !row.asset);
const unique = new Map();
for (const row of rows) {
  const key = JSON.stringify([row.id, row.name, row.pieces, row.identifiers, row.identifierMap]);
  if (!unique.has(key)) unique.set(key, row);
}
const versionPiece = piece => piece.replaceAll('<<CCVERSION>>', version);
const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function pattern(piece) {
  let out = '';
  for (const char of versionPiece(piece)) {
    if (char === '\n') out += '(?:\n|\\\\n)';
    else if (char.codePointAt(0) > 127) {
      const units = [...char].join('');
      let escaped = '';
      for (let i=0; i<units.length; i++) escaped += '\\\\u' + units.charCodeAt(i).toString(16).padStart(4, '0');
      const hex = char.codePointAt(0) <= 255 ? '|\\\\x' + char.codePointAt(0).toString(16).padStart(2, '0') : '';
      out += '(?:' + escape(char) + '|' + escaped + hex + ')';
    } else out += escape(char);
  }
  return out;
}
const statics = new Map(), templates = [];
for (const row of unique.values()) {
  if (!Array.isArray(row.pieces) || !row.pieces.length || !row.pieces.every(p => typeof p === 'string')) continue;
  if (row.pieces.some(piece => piece.includes('<<BUILD_TIME>>'))) continue; // No inferred build timestamp.
  if (row.pieces.length === 1 && (!row.identifiers || row.identifiers.length === 0)) {
    const text = versionPiece(row.pieces[0]);
    if (!statics.has(text)) statics.set(text, []);
    statics.get(text).push(row);
  }
  templates.push({row, regex: new RegExp('^(?:' + row.pieces.map(pattern).join('([\\w$]+)') + ')$', 'u')});
}
const matched = [], failures = [], skipped = {invalid_unicode: 0};
let parsedModules = 0, literals = 0;
const comparisonOperators = new Set(['==', '===', '!=', '!==', '<', '<=', '>', '>=', 'in', 'instanceof']);
const membershipMethods = new Set(['includes', 'startsWith', 'endsWith', 'indexOf', 'lastIndexOf', 'search',
  'match', 'matchAll', 'test', 'exec', 'split', 'replace', 'replaceAll', 'get', 'set', 'has', 'delete', 'on', 'off',
  'once', 'emit', 'addEventListener', 'removeEventListener', 'defineProperty', 'defineProperties']);
const schemaMethods = new Set(['literal', 'enum', 'nativeEnum', 'discriminatedUnion', 'keyof']);
const instructionFields = new Set(['description', 'prompt', 'system_prompt', 'systemPrompt', 'promptText',
  'instruction', 'instructions']);
function propertyName(node) {
  return node?.type === 'Identifier' ? node.name : node?.type === 'Literal' && typeof node.value === 'string' ? node.value : null;
}
function contextReasons(node, parent, parents) {
  const reasons = [];
  if (parent?.type === 'TaggedTemplateExpression') reasons.push('tagged-template');
  if (['Property', 'MethodDefinition', 'PropertyDefinition'].includes(parent?.type) && parent.key === node)
    reasons.push('structural-property-key');
  if (parent?.type === 'MemberExpression' && parent.property === node) reasons.push('member-property-key');
  if (/^(Import|Export)/.test(parent?.type || '') && parent.source === node) reasons.push('module-specifier');
  if (parent?.type === 'ImportExpression') reasons.push('module-specifier');
  if (parent?.type === 'ExpressionStatement' && parent.directive) reasons.push('directive');
  if (parent?.type === 'BinaryExpression' && comparisonOperators.has(parent.operator)) reasons.push('comparison-operand');
  if (parent?.type === 'BinaryExpression' && parent.operator !== '+' && !comparisonOperators.has(parent.operator)) reasons.push('nontext-binary-operand');
  if (parent?.type === 'LogicalExpression' || parent?.type === 'UnaryExpression') reasons.push('control-operand');
  if (parent?.type === 'SwitchCase' && parent.test === node) reasons.push('switch-case');
  if (['IfStatement', 'ConditionalExpression', 'WhileStatement', 'DoWhileStatement', 'ForStatement'].includes(parent?.type)
      && parent.test === node) reasons.push('control-condition');
  if (parent?.type === 'Property' && parent.value === node && !instructionFields.has(propertyName(parent.key)))
    reasons.push('ambiguous-object-field');
  if (parent?.type === 'AssignmentExpression' && parent.right === node && parent.left?.type === 'MemberExpression'
      && !instructionFields.has(propertyName(parent.left.property))) reasons.push('ambiguous-assigned-field');
  let ancestor = parent, child = node, flowing = true, hard = true;
  while (ancestor) {
    if (ancestor.type === 'TemplateLiteral') reasons.push('nested-template-expression');
    if (['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(ancestor.type)) {
      flowing = false; hard = false; // Enclosing callback/registration syntax does not consume its body's literal value.
    }
    if (hard && ancestor.type === 'BinaryExpression') reasons.push(ancestor.operator === '+' ? null :
      comparisonOperators.has(ancestor.operator) ? 'comparison-operand' : 'nontext-binary-operand');
    if (hard && ['LogicalExpression', 'UnaryExpression'].includes(ancestor.type)) reasons.push('control-operand');
    if (hard && ancestor.type === 'SwitchCase' && ancestor.test === child) reasons.push('switch-case');
    if (hard && ['IfStatement', 'ConditionalExpression', 'WhileStatement', 'DoWhileStatement', 'ForStatement'].includes(ancestor.type)
        && ancestor.test === child) reasons.push('control-condition');
    if (hard && ['Property', 'MethodDefinition', 'PropertyDefinition'].includes(ancestor.type) && ancestor.key === child)
      reasons.push('structural-property-key');
    if (hard && ancestor.type === 'MemberExpression' && ancestor.property === child) reasons.push('member-property-key');
    if (flowing && ancestor.type === 'Property' && ancestor.value === child) {
      if (instructionFields.has(propertyName(ancestor.key))) flowing = false;
      else reasons.push('ambiguous-object-field');
    }
    if (flowing && ancestor.type === 'AssignmentExpression' && ancestor.right === child && ancestor.left?.type === 'MemberExpression'
        && !instructionFields.has(propertyName(ancestor.left.property))) reasons.push('ambiguous-assigned-field');
    if (hard && ancestor.type === 'NewExpression') reasons.push('constructor-argument');
    if (hard && ancestor.type === 'CallExpression') {
      const method = ancestor.callee?.type === 'MemberExpression' ? propertyName(ancestor.callee.property) : propertyName(ancestor.callee);
      if (membershipMethods.has(method)) reasons.push('membership-or-lookup-call');
      if (schemaMethods.has(method)) reasons.push('schema-literal-or-enum');
      if (['require', 'eval', 'Function', 'RegExp', 'URL', 'fetch'].includes(method)) reasons.push('operational-call-argument');
      // Literals forming the receiver of a membership operation are ambiguous too.
      if (ancestor.callee === child) reasons.push('call-target-or-receiver');
      if (method === 'describe' && ancestor.arguments.includes(child)) flowing = false;
    }
    child = ancestor;
    ancestor = parents.get(ancestor);
  }
  return [...new Set(reasons.filter(Boolean))].sort();
}
function utf8Offsets(code) {
  const offsets = new Uint32Array(code.length + 1);
  let at = 0, bytes = 0;
  for (const char of code) {
    offsets[at] = bytes;
    if (char.length === 2) offsets[at + 1] = bytes;
    at += char.length; bytes += Buffer.byteLength(char);
  }
  offsets[at] = bytes;
  return offsets;
}
for (const module of layout.modules) {
  const bytes = source.subarray(module.start, module.end);
  if (digest(bytes) !== module.source_sha256) throw new Error('Source graph module hash mismatch');
  const code = bytes.toString('utf8');
  let ast;
  try { ast = parse(code, {ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true}); }
  catch (error) { failures.push({index: module.index, source_sha256: module.source_sha256, error: error.name}); continue; }
  parsedModules++;
  const offsets = utf8Offsets(code), parents = new WeakMap(), stack = [{node: ast, parent: null}];
  while (stack.length) {
    const {node, parent} = stack.pop();
    if (!node || typeof node !== 'object') continue;
    const literal = node.type === 'Literal' && typeof node.value === 'string';
    const template = node.type === 'TemplateLiteral';
    if (literal || template) {
      literals++;
      {
        const raw = code.slice(node.start, node.end);
        const segments = literal ? [node.value] : node.quasis.map(q => q.value.cooked);
        const expressions = literal ? [] : node.expressions.map(e => code.slice(e.start, e.end));
        if (segments.every(s => typeof s === 'string') && !segments.some(s => /[\uD800-\uDFFF]/u.test(s))) {
          let candidates = literal ? (statics.get(node.value) || []) : [];
          if (template) candidates = templates.filter(candidate => candidate.regex.test(raw.slice(1, -1))).map(c => c.row);
          if (candidates.length) {
            candidates.sort((a,b) => a.id.localeCompare(b.id));
            const row = candidates[0];
            const baseline = segments.map((s,i) => s + (i < expressions.length ? '${TH_PROMPT_EXPR_' + i + '}' : '')).join('');
            if (Buffer.byteLength(baseline) <= 250000 && expressions.length <= 1000 && !baseline.includes('\0')) {
              const start = module.start + offsets[node.start], end = module.start + offsets[node.end];
              matched.push({catalog_id: row.id, title: String(row.name || row.id).slice(0,500),
                catalog_version: row.version || null, aliases: [...new Set(candidates.map(c => c.id))],
                baseline_utf8: baseline, baseline_sha256: digest(Buffer.from(baseline)),
                required_placeholders: expressions.map((_,i) => '${TH_PROMPT_EXPR_' + i + '}'),
                context_reasons: contextReasons(node, parent, parents),
                occurrence: {start, end, source_sha256: digest(source.subarray(start,end)),
                  kind: literal ? 'string' : 'template', segments, expressions}});
            }
          }
        } else skipped.invalid_unicode++;
      }
    }
    for (const [key,value] of Object.entries(node)) {
      if (key === 'start' || key === 'end') continue;
      if (Array.isArray(value)) {
        for (const child of value) if (child?.type) { parents.set(child, node); stack.push({node: child, parent: node}); }
      } else if (value?.type) { parents.set(value, node); stack.push({node: value, parent: node}); }
    }
  }
}
// Group every source match BEFORE capability decisions. A disallowed occurrence
// makes the complete block observed-only, even if other copies look like prompts.
matched.sort((a,b) => a.occurrence.start - b.occurrence.start || b.occurrence.end - a.occurrence.end);
const groups = new Map();
for (const item of matched) {
  const key = item.catalog_id + ':' + item.baseline_sha256;
  if (!groups.has(key)) groups.set(key, {...item, occurrences: [], excluded_reasons: new Set(), contexts: []});
  const group = groups.get(key);
  group.occurrences.push(item.occurrence);
  group.contexts.push({start: item.occurrence.start, end: item.occurrence.end,
    source_sha256: item.occurrence.source_sha256, reasons: item.context_reasons});
  for (const reason of item.context_reasons) group.excluded_reasons.add(reason);
  if (Buffer.byteLength(item.baseline_utf8) < 64) group.excluded_reasons.add('short-literal-ownership-ambiguous');
}
function propagateAmbiguityByContent() {
  const reasonsByDigest = new Map();
  for (const group of groups.values()) {
    if (!reasonsByDigest.has(group.baseline_sha256)) reasonsByDigest.set(group.baseline_sha256, new Set());
    for (const reason of group.excluded_reasons) reasonsByDigest.get(group.baseline_sha256).add(reason);
  }
  for (const group of groups.values()) for (const reason of reasonsByDigest.get(group.baseline_sha256)) group.excluded_reasons.add(reason);
}
propagateAmbiguityByContent();
const candidates = [...groups.values()].filter(group => group.excluded_reasons.size === 0)
  .flatMap(group => group.occurrences.map(occurrence => ({group, occurrence})))
  .sort((a,b) => a.occurrence.start - b.occurrence.start || b.occurrence.end - a.occurrence.end);
const selected = [];
let overlapCount = 0;
for (const candidate of candidates) {
  const previous = selected.at(-1);
  if (previous && candidate.occurrence.start < previous.occurrence.end) {
    candidate.group.excluded_reasons.add('overlaps-another-prompt-literal'); overlapCount++;
  } else selected.push(candidate);
}
propagateAmbiguityByContent();
const blocks = [...groups.values()].map(({occurrence, context_reasons, excluded_reasons, ...rest}) => ({...rest,
  capability: excluded_reasons.size ? 'observed-only' : 'patchable', excluded_reasons: [...excluded_reasons].sort()}));
const patchable = blocks.filter(block => block.capability === 'patchable');
const excludedCounts = {};
for (const block of blocks) for (const reason of block.excluded_reasons) excludedCounts[reason] = (excludedCounts[reason] || 0) + 1;
const result = {schema_version: 1, source_sha256: digest(source), blocks,
  provenance: {catalog_sha256: catalogSha, catalog_version: catalog.version, parser_sha256: parserSha,
    extractor_sha256: digest(fs.readFileSync(new URL(import.meta.url))),
    catalog_rows: catalog.prompts.length, instruction_candidate_rows: rows.length,
    unique_instruction_candidates: unique.size, parsed_modules: parsedModules, total_modules: layout.modules.length,
    literal_nodes_examined: literals, source_matched_nodes: matched.length,
    verified_nonoverlapping_occurrences: patchable.reduce((sum, block) => sum + block.occurrences.length, 0),
    patchable_blocks: patchable.length, observed_only_blocks: blocks.length - patchable.length,
    overlapping_nodes_excluded: overlapCount, excluded_block_reasons: excludedCounts,
    ownership_policy: 'complete-block-ambiguity-v1; minimum-64-bytes; reject control/schema/structural/nested-template contexts',
    parse_failures: failures, skipped, coverage: failures.length ? 'partial-module-parse' : 'all-javascript-modules-parsed'}};
fs.writeFileSync(outputPath, JSON.stringify(result), {flag: 'wx', mode: 0o600});
process.stdout.write(JSON.stringify({blocks: blocks.length, ...result.provenance}) + '\n');

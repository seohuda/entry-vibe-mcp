import { readFileSync } from 'node:fs';
import type { NodePath } from '@babel/traverse';
import type { BlockParamSchema, BlockSchema } from '../../src/types/block.ts';
import {
  labelFromLangBlocks,
  loadLangMaps,
  parse,
  resolveLangRef,
  t,
  templateToLabel,
  traverse,
  type LangMaps,
} from './lang.ts';

const HAT_SKELETONS = new Set([
  'basic_event',
  'basic_button',
]);

function propKey(prop: t.ObjectProperty): string | undefined {
  if (t.isIdentifier(prop.key)) return prop.key.name;
  if (t.isStringLiteral(prop.key)) return prop.key.value;
  return undefined;
}

function getProp(obj: t.ObjectExpression, name: string): t.Node | undefined {
  for (const p of obj.properties) {
    if (!t.isObjectProperty(p)) continue;
    if (propKey(p) === name) return p.value as t.Node;
  }
  return undefined;
}

function evalStaticValue(node: t.Node | undefined, lang: LangMaps): unknown {
  if (!node) return undefined;
  if (t.isNullLiteral(node)) return null;
  if (t.isStringLiteral(node)) return node.value;
  if (t.isNumericLiteral(node)) return node.value;
  if (t.isBooleanLiteral(node)) return node.value;
  if (t.isUnaryExpression(node) && node.operator === '-' && t.isNumericLiteral(node.argument)) {
    return -node.argument.value;
  }

  const langVal = resolveLangRef(node, lang);
  if (langVal !== undefined) return langVal;

  // Nested block default: { type: 'number', params: ['10'] }
  if (t.isObjectExpression(node)) {
    const typeNode = getProp(node, 'type');
    const paramsNode = getProp(node, 'params');
    const type = typeNode && t.isStringLiteral(typeNode) ? typeNode.value : undefined;
    if (type) {
      const params: unknown[] = [];
      if (paramsNode && t.isArrayExpression(paramsNode)) {
        for (const el of paramsNode.elements) {
          if (!el) {
            params.push(null);
            continue;
          }
          params.push(evalStaticValue(el, lang));
        }
      }
      return { type, params };
    }
  }

  if (t.isArrayExpression(node)) {
    return node.elements.map((el) => (el ? evalStaticValue(el, lang) : null));
  }

  // MemberExpression / Identifier we can't resolve → stringify path
  if (t.isMemberExpression(node)) {
    return memberToPath(node);
  }
  if (t.isIdentifier(node)) return node.name;

  return undefined;
}

function memberToPath(node: t.MemberExpression): string {
  const parts: string[] = [];
  let cur: t.Node = node;
  while (t.isMemberExpression(cur)) {
    if (t.isIdentifier(cur.property)) parts.unshift(cur.property.name);
    else if (t.isStringLiteral(cur.property)) parts.unshift(cur.property.value);
    else break;
    cur = cur.object;
  }
  if (t.isIdentifier(cur)) parts.unshift(cur.name);
  return parts.join('.');
}

function parseParamsKeyMap(node: t.Node | undefined): Record<string, number> {
  const map: Record<string, number> = {};
  if (!node || !t.isObjectExpression(node)) return map;
  for (const p of node.properties) {
    if (!t.isObjectProperty(p)) continue;
    const key = propKey(p);
    if (!key) continue;
    if (t.isNumericLiteral(p.value)) map[key] = p.value.value;
  }
  return map;
}

function parseStatementsKeyMap(node: t.Node | undefined): Record<string, number> {
  return parseParamsKeyMap(node);
}

function parseDropdownOptions(
  optionsNode: t.Node | undefined,
  lang: LangMaps,
): Array<{ label: string; value: string }> | undefined {
  if (!optionsNode || !t.isArrayExpression(optionsNode)) return undefined;
  const options: Array<{ label: string; value: string }> = [];
  for (const el of optionsNode.elements) {
    if (!el || !t.isArrayExpression(el) || el.elements.length < 2) continue;
    const [labelNode, valueNode] = el.elements;
    if (!labelNode || !valueNode) continue;
    const label =
      resolveLangRef(labelNode, lang) ??
      (t.isStringLiteral(labelNode) ? labelNode.value : memberToPath(labelNode as t.MemberExpression));
    const value =
      t.isStringLiteral(valueNode)
        ? valueNode.value
        : t.isNumericLiteral(valueNode)
          ? String(valueNode.value)
          : resolveLangRef(valueNode, lang) ?? String(evalStaticValue(valueNode, lang) ?? '');
    options.push({ label: String(label), value });
  }
  return options.length ? options : undefined;
}

function parseParamSchema(
  paramNode: t.Node,
  index: number,
  keyByIndex: Map<number, string>,
  defParams: unknown[] | undefined,
  lang: LangMaps,
): BlockParamSchema {
  const key = keyByIndex.get(index) ?? String(index);
  if (!t.isObjectExpression(paramNode)) {
    return { key, type: 'Unknown' };
  }

  const typeNode = getProp(paramNode, 'type');
  const type =
    typeNode && t.isStringLiteral(typeNode) ? typeNode.value : 'Unknown';

  const schema: BlockParamSchema = { key, type };

  const acceptNode = getProp(paramNode, 'accept');
  if (acceptNode && t.isStringLiteral(acceptNode)) {
    schema.accept = acceptNode.value;
  }

  const defaultTypeNode = getProp(paramNode, 'defaultType');
  if (defaultTypeNode && t.isStringLiteral(defaultTypeNode)) {
    schema.defaultType = defaultTypeNode.value;
  }

  if (defParams && index < defParams.length) {
    schema.defaultValue = defParams[index];
  }

  const options = parseDropdownOptions(getProp(paramNode, 'options'), lang);
  if (options) schema.options = options;

  return schema;
}

function extractBlock(
  type: string,
  blockObj: t.ObjectExpression,
  category: string,
  lang: LangMaps,
): BlockSchema {
  const skeletonNode = getProp(blockObj, 'skeleton');
  const skeleton =
    skeletonNode && t.isStringLiteral(skeletonNode) ? skeletonNode.value : undefined;

  const paramsKeyMap = parseParamsKeyMap(getProp(blockObj, 'paramsKeyMap'));
  const statementsKeyMap = parseStatementsKeyMap(getProp(blockObj, 'statementsKeyMap'));

  const keyByIndex = new Map<number, string>();
  for (const [k, idx] of Object.entries(paramsKeyMap)) {
    keyByIndex.set(idx, k);
  }

  const defNode = getProp(blockObj, 'def');
  let defParams: unknown[] | undefined;
  if (defNode && t.isObjectExpression(defNode)) {
    const dp = getProp(defNode, 'params');
    if (dp && t.isArrayExpression(dp)) {
      defParams = dp.elements.map((el) => (el ? evalStaticValue(el, lang) : null));
    }
  }

  const paramsNode = getProp(blockObj, 'params');
  const params: BlockParamSchema[] = [];
  if (paramsNode && t.isArrayExpression(paramsNode)) {
    // Assign by index, never push: the compiler maps schema.params positionally
    // onto Entry's params array, so an array hole must not shift later entries.
    paramsNode.elements.forEach((el, index) => {
      params[index] = el
        ? parseParamSchema(el, index, keyByIndex, defParams, lang)
        : { key: keyByIndex.get(index) ?? String(index), type: 'Unknown' };
    });
  }

  const statementsNode = getProp(blockObj, 'statements');
  let statementSlots = 0;
  if (statementsNode && t.isArrayExpression(statementsNode)) {
    statementSlots = statementsNode.elements.length;
  }

  const statementKeys = Object.entries(statementsKeyMap)
    .sort((a, b) => a[1] - b[1])
    .map(([k]) => k);

  // If no statementsKeyMap but slots exist, synthesize numeric names
  if (statementSlots > 0 && statementKeys.length === 0) {
    for (let i = 0; i < statementSlots; i++) statementKeys.push(String(i));
  }

  const label = {
    // templateToLabel yields '' when the template is only placeholders
    ko:
      templateToLabel(lang.template[type], '') ||
      labelFromLangBlocks(type, category, lang) ||
      type,
  };

  return {
    type,
    category,
    label,
    params,
    statementSlots,
    statementKeys,
    isHat: skeleton ? HAT_SKELETONS.has(skeleton) || Boolean(getProp(blockObj, 'event')) : false,
    skeleton,
  };
}

/** Find the object literal returned by getBlocks(). */
function findGetBlocksReturnObject(ast: t.File): t.ObjectExpression | null {
  let found: t.ObjectExpression | null = null;

  traverse(ast, {
    ObjectMethod(path: NodePath<t.ObjectMethod>) {
      if (!t.isIdentifier(path.node.key, { name: 'getBlocks' })) return;
      path.traverse({
        ReturnStatement(retPath: NodePath<t.ReturnStatement>) {
          // Only the outermost return of getBlocks
          if (retPath.node.argument && t.isObjectExpression(retPath.node.argument)) {
            // Prefer the first ObjectExpression return that looks like a block map
            if (!found) found = retPath.node.argument;
          }
        },
      });
      path.skip();
    },
    ObjectProperty(path: NodePath<t.ObjectProperty>) {
      if (!t.isIdentifier(path.node.key, { name: 'getBlocks' })) return;
      if (!t.isFunctionExpression(path.node.value) && !t.isArrowFunctionExpression(path.node.value)) {
        return;
      }
      path.traverse({
        ReturnStatement(retPath: NodePath<t.ReturnStatement>) {
          if (retPath.node.argument && t.isObjectExpression(retPath.node.argument)) {
            if (!found) found = retPath.node.argument;
          }
        },
      });
      path.skip();
    },
  });

  return found;
}

export function extractBlocksFromFile(
  filePath: string,
  category: string,
  lang: LangMaps,
): BlockSchema[] {
  const source = readFileSync(filePath, 'utf8');
  const ast = parse(source, {
    sourceType: 'module',
    plugins: ['objectRestSpread'],
    allowReturnOutsideFunction: true,
    errorRecovery: true,
  });

  const blocksObj = findGetBlocksReturnObject(ast);
  if (!blocksObj) {
    console.warn(`No getBlocks() return object in ${filePath}`);
    return [];
  }

  const blocks: BlockSchema[] = [];
  for (const prop of blocksObj.properties) {
    if (!t.isObjectProperty(prop)) continue;
    const type = propKey(prop);
    if (!type) continue;
    if (!t.isObjectExpression(prop.value)) continue;
    blocks.push(extractBlock(type, prop.value, category, lang));
  }
  return blocks;
}

export { loadLangMaps };

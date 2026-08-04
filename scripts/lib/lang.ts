import { readFileSync } from 'node:fs';
import { parse } from '@babel/parser';
import babelTraverse from '@babel/traverse';
import type { NodePath } from '@babel/traverse';
import * as t from '@babel/types';

const traverse = babelTraverse as unknown as typeof babelTraverse & ((
  ast: t.File,
  visitors: object,
) => void);


export interface LangMaps {
  template: Record<string, string>;
  blocks: Record<string, string>;
}

function stringFromNode(node: t.Node | null | undefined): string | undefined {
  if (!node) return undefined;
  if (t.isStringLiteral(node)) return node.value;
  if (t.isTemplateLiteral(node) && node.expressions.length === 0) {
    return node.quasis.map((q) => q.value.cooked ?? q.value.raw).join('');
  }
  if (t.isNumericLiteral(node)) return String(node.value);
  if (t.isBooleanLiteral(node)) return String(node.value);
  if (t.isNullLiteral(node)) return undefined;
  return undefined;
}

function collectObjectStringProps(obj: t.ObjectExpression): Record<string, string> {
  const out: Record<string, string> = {};
  for (const prop of obj.properties) {
    if (!t.isObjectProperty(prop)) continue;
    const key = t.isIdentifier(prop.key)
      ? prop.key.name
      : t.isStringLiteral(prop.key)
        ? prop.key.value
        : t.isNumericLiteral(prop.key)
          ? String(prop.key.value)
          : undefined;
    if (!key) continue;
    const val = stringFromNode(prop.value as t.Node);
    if (val !== undefined) out[key] = val;
  }
  return out;
}

/** Parse entryjs extern/lang/ko.js into template + Blocks string maps. */
export function loadLangMaps(koJsPath: string): LangMaps {
  const source = readFileSync(koJsPath, 'utf8');
  const ast = parse(source, {
    sourceType: 'script',
    allowReturnOutsideFunction: true,
  });

  const template: Record<string, string> = {};
  const blocks: Record<string, string> = {};

  traverse(ast, {
    AssignmentExpression(path: NodePath<t.AssignmentExpression>) {
      const { left, right } = path.node;
      if (!t.isMemberExpression(left) || !t.isObjectExpression(right)) return;
      if (!t.isIdentifier(left.object, { name: 'Lang' })) return;
      if (!t.isIdentifier(left.property)) return;

      if (left.property.name === 'template') {
        Object.assign(template, collectObjectStringProps(right));
      } else if (left.property.name === 'Blocks') {
        Object.assign(blocks, collectObjectStringProps(right));
      }
    },
  });

  return { template, blocks };
}

/** Turn Lang.template "이동 방향으로 %1 만큼 움직이기 %2" into a readable label. */
export function templateToLabel(template: string | undefined, fallback: string): string {
  if (!template) return fallback;
  return template
    .replace(/%\d+/g, '')
    .replace(/\s+/g, ' ')
    .trim() || fallback;
}

export function resolveLangRef(
  node: t.Node,
  lang: LangMaps,
): string | undefined {
  // Lang.Blocks.FOO or Lang.template.FOO
  if (
    t.isMemberExpression(node) &&
    t.isMemberExpression(node.object) &&
    t.isIdentifier(node.object.object, { name: 'Lang' }) &&
    t.isIdentifier(node.object.property) &&
    t.isIdentifier(node.property)
  ) {
    const ns = node.object.property.name;
    const key = node.property.name;
    if (ns === 'Blocks') return lang.blocks[key];
    if (ns === 'template') return lang.template[key];
  }
  return stringFromNode(node);
}

export { t, traverse, parse };
export type { NodePath };

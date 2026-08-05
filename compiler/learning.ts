/**
 * Entry AI learning model (`project.learning`) helpers.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { EntryIRLearning } from '../src/types/ir.ts';
import { assetsDir } from './assets.ts';

export type EntryLearningExport = Record<string, unknown>;

const LEARNING_TYPES = new Set([
  'image',
  'speech',
  'text',
  'number',
  'regression',
  'logisticRegression',
  'cluster',
  'decisiontree',
  'svm',
]);

export function normalizeLearningType(type: string): string {
  return type.trim();
}

export function isValidLearningType(type: string): boolean {
  return LEARNING_TYPES.has(normalizeLearningType(type));
}

function generateLearningId(): string {
  return randomBytes(12).toString('hex');
}

/** Resolve optional host JSON under assets/learning/*.json */
export function loadLearningModelFile(modelPath: string): EntryLearningExport {
  let raw = modelPath.trim().replace(/\\/g, '/');
  if (raw.startsWith('assets/')) raw = raw.slice('assets/'.length);
  if (raw.includes('..') || raw.startsWith('/')) {
    throw new Error(`learning modelPath escapes assets/: ${JSON.stringify(modelPath)}`);
  }
  const abs = join(assetsDir(), raw);
  if (!existsSync(abs)) {
    throw new Error(`learning model file not found: ${abs}`);
  }
  return JSON.parse(readFileSync(abs, 'utf8')) as EntryLearningExport;
}

/** Build Entry `project.learning` object from IR. */
export function compileLearning(learning: EntryIRLearning): EntryLearningExport {
  const type = normalizeLearningType(learning.type);
  if (!isValidLearningType(type)) {
    throw new Error(`unsupported learning.type: ${JSON.stringify(learning.type)}`);
  }
  if (!Array.isArray(learning.labels) || learning.labels.length === 0) {
    throw new Error('learning.labels must be a non-empty string array');
  }

  let base: EntryLearningExport = {};
  if (learning.modelPath) {
    base = loadLearningModelFile(learning.modelPath);
  }

  const id = String(learning.id ?? learning._id ?? base.id ?? base._id ?? generateLearningId());
  const url =
    learning.url ??
    base.url ??
    `indexeddb://${id}`;

  return {
    ...base,
    type,
    labels: learning.labels,
    id,
    _id: String(learning._id ?? base._id ?? id),
    url,
    recordTime: learning.recordTime ?? base.recordTime ?? (type === 'speech' ? 3000 : undefined),
    trainParam: learning.trainParam ?? base.trainParam,
    tableData: learning.tableData ?? base.tableData ?? null,
    name: learning.name ?? base.name,
    model: learning.model ?? base.model,
    version: learning.version ?? base.version ?? 1,
  };
}

/** Decompile Entry project.learning → IR (passthrough fields). */
export function decompileLearning(raw: unknown): EntryIRLearning | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const rec = raw as Record<string, unknown>;
  const type = rec.type;
  const labels = rec.labels;
  if (typeof type !== 'string' || !Array.isArray(labels)) return undefined;
  return {
    type: type as EntryIRLearning['type'],
    labels: labels.map(String),
    id: typeof rec.id === 'string' ? rec.id : undefined,
    _id: typeof rec._id === 'string' ? rec._id : undefined,
    url: typeof rec.url === 'string' ? rec.url : undefined,
    recordTime: typeof rec.recordTime === 'number' ? rec.recordTime : undefined,
    trainParam:
      rec.trainParam && typeof rec.trainParam === 'object'
        ? (rec.trainParam as Record<string, number | string>)
        : undefined,
    tableData: rec.tableData,
    name: typeof rec.name === 'string' ? rec.name : undefined,
    model: typeof rec.model === 'string' ? rec.model : undefined,
    version: typeof rec.version === 'number' ? rec.version : undefined,
  };
}

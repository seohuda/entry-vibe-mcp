/** Intermediate representation produced by the host LLM. */
import type { LibraryLicense } from '../library/types.ts';

/** Resource notices retained when a library project is imported as custom media. */
export interface IRAssetAttribution {
  id: string;
  source: string;
  name: string;
  license: LibraryLicense;
}

export type IRParamValue = string | number | boolean | IRBlock;

export interface IRBlock {
  type: string;
  /**
   * Named params from the catalog schema.
   * - `VARIABLE` / `LIST`: declare in ir.variables / ir.lists; compiler rewrites name → id.
   * - Message blocks (`message_cast`, `when_message_cast`, …): use `VALUE` with the
   *   message *name* from ir.messages; compiler rewrites name → id.
   * - `function_call`: use `NAME` with a function name from ir.functions.
   */
  params?: Record<string, IRParamValue>;
  /** Named statement slots from catalog statementKeys (e.g. DO, STACK_IF). */
  statements?: Record<string, Thread>;
}

export type Thread = IRBlock[];

/** Custom costume under the host project's `assets/` folder (png or svg). */
export interface IRPicture {
  /** Display name in Entry. Defaults to the file stem. */
  name?: string;
  /**
   * Path relative to the host cwd. Must stay under `assets/` and end with
   * `.png` or `.svg` — e.g. `assets/cat.png` or `assets/sprites/hero.svg`.
   */
  path: string;
}

/** Custom sound under the host project's `assets/` folder (mp3 only). */
export interface IRSound {
  /** Display name in Entry. Defaults to the file stem. */
  name?: string;
  /**
   * Path relative to the host cwd. Must stay under `assets/` and end with
   * `.mp3` — e.g. `assets/meow.mp3`.
   */
  path: string;
  /** Duration in seconds. Defaults to 1 when omitted. */
  duration?: number;
}

export interface EntryIRScene {
  name: string;
  /** Optional locked background sprite for this scene (png/svg under assets/). */
  background?: IRPicture;
}

export interface EntryIRObject {
  name: string;
  /** `sprite` (default) or `text` for Entry text boxes. */
  kind?: 'sprite' | 'text';
  /**
   * Built-in Entrybot when omitted or `"entrybot"`.
   * `"custom"` requires {@link pictures}; compiler keeps entity defaults unless pictures override size.
   * `"library"` resolves {@link library} through a registered object provider.
   */
  sprite?: 'entrybot' | 'custom' | 'library';
  /** Exact provider reference returned by search_objects; unresolved IDs are errors. */
  library?: {
    source: string;
    /** Qualified stable identifier, e.g. `local:cat`. */
    objectId: string;
  };
  /** Locked background layer fitted to Entry's 480×270 stage. Library backgrounds set this automatically. */
  background?: boolean;
  /** Text box body when kind is `text`. */
  text?: string;
  /** Custom costumes from `assets/` (required when sprite is `custom`). */
  pictures?: IRPicture[];
  /** Optional sounds from `assets/` (mp3). */
  sounds?: IRSound[];
  /** Optional stage position (Entry entity x/y). Defaults to skeleton (0,0). */
  x?: number;
  y?: number;
  /** Scene name from {@link EntryIR.scenes}. Defaults to the first scene. */
  scene?: string;
  scripts: Thread[];
}

export interface EntryIRVariable {
  name: string;
  initialValue: string | number;
}

export interface EntryIRList {
  name: string;
  /** Initial items, in order. Defaults to an empty list. */
  initialValues?: Array<string | number>;
}

export interface EntryIRMessage {
  name: string;
}

/**
 * User-defined function. Call it from object scripts with
 * `{ "type": "function_call", "params": { "NAME": "<name>" } }`.
 */
export interface EntryIRFunction {
  name: string;
  /** `statement` = void function; `string`/`boolean` = value-returning. */
  type?: 'statement' | 'string' | 'boolean';
  /**
   * Function body (no event hat). For value functions, put the return expression
   * in {@link returnValue} instead of ending the body with a return block.
   */
  body: Thread;
  /** Required when type is `string` or `boolean` — expression block or literal. */
  returnValue?: IRParamValue;
}

export interface EntryIRLearning {
  /** Entry learning model type (image, speech, text, number, …). */
  type:
    | 'image'
    | 'speech'
    | 'text'
    | 'number'
    | 'regression'
    | 'logisticRegression'
    | 'cluster'
    | 'decisiontree'
    | 'svm';
  labels: string[];
  id?: string;
  _id?: string;
  url?: string;
  name?: string;
  model?: string;
  version?: number;
  recordTime?: number;
  trainParam?: Record<string, number | string>;
  tableData?: unknown;
  /**
   * Optional host JSON under assets/learning/ merged into project.learning.
   * Use when importing a trained model sidecar.
   */
  modelPath?: string;
}

export interface EntryIR {
  /** Preserve these notices when editing or re-exporting imported assets. */
  assetAttributions?: IRAssetAttribution[];
  /** Scenes; defaults to a single "장면 1" when omitted. */
  scenes?: EntryIRScene[];
  objects: EntryIRObject[];
  variables?: EntryIRVariable[];
  lists?: EntryIRList[];
  messages?: EntryIRMessage[];
  functions?: EntryIRFunction[];
  /** AI learning model metadata — required when using aiLearning blocks. */
  learning?: EntryIRLearning;
  /** Execution FPS (default 60). */
  speed?: number;
}

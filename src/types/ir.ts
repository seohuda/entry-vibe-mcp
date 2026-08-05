/** Intermediate representation produced by the host LLM. */

export type IRParamValue = string | number | boolean | IRBlock;

export interface IRBlock {
  type: string;
  /**
   * Named params from the catalog schema. A `VARIABLE` param takes the
   * variable *name* declared in {@link EntryIR.variables}; the compiler
   * rewrites it to the generated variable id Entry expects.
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

export interface EntryIRObject {
  name: string;
  /**
   * Built-in Entrybot costumes/sounds when `pictures` / `sounds` are omitted.
   * When set, those host files replace the corresponding media
   * (sprite stays `"entrybot"` for v1 entity defaults).
   */
  sprite: 'entrybot';
  /** Optional host costumes from `assets/` (png/svg). */
  pictures?: IRPicture[];
  /** Optional host sounds from `assets/` (mp3). */
  sounds?: IRSound[];
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

export interface EntryIR {
  objects: EntryIRObject[];
  variables?: EntryIRVariable[];
  lists?: EntryIRList[];
}

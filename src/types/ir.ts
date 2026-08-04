/** Intermediate representation produced by the host LLM. */

export type IRParamValue = string | number | boolean | IRBlock;

export interface IRBlock {
  type: string;
  params?: Record<string, IRParamValue>;
  /** Named statement slots from catalog statementKeys (e.g. DO, STACK_IF). */
  statements?: Record<string, Thread>;
}

export type Thread = IRBlock[];

export interface EntryIRObject {
  name: string;
  sprite: 'entrybot';
  scripts: Thread[];
}

export interface EntryIRVariable {
  name: string;
  initialValue: string | number;
}

export interface EntryIR {
  objects: EntryIRObject[];
  variables?: EntryIRVariable[];
}

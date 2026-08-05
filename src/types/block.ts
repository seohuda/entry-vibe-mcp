/** Catalog schema for a single Entry block type. */
export interface BlockParamSchema {
  key: string;
  type: 'Block' | 'Dropdown' | 'DropdownDynamic' | 'Indicator' | 'Text' | 'LineBreak' | string;
  accept?: string;
  defaultType?: string;
  defaultValue?: unknown;
  options?: Array<{ label: string; value: string }>;
}

/** Extra Entry modules that must be listed on the project for the block to load. */
export type BlockExtensionKind =
  | 'aiUtilize'
  | 'aiLearning'
  | 'expansion'
  | 'hardware'
  | 'hardwareLite';

export interface BlockExtension {
  kind: BlockExtensionKind;
  /** Module key Entry stores (e.g. `tts`, `arduino`, `weather`). */
  module: string;
}

export interface BlockSchema {
  type: string;
  category: string;
  label: { ko: string };
  params: BlockParamSchema[];
  statementSlots: number;
  statementKeys: string[];
  isHat: boolean;
  skeleton?: string;
  /** Present for AI / expansion / hardware blocks (not core categories). */
  extension?: BlockExtension;
}

export interface BlockCatalog {
  version: number;
  generatedAt: string;
  blocks: BlockSchema[];
}

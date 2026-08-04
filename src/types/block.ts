/** Catalog schema for a single Entry block type. */
export interface BlockParamSchema {
  key: string;
  type: 'Block' | 'Dropdown' | 'DropdownDynamic' | 'Indicator' | 'Text' | 'LineBreak' | string;
  accept?: string;
  defaultType?: string;
  defaultValue?: unknown;
  options?: Array<{ label: string; value: string }>;
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
}

export interface BlockCatalog {
  version: number;
  generatedAt: string;
  blocks: BlockSchema[];
}

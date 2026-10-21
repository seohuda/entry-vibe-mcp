/** Library imports share the existing immutable add_object/validation workflow. */
import type { EntryIR, EntryIRObject } from '../src/types/ir.ts';
import { getObjectLibrary } from '../src/library/index.ts';
import { addObjectValidated, IREditError } from './ir-edit.ts';

export interface AddLibraryObjectOptions {
  objectId: string;
  name?: string;
  x?: number;
  y?: number;
  scene?: string;
}

export function addLibraryObjectValidated(ir: EntryIR, options: AddLibraryObjectOptions) {
  // Resolve bytes before returning success: a catalog entry alone is not an import.
  const resolved = getObjectLibrary().resolveObjectAssets(options.objectId);
  const metadata = resolved.object;
  const usedNames = new Set(ir.objects.map((object) => object.name));
  let name: string;
  if (options.name !== undefined) {
    name = options.name.trim();
    if (!name) throw new IREditError('object name must not be empty');
    if (usedNames.has(name)) throw new IREditError(`object name already exists: ${JSON.stringify(name)}`);
  } else {
    name = metadata.name;
    for (let suffix = 2; usedNames.has(name); suffix++) name = `${metadata.name} ${suffix}`;
  }
  const object: EntryIRObject = {
    name,
    sprite: 'library',
    library: { source: metadata.source, objectId: metadata.id },
    scripts: metadata.kind === 'background' ? [] : [[{ type: 'when_run_button_click' }]],
  };
  if (options.x !== undefined) object.x = options.x;
  if (options.y !== undefined) object.y = options.y;
  if (options.scene !== undefined) object.scene = options.scene;
  return { ...addObjectValidated(ir, object), object: metadata, objectName: name };
}

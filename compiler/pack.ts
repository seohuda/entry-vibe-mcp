/**
 * Pack an Entry project into a .ent file (tar.gz with temp/project.json + media).
 * Format matches entrylabs/entry-offline FileUtils.pack / MainUtils.saveProject.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as tar from 'tar';
import {
  ENTRYBOT_MEDIA_FILES,
  type EntryProject,
} from './skeleton.ts';
import { projectForExport } from './compile.ts';
import { mediaDir } from '../src/paths.ts';

export interface PackOptions {
  /** Destination .ent path */
  outputPath: string;
  /** Directory containing entrybot1.svg etc. */
  mediaDir?: string;
  /** Keep intermediate staging dir for debugging */
  keepStaging?: boolean;
}

export async function packEnt(
  project: EntryProject,
  options: PackOptions,
): Promise<string> {
  const { outputPath } = options;
  if (!outputPath.endsWith('.ent')) {
    throw new Error('output path must end with .ent');
  }

  const mediaSource = options.mediaDir ?? mediaDir();
  const outputParent = dirname(outputPath);
  mkdirSync(outputParent, { recursive: true });

  // mkdtemp rather than a timestamp: two compiles in the same millisecond
  // shared a staging dir, and whichever finished first deleted it in `finally`.
  const stagingRoot = mkdtempSync(join(outputParent, '.ent-staging-'));
  const tempDir = join(stagingRoot, 'temp');
  const mediaOut = join(tempDir, 'media');

  try {
    mkdirSync(mediaOut, { recursive: true });

    const exportable = projectForExport(project);
    writeFileSync(join(tempDir, 'project.json'), JSON.stringify(exportable), 'utf8');

    for (const file of ENTRYBOT_MEDIA_FILES) {
      const src = join(mediaSource, file);
      if (!existsSync(src)) {
        throw new Error(
          `Missing media file: ${src}. It should ship in assets/media/; ` +
            'restore it from upstream with `npm run fetch:entryjs`.',
        );
      }
      writeFileSync(join(mediaOut, file), readFileSync(src));
    }

    await tar.c(
      {
        gzip: { level: 6 },
        file: outputPath,
        cwd: stagingRoot,
        portable: true,
      },
      ['temp'],
    );

    return outputPath;
  } finally {
    if (!options.keepStaging) {
      rmSync(stagingRoot, { recursive: true, force: true });
    }
  }
}

export function writeProjectJson(project: EntryProject, path: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(projectForExport(project), null, 2) + '\n');
}

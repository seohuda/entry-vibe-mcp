/**
 * Full project verification: smoke + in-memory pack roundtrip + optional simulation.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { EntryIR } from '../src/types/ir.ts';
import { compileProject, projectForExport } from './compile.ts';
import { decompileProject } from './decompile.ts';
import { packPrepared, prepareExport } from './pack.ts';
import { simulateProject, type SimulateResult } from './runtime-sim.ts';
import { smokeTestProject, type SmokeCheck, type SmokeResult } from './smoke.ts';
import { unpackEnt } from './unpack.ts';
import { validateProject } from './validate.ts';

export interface VerifyOptions {
  /** Run pack → unpack → decompile roundtrip (default true). */
  roundtrip?: boolean;
  /** Run core block simulator (default true). */
  simulate?: boolean;
}

export interface VerifyResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  checks: SmokeCheck[];
  smoke: SmokeResult;
  roundtrip?: { ok: boolean; detail: string; decompileWarnings: string[] };
  simulation?: SimulateResult;
}

function checkExportShape(project: ReturnType<typeof compileProject>): SmokeCheck {
  const issues: string[] = [];
  if (!project.name) issues.push('missing project.name');
  if (!Array.isArray(project.scenes) || project.scenes.length === 0) {
    issues.push('missing scenes');
  }
  if (!Array.isArray(project.objects) || project.objects.length === 0) {
    issues.push('missing objects');
  }
  for (const obj of project.objects as Array<Record<string, unknown>>) {
    if (!obj.id) issues.push(`object "${obj.name}" missing id`);
    if (!obj.scene) issues.push(`object "${obj.name}" missing scene`);
    if (obj.objectType === 'sprite') {
      const sprite = obj.sprite as { pictures?: unknown[] } | undefined;
      if (!sprite?.pictures?.length) {
        issues.push(`sprite object "${obj.name}" missing pictures`);
      }
    }
  }
  return {
    name: 'export_shape',
    ok: issues.length === 0,
    detail: issues.length ? issues.join('; ') : 'project JSON matches Entry export shape',
  };
}

export async function verifyProject(
  ir: EntryIR,
  options: VerifyOptions = {},
): Promise<VerifyResult> {
  const roundtrip = options.roundtrip !== false;
  const simulate = options.simulate !== false;
  const smoke = smokeTestProject(ir);
  const checks = [...smoke.checks];
  const errors = [...smoke.errors];
  const warnings = [...smoke.warnings];

  if (!smoke.ok) {
    return { ok: false, errors, warnings, checks, smoke };
  }

  const project = compileProject(ir);
  const shape = checkExportShape(project);
  checks.push(shape);
  if (!shape.ok) {
    errors.push(shape.detail ?? 'export shape invalid');
  }

  const exported = projectForExport(project);
  for (const obj of exported.objects as Array<Record<string, unknown>>) {
    if (typeof obj.script !== 'string') {
      errors.push(`export: object "${obj.name}" script must be stringified`);
    }
  }
  checks.push({
    name: 'script_stringify',
    ok: !errors.some((e) => e.includes('script must be stringified')),
    detail: 'object scripts stringified for .ent export',
  });

  let roundtripResult: VerifyResult['roundtrip'];
  if (roundtrip) {
    const dir = mkdtempSync(join(tmpdir(), 'entry-verify-'));
    const entPath = join(dir, 'verify.ent');
    try {
      const prepared = prepareExport(project);
      await packPrepared(prepared, { outputPath: entPath });
      const { project: unpacked, media } = await unpackEnt(entPath);
      const { ir: decoded, warnings: decompileWarnings } = decompileProject(unpacked, { media });
      const revalidation = validateProject(decoded);
      roundtripResult = {
        ok: revalidation.valid,
        detail: revalidation.valid
          ? decompileWarnings.length
            ? `roundtrip ok (${decompileWarnings.length} decompile warnings)`
            : 'roundtrip ok'
          : revalidation.errors.join('; '),
        decompileWarnings,
      };
      checks.push({
        name: 'pack_roundtrip',
        ok: roundtripResult.ok,
        detail: roundtripResult.detail,
      });
      if (!roundtripResult.ok) {
        errors.push(`roundtrip failed: ${roundtripResult.detail}`);
      }
      warnings.push(...decompileWarnings);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      roundtripResult = { ok: false, detail: msg, decompileWarnings: [] };
      checks.push({ name: 'pack_roundtrip', ok: false, detail: msg });
      errors.push(`roundtrip error: ${msg}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  let simulation: SimulateResult | undefined;
  if (simulate) {
    simulation = simulateProject(ir);
    checks.push({
      name: 'runtime_simulation',
      ok: simulation.ok,
      detail: `${simulation.stepsExecuted} step(s)${simulation.truncated ? ' (truncated)' : ''}`,
    });
    warnings.push(...simulation.warnings);
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings: [...new Set(warnings)],
    checks,
    smoke,
    roundtrip: roundtripResult,
    simulation,
  };
}

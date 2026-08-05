import { unpackEnt } from '../compiler/unpack.ts';
import { decompileProject } from '../compiler/decompile.ts';
import { verifyProject } from '../compiler/verify.ts';
import { validateProject } from '../compiler/validate.ts';
import { smokeTestProject } from '../compiler/smoke.ts';
import { auditCompiledProject } from '../compiler/audit-export.ts';

async function audit(path: string) {
  console.log('\n===', path, '===');
  const { project } = await unpackEnt(path);
  const audit = auditCompiledProject(project);
  console.log('export audit:', audit.ok, audit.errors, audit.hints);
  const dec = decompileProject(project);
  const ir = dec.ir;
  const val = validateProject(ir);
  const smoke = smokeTestProject(ir);
  const verify = await verifyProject(ir, { roundtrip: true, simulate: true });
  console.log('validate:', val.valid, val.errors.length ? val.errors.slice(0, 5) : 'ok');
  console.log('smoke:', smoke.ok, smoke.errors.slice(0, 3));
  console.log('verify:', verify.ok, verify.errors.slice(0, 5));
  if (verify.simulation) {
    console.log('sim:', verify.simulation.ok, verify.simulation.errors?.slice(0, 3));
  }
  if (dec.warnings.length) console.log('decompile warnings:', dec.warnings.slice(0, 5));

  for (const obj of project.objects as Array<Record<string, unknown>>) {
    let script = obj.script;
    if (typeof script === 'string') script = JSON.parse(script);
    const threads = Array.isArray(script) ? script : [];
    console.log(`object ${obj.name} (${obj.objectType}): ${threads.length} threads`);
    for (const t of threads) {
      const blocks = Array.isArray(t) ? t : ((t as { blocks?: unknown[] })?.blocks ?? []);
      if ((blocks as unknown[]).length) {
        console.log('  hat:', (blocks as Array<{ type?: string }>)[0]?.type, 'blocks:', (blocks as unknown[]).length);
      }
    }
  }
  console.log('functions:', (project.functions as unknown[])?.length ?? 0);
}

async function main() {
  for (const f of process.argv.slice(2)) {
    await audit(f);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

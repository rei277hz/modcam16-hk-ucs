import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const [stage, out] = process.argv.slice(2);
const { build } = await import(pathToFileURL(path.join(process.env.EXT_MODULES, 'esbuild/lib/main.js')));
const common = { bundle: true, nodePaths: [process.env.EXT_MODULES], target: 'es2022', legalComments: 'eof' };
for (const [entry, exportName] of [['worker','workerSource'],['color_worker','colorWorkerSource'],['preview_worker','previewWorkerSource']]) {
  const worker = await build({ ...common, entryPoints: [path.join(stage,'web',entry+'.ts')], write: false, format: 'iife' });
  await fs.writeFile(path.join(stage,'web',entry+'_source.ts'), `export const ${exportName} = ${JSON.stringify(worker.outputFiles[0].text)};\n`);
}
await build({ ...common, entryPoints: [path.join(stage,'web/app.ts')], outfile: path.join(out,'plugin/web/app.js'), format: 'iife' });
await build({ ...common, entryPoints: [path.join(stage,'host/main.ts')], outfile: path.join(out,'plugin/host.js'), format: 'cjs', platform: 'neutral', external: ['photoshop','uxp'] });
await fs.writeFile(path.join(stage,'test-api.ts'), `export * from './web/jobs'; export * from './web/presentation'; export * from './web/core'; export * from './web/png'; export * from './web/math'; export * from './web/webgpu'; export * from './web/webgl'; export * from './host/protocol'; export * from './host/foreground';`);
await build({ ...common, entryPoints: [path.join(stage,'test-api.ts')], outfile: path.join(out,'test-api.mjs'), format: 'esm' });

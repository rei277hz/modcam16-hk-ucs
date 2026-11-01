// Execute Adobe CLI's unmodified package command with a local packaging client.
// Its normal service discovery requires Adobe native binaries, unavailable on
// Linux. PackageCommand.package() performs Adobe's offline manifest validation
// and creates the CCX; connected-Photoshop validation is a separate host gate.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const modules=process.env.EXT_MODULES;
const command=require(path.join(modules,'@adobe/uxp-devtools-cli/src/cli/commands/plugin/package.js'));
const PackageCommand=require(path.join(modules,'@adobe/uxp-devtools-core/src/core/client/plugin/actions/PluginPackageCommand.js'));
const [plugin,output]=process.argv.slice(2);
const client={async executePluginCommand(name,params){
  if(name!=='packagePlugin')throw Error('Only offline packaging is supported.');
  const results=await new PackageCommand(null,params).package();
  if(!results.length||results.some(r=>!r.success))throw Error(results.map(r=>String(r.error??r.host)).join('\n'));
}};
const success=await command.handler.call({app:{client}},{manifest:path.join(plugin,'manifest.json'),apps:'PS',outputPath:output});
if(!success)throw Error('Adobe packaging failed.');
const manifest=JSON.parse(await fs.readFile(path.join(plugin,'manifest.json'),'utf8'));
const archive=path.join(output,`${manifest.id}_PS.ccx`);
if((await fs.stat(archive)).size<10000)throw Error('Missing or empty CCX.');
await fs.writeFile(path.join(output,'packaging.json'),JSON.stringify({
  adobeCli:require(path.join(modules,'@adobe/uxp-devtools-cli/package.json')).version,
  adobeCore:require(path.join(modules,'@adobe/uxp-devtools-core/package.json')).version,
  node:process.version,command:'plugin package',mode:'offline CLI handler with Adobe PackageCommand',
  connectedHostValidation:false,archive:path.basename(archive),
},null,2)+'\n');

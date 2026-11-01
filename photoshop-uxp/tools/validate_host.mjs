import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const [flag,plugin,...arguments_]=process.argv.slice(2);
const foregroundOnly=arguments_.includes('--foreground-only'),files=arguments_.filter(value=>value!=='--foreground-only');
if(flag!=='--plugin'||!files.length)throw Error('Usage: buck2 run //:validate_host -- [--foreground-only] host-results/*.json');
const {resolveView,floatColor,sameRGB,RGB_CONVERSION_MODEL,validForegroundSample}=await import(pathToFileURL(path.resolve(plugin,'test-api.mjs')));
const seen=new Set();let hdr=false, fallback=false,applied=0;
function foreground(reading,documentId) {
  if(reading.source==='paint-sample')return validForegroundSample(reading.sample??{})&&reading.sample.documentId===documentId?reading.sample.foreground:null;
  if(reading.source==='rgb-property')return floatColor(reading.rgbProperty?.descriptor);
  if(reading.source==='native-conversion')return reading.conversion?.targetModel===RGB_CONVERSION_MODEL?floatColor(reading.conversion.descriptor):null;
  if(reading.source==='native-float')return floatColor(reading.descriptor);
  if(reading.source!==undefined)return null;
  return floatColor(reading.descriptor)??(reading.conversion?.targetModel===RGB_CONVERSION_MODEL?floatColor(reading.conversion.descriptor):null);
}
for(const file of files){
  const capture=JSON.parse(await fs.readFile(file,'utf8'));
  if(![1,2,3,4].includes(capture.schema)||!(Number.parseInt(capture.photoshop)>=27))throw Error(`${file}: unsupported diagnostics version/host`);
  if(capture.schema>=3) {
    if(!capture.extension?.version||!Array.isArray(capture.transactions)||capture.transactions.length>8)throw Error(`${file}: incomplete schema-${capture.schema} extension/transaction data`);
    for(const transaction of capture.transactions) {
      if(transaction.outcome?.applied&&!sameRGB(transaction.requested,transaction.outcome.foreground))throw Error(`${file}: applied transaction does not match verified readback`);
      if(capture.schema===4&&transaction.outcome?.applied) {
        const reading=transaction.events?.find(event=>event.phase==='readback')?.reading;
        if(!reading||reading.error||!sameRGB(foreground(reading,transaction.documentId),transaction.requested))throw Error(`${file}: applied transaction has no matching native readback evidence`);
        applied++;
      }
    }
  }
  const view=resolveView(capture.documentDescriptor);
  const rgb=foreground({descriptor:capture.foregroundDescriptor,source:capture.foregroundSource,rgbProperty:capture.foregroundRGBProperty,
    conversion:capture.foregroundConversion,sample:capture.foregroundSample},capture.context?.documentId);
  if(!rgb||capture.foregroundError)throw Error(`${file}: neither the foreground nor its native RGB conversion/sample exposes verified floating-point ACEScg`);
  if(!sameRGB(rgb,capture.context?.foreground))throw Error(`${file}: foreground changed during capture; capture again`);
  if(view.viewName==='View unavailable'&&!foregroundOnly)throw Error(`${file}: current OCIO view was not found; record the host's view property`);
  if(view.fallback)fallback=true;else seen.add(view.view);
  if(rgb.some(v=>v>1))hdr=true;
  console.log(`${path.basename(file)}: ${view.viewName}; ACEScg ${rgb.join(', ')}; ${capture.foregroundSource??'legacy float descriptor'}`);
}
if(foregroundOnly) {
  console.log(`Foreground checks pass (${applied} applied transaction readbacks checked). OCIO-view coverage, UI behavior, visual HDR matching, and installation remain separate host acceptance checks.`);
  process.exit(0);
}
const missing=[0,1,2,4].filter(view=>!seen.has(view));
if(missing.length||!hdr||!fallback)throw Error(`Capture coverage incomplete: missing views [${missing}], HDR floats ${hdr}, unsupported-view fallback ${fallback}`);
console.log('Descriptor coverage passes. Painting readback, modal behavior, visual HDR matching, and CCX installation still require HOST_VALIDATION.md.');

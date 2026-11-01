import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readPng } from './png_reader.mjs';
const api = await import(pathToFileURL(path.join(process.env.EXT_PLUGIN,'test-api.mjs')));
const core = await api.ColorCore.create();
const reading=rgb=>({foreground:rgb,descriptor:{foregroundColor:{_obj:'RGBColor',redFloat:rgb?.[0],greenFloat:rgb?.[1],blueFloat:rgb?.[2]}}});
function writer(host) {
  return new api.ForegroundWriter({...host,read:async()=>{const value=await host.read();return Array.isArray(value)||value===null?reading(value):value;},
    restore:host.restore??(previous=>host.write(previous.foreground))});
}

test('canonical authoring color is independent of all four document views',() => {
  for (const full of [false,true]) for (const code of [[.46,.5,.5],[.3,.48,.54],[.8,.51,.51]]) {
    const canonical=core.evaluate(0,code,full);
    assert.equal(canonical[0],1);
    for (const view of [0,1,2,4]) {
      const evaluated=core.evaluate(view,code,full);
      assert.deepEqual(evaluated.slice(1,4),canonical.slice(1,4));
      const imported=core.import([...canonical.slice(1,4)],full);
      assert.equal(imported[0],1);
      code.forEach((v,i)=>assert.ok(Math.abs(v-imported[i+1])<2e-5));
    }
  }
});
test('domain rejection preserves external colors and full gamut adds valid coordinates',() => {
  assert.equal(core.evaluate(0,[.5,0,0],true)[0],0);
  assert.equal(core.import([1000,0,0],false)[0],0);
  let additional=0;
  for(let y=.1;y<1;y+=.1)for(let x=.1;x<1;x+=.1) {
    if(core.evaluate(0,[.3,x,y],true)[0]&&!core.evaluate(0,[.3,x,y],false)[0])additional++;
  }
  assert.ok(additional>0);
});
test('HDR PNGs encode absolute 100 nit units without the parent 2.03 uplift',() => {
  for(const view of [0,2]) {
    const png=readPng(api.encodeLinearRgbPng(view,2,1,[1,2.03,10,0,.18,4]));
    assert.equal(png.depth,16); assert.equal(png.icc,undefined);
    assert.deepEqual([...png.chunks.get('cICP')],[view===0?9:12,16,0,1]);
    // Independent ST 2084 constants, and published 100 nit code value.
    const pq=n=>((.8359375+18.8515625*(n/10000)**.1593017578125)/(1+18.6875*(n/10000)**.1593017578125))**78.84375;
    assert.deepEqual(png.pixel(0,0),[100,203,1000].map(n=>Math.round(pq(n)*65535)));
    assert.ok(Math.abs(png.pixel(0,0)[0]/65535-.508078)<2e-5);
  }
});
test('black, 203-nit authoring white and the 1000-nit peak survive PNG encoding and foreground import',() => {
  // Independent inverse ST 2084, applied to the actual shipping PNG samples.
  const nitsFromPq=code=>{
    const p=(code/65535)**(32/2523);
    return 10000*(Math.max(0,p-3424/4096)/(2413/128-2392/128*p))**(16384/2610);
  };
  for(const full of [false,true])for(const view of [0,2])for(const [j,nits] of [[0,0],[100/217.2768649129496,203],[1,1000]]) {
    const values=core.evaluate(view,[j,.5,.5],full);
    assert.equal(values[0],1);
    const scene=[...values.slice(1,4)];
    for(const input of [scene,scene.map(Math.fround)]) {
      const imported=core.import(input,full);
      assert.equal(imported[0],1);
      [j,.5,.5].forEach((v,i)=>assert.ok(Math.abs(v-imported[i+1])<2e-5));
    }
    const rgb=[...values.slice(26,29)];
    for(const bytes of [api.encodePreview(view,rgb,[...values.slice(29,32)]),
      api.encodeLinearRgbaPng(view,1,1,core.slice(view,j,1,1,0,1,full))]) {
      const png=readPng(bytes),pixel=png.pixel(Math.floor(png.width/2),Math.floor(png.height/2));
      pixel.forEach(code=>assert.ok(Math.abs(nitsFromPq(code)-nits)<.1,`${view}/${j}: ${nitsFromPq(code)} vs ${nits}`));
    }
  }
});
test('SDR profiles, RGBA alpha, and preview surrounds are color managed',() => {
  for(const view of [1,4]) {
    const png=readPng(api.encodeLinearRgbaPng(view,1,1,[.18,.5,1,.5]));
    assert.equal(png.depth,8); assert.ok(png.icc.length>8000); assert.equal(png.alpha(0,0),128);
    assert.deepEqual([...png.chunks.get('cICP')],[view===1?1:12,13,0,1]);
  }
  const png=readPng(api.encodePreview(0,[1,1,1],[.1,.1,.1]));
  assert.ok(png.pixel(128,128)[0]>png.pixel(0,0)[0]);
  assert.throws(()=>api.encodeLinearRgbPng(0,2,2,[0,0,0]),RangeError);
});
test('only a current OCIO view selects a profile; Raw and missing views fall back',() => {
  for(const [id,name] of Object.entries(api.VIEWS))assert.deepEqual(api.resolveView({openColorIO:{currentView:name}}),{view:+id,viewName:name,fallback:false});
  for(const descriptor of [{ocio:{views:Object.values(api.VIEWS)}},{view:api.VIEWS[1]},{ocio:{look:api.VIEWS[1]}},{ocio:{view:'Raw'}}])assert.equal(api.resolveView(descriptor).fallback,true);
});
test('foreground descriptor preserves HDR floats and refuses 8-bit fields',() => {
  assert.deepEqual(api.floatColor({foregroundColor:{redFloat:4.5,greenFloat:.1,blueFloat:-.01}}),[4.5,.1,-.01]);
  assert.equal(api.floatColor({red:255,green:100,blue:0}),null);
  assert.equal(api.foregroundCommand([4,.1,0]).to.redFloat,4);
  assert.throws(()=>api.foregroundCommand([NaN,0,0]));
});
test('foreground commits serialize, discard superseded requests and guard document races',async () => {
  let documentId=4, color=[.1,.2,.3], writes=[], modalCount=0;
  const w=writer({documentId:()=>documentId,read:async()=>color,write:async v=>{color=v;writes.push(v);},modal:async cb=>{modalCount++;return cb();}});
  const stale=w.commit(4,[4,2,1]), latest=w.commit(4,[8,3,1]);
  assert.equal((await stale).applied,false); assert.equal((await latest).applied,true);
  assert.deepEqual(writes,[[8,3,1]]); assert.equal(modalCount,1);
  const race=w.commit(4,[9,3,1]); documentId=5;
  assert.equal((await race).applied,false); assert.equal(writes.length,1);
  const canceled=w.commit(5,[9,3,1]); w.cancel(); assert.equal((await canceled).applied,false);
});
test('modal callbacks returning nothing still acknowledge HDR float32 readback',async () => {
  let color=[.1,.2,.3];const requested=[4.23456789,-.0123456789,100.1234567],events=[];
  const w=writer({documentId:()=>4,read:async()=>color,
    write:async v=>{color=v.map(Math.fround);return{};},modal:async cb=>{await cb();}});
  const result=await w.commit(4,requested,event=>events.push(event));
  assert.equal(result.applied,true);assert.deepEqual(result.foreground,requested.map(Math.fround));
  assert.ok(api.sameRGB(requested,result.foreground));assert.equal(events.at(-1).phase,'applied');
  assert.equal(api.sameRGB(null,null),true);assert.equal(api.sameRGB(null,requested),false);
});
test('cancellation while modal acquisition is pending prevents the callback from writing',async () => {
  let release,entered,writes=0;
  const acquired=new Promise(resolve=>entered=resolve),gate=new Promise(resolve=>release=resolve);
  const w=writer({documentId:()=>4,read:async()=>[.1,.2,.3],write:async()=>{writes++;},
    modal:async cb=>{entered();await gate;await cb();}});
  const commit=w.commit(4,[4,2,1]);await acquired;w.cancel();release();
  assert.equal((await commit).applied,false);assert.equal(writes,0);
});
test('native foreground conversion preserves HDR and negative floats without interpreting HSB in JavaScript',async () => {
  const fixture=JSON.parse(await fs.readFile(new URL('./fixtures/photoshop-hsb.json',import.meta.url),'utf8'));
  let calls=0;
  // The input is captured. This deliberately over-range native response is a
  // synthetic transport test, not a measured conversion of the captured HSB.
  const converted={_obj:'RGBColor',redFloat:4.5,greenFloat:-.02,blueFloat:8};
  const result=await api.readForeground(fixture.foregroundDescriptor,(color,model)=>{
    calls++;assert.deepEqual(color,fixture.foregroundDescriptor.foregroundColor);
    assert.equal(model,15);return converted;
  });
  assert.equal(calls,1);assert.deepEqual(result.foreground,[4.5,-.02,8]);
  assert.deepEqual(result.conversion.descriptor,converted);assert.equal(result.error,undefined);
  const direct=await api.readForeground({foregroundColor:converted},()=>{throw Error('must bypass conversion');});
  assert.deepEqual(direct.foreground,result.foreground);assert.equal(direct.conversion,undefined);
});
test('failed or integer-only native conversion remains diagnostic and never masquerades as linear floats',async () => {
  const input={foregroundColor:{_obj:'HSBColorClass',hue:{_unit:'angleUnit',_value:60},saturation:81,brightness:79}};
  for(const converted of [{_obj:'RGBColor',red:255,green:255,blue:128},{redFloat:NaN,greenFloat:1,blueFloat:1},null]) {
    const result=await api.readForeground(input,()=>converted);
    assert.equal(result.foreground,null);assert.match(result.error,/HSBColorClass.*floating-point/);
    assert.deepEqual(result.conversion.descriptor,converted);
  }
  const conversionError=Object.assign(Error('native conversion failed'),{number:1234});
  const propertyError={_obj:'error',message:'native RGB property failed',result:-1};
  const failed=await api.readForeground(input,()=>{throw conversionError;},
    {rgbProperty:async()=>{throw Object.assign(Error(propertyError.message),{descriptor:propertyError});}});
  assert.equal(failed.foreground,null);assert.match(failed.conversion.error,/native conversion failed/);
  assert.deepEqual(failed.conversion.descriptor,{number:1234});assert.deepEqual(failed.rgbProperty.descriptor,propertyError);
});
test('a clamping host triggers rollback instead of a silently different foreground',async () => {
  const original=[.1,.2,.3]; let color=original;
  const w=writer({documentId:()=>1,read:async()=>color,write:async v=>{color=v.map(n=>Math.min(n,1));},modal:cb=>cb()});
  await assert.rejects(w.commit(1,[4,2,1]),/restored/); assert.deepEqual(color,original);
});
test('a document switch during an asynchronous foreground read prevents the write',async () => {
  let documentId=1,writes=0;
  const w=writer({documentId:()=>documentId,read:async()=>{documentId=2;return [.1,.1,.1];},write:async()=>{writes++;},modal:cb=>cb()});
  assert.equal((await w.commit(1,[3,2,1])).applied,false);assert.equal(writes,0);
});
test('native RGB descriptor units are explicit, aliases retain zero, and mixed channels are rejected',()=>{
  for(const key of ['green','grain']) {
    const descriptor={foregroundColorRGB:{_obj:'RGBColor',red:200.9,[key]:0,blue:38.1}};
    assert.deepEqual(api.classifyColor(descriptor),{kind:'ordinary',rgb:[200.9,0,38.1]});
    assert.equal(api.floatColor(descriptor),null);
  }
  assert.deepEqual(api.classifyColor({RGBFloatColor:{red:255,grain:100,blue:0}}),{kind:'ordinary',rgb:[255,100,0]},'wrapper name does not prove float units');
  assert.equal(api.classifyColor({red:1,green:1,grain:2,blue:1}).kind,'invalid');
  assert.equal(api.classifyColor({redFloat:1,green:1,blueFloat:1}).kind,'invalid');
  assert.equal(api.classifyColor({redFloat:Infinity,greenFloat:1,blueFloat:1}).kind,'invalid');
  assert.deepEqual(api.floatColor({foregroundColorRGB:{redFloat:8,greenFloat:0,blueFloat:-.02}}),[8,0,-.02]);
  assert.equal(api.foregroundSignature({foregroundColor:{red:2,grain:0,blue:1}}),api.foregroundSignature({foregroundColor:{blue:1,green:0,red:2}}));
});

test('native RGB property is read before conversion or pixel sampling and preserves HDR floats',async()=>{
  const descriptor={foregroundColor:{_obj:'HSBColorClass',hue:{_unit:'angleUnit',_value:60},saturation:80,brightness:78}};
  const result=await api.readForeground(descriptor,()=>{throw Error('must not convert');},{
    rgbProperty:async()=>({foregroundColorRGB:{_obj:'RGBColor',redFloat:4.5,greenFloat:-.02,blueFloat:0}}),
    sample:async()=>{throw Error('must not sample');},
  });
  assert.deepEqual(result.foreground,[4.5,-.02,0]);assert.equal(result.source,'rgb-property');
  assert.deepEqual(result.descriptor,descriptor);assert.equal(result.conversion,undefined);
});

const syntheticSample=(foreground=[3.25,.45,-.01])=>({documentId:59,foreground,sourceDepth:32,sourceProfile:'ACEScg',
  componentSize:32,components:4,colorSpace:'RGB',colorProfile:'ACEScg (Linear RGB Profile)',width:1,height:1,alpha:1,
  cleanup:{closed:true,sourceRestored:true,autoCloseRegistered:true,imageDataDisposed:true},stages:[]});
test('actual HSB-to-ordinary-RGB capture falls back to native painting rather than RGB normalization',async()=>{
  const fixture=JSON.parse(await fs.readFile(new URL('./fixtures/photoshop-hsb-ordinary-rgb.json',import.meta.url),'utf8'));
  assert.equal(api.classifyColor(fixture.foregroundConversion.descriptor).kind,'ordinary');
  let samples=0;
  // This sample is synthetic. The fixture captures conversion output only;
  // these are not claimed to be the measured floats for its HSB color.
  const sample=syntheticSample();
  const result=await api.readForeground(fixture.foregroundDescriptor,(_color,model)=>{
    assert.equal(model,fixture.foregroundConversion.targetModel);return fixture.foregroundConversion.descriptor;
  },{rgbProperty:async()=>{throw Error('property unavailable');},sample:async()=>{samples++;return sample;}});
  assert.equal(samples,1);assert.equal(result.source,'paint-sample');assert.deepEqual(result.foreground,sample.foreground);
  assert.deepEqual(result.conversion,fixture.foregroundConversion);assert.match(result.rgbProperty.error,/property unavailable/);
  assert.notDeepEqual(result.foreground,[fixture.foregroundConversion.descriptor.red/255,fixture.foregroundConversion.descriptor.grain/255,fixture.foregroundConversion.descriptor.blue/255]);
});

test('native samples must prove float depth, profile, pixel shape, opacity and complete cleanup',async()=>{
  for(const patch of [{componentSize:16},{sourceDepth:16},{sourceProfile:'sRGB IEC61966-2.1'},{colorProfile:'sRGB IEC61966-2.1'},
    {width:2},{components:1},{alpha:.5},{alpha:NaN},{alpha:undefined},{foreground:[NaN,1,1]},{error:'cancelled'},
    ...['closed','sourceRestored','autoCloseRegistered','imageDataDisposed'].map(key=>({cleanup:{...syntheticSample().cleanup,[key]:false}}))]) {
    const sample={...syntheticSample(),...patch};
    assert.equal(api.validForegroundSample(sample),false);
    const reading=await api.readForeground({_obj:'RGBColor',red:255,green:100,blue:0},()=>null,{sample:async()=>sample});
    assert.equal(reading.foreground,null);assert.ok(reading.error);
  }
  assert.equal(api.isACEScgProfile('ACEScg (Linear Profile)'),true);
  assert.equal(api.isACEScgProfile('ACEScg display'),false);
});

test('a partially applied native write restores its original HSB descriptor and preserves the native error',async()=>{
  const native={_obj:'HSBColorClass',hue:{_unit:'angleUnit',_value:60},saturation:81,brightness:79};
  const previous={foreground:[.3,.2,.1],descriptor:{foregroundColor:native}};
  let color=previous.foreground,restoreCount=0;const events=[];
  const w=writer({documentId:()=>59,read:async()=>({...previous,foreground:color}),
    write:async()=>{color=[4,2,1];throw Object.assign(Error('Native partial set'),{descriptor:{_obj:'error',result:-25920}});},
    restore:async backup=>{restoreCount++;assert.deepEqual(api.nativeForegroundCommand(backup.descriptor).to,native);color=previous.foreground;},
    modal:async cb=>{await cb();}});
  await assert.rejects(w.commit(59,[4,2,1],event=>events.push(event)),error=>{
    assert.match(error.message,/Native partial set.*previous foreground was restored/);
    assert.deepEqual(error.descriptor,{_obj:'error',result:-25920});return true;
  });
  assert.equal(restoreCount,1);assert.deepEqual(color,previous.foreground);
  assert.deepEqual(events.find(event=>event.phase==='restore-requested').command.to,native);
});

test('readback exceptions restore the native foreground but a different document prevents restoration',async()=>{
  let color=[.1,.2,.3],reads=0,restores=0,id=1;
  const w=writer({documentId:()=>id,read:async()=>{if(++reads===2)throw Error('Native readback failed');return color;},
    write:async rgb=>{color=rgb;},restore:async previous=>{restores++;color=previous.foreground;},modal:async cb=>{await cb();}});
  await assert.rejects(w.commit(1,[4,2,1]),/readback failed.*previous foreground was restored/);
  assert.equal(restores,1);assert.deepEqual(color,[.1,.2,.3]);
  reads=0;const changed=writer({documentId:()=>id,read:async()=>color,write:async rgb=>{color=rgb;id=2;},
    restore:async()=>{restores++;},modal:async cb=>{await cb();}});
  await assert.rejects(changed.commit(1,[4,2,1]),/restoration was not attempted in another document/);
  assert.equal(restores,1);
});

test('shipping bundle is offline and contains only local entry points',async () => {
  const plugin=path.join(process.env.EXT_PLUGIN,'plugin');
  const manifest=JSON.parse(await fs.readFile(path.join(plugin,'manifest.json'),'utf8'));
  assert.equal(manifest.manifestVersion,5); assert.equal(manifest.host.minVersion,'27.0.0');
  assert.deepEqual(manifest.requiredPermissions.webview.domains,[]);
  for(const file of ['panel.html','panel.css','host.js','web/index.html','web/app.js','web/style.css'])assert.ok((await fs.stat(path.join(plugin,file))).size>0);
  const source=await fs.readFile(path.join(plugin,'web/app.js'),'utf8');
  assert.ok(!source.includes('fetch(')); assert.ok(!source.includes('sourceMappingURL'));
  const rust=await fs.readFile(path.join(process.env.EXT_ROOT,'color/lib.rs'),'utf8');
  assert.ok(!rust.includes('../../'));
});

test('constant-color preview optimization preserves every legacy PNG byte',() => {
  const cases=[[[.18333333333,2.03,10], [.02,.15,.7]], [[-1,100,1e50],[Infinity,NaN,-Infinity]], [[0,0,0],[.1,.1,.1]]];
  for(const view of [0,1,2,4])for(const valid of [false,true])for(const [foreground,background] of cases){
    const pixels=new Float32Array(256*256*3);
    for(let y=0;y<256;y++)for(let x=0;x<256;x++){
      const inside=x>=35&&x<221&&y>=35&&y<221;
      const cross=inside&&!valid&&x>=50&&x<206&&y>=50&&y<206&&(Math.abs(x-y)<=4||Math.abs(x+y-255)<=4);
      pixels.set(cross?[.86,.058,.058]:inside?(valid?foreground:[0,0,0]):background,(y*256+x)*3);
    }
    const timings={},optimized=api.encodePreview(view,foreground,background,valid,timings);
    assert.deepEqual(optimized,api.encodeLinearRgbPng(view,256,256,pixels),`view ${view}, valid ${valid}`);
    for(const name of ['packMs','compressMs','pngMs'])assert.ok(Number.isFinite(timings[name])&&timings[name]>=0,name);
  }
});

test('sender bounds blocked-worker work, snapshots inputs, and drains after stale replies and failures',() => {
  const previous=globalThis.Worker,workers=[],received=[],failures=[];
  globalThis.Worker=class{
    constructor(){this.sent=[];workers.push(this);}
    postMessage(message){this.sent.push(message);}
    terminate(){this.terminated=true;}
    emit(message){this.onmessage({data:message});}
  };
  const lane=new api.LatestWorker('','test',['render'],m=>received.push(m.id),error=>failures.push(error));
  try{
    const code=[.4,.5,.5];
    for(let id=1;id<=12;id++){code[0]=id/100;lane.submit({type:'render',id,epoch:0,view:0,code,full:true,interacting:true,key:String(id)});}
    code[0]=9;
    assert.deepEqual(workers[0].sent.map(m=>m.id),[1]);assert.equal(lane.snapshot().maxPending,1);
    workers[0].emit({type:'render',id:1});
    assert.deepEqual(workers[0].sent.map(m=>m.id),[1,12]);assert.equal(workers[0].sent[1].code[0],.12);
    workers[0].emit({type:'render',id:1});assert.equal(lane.snapshot().active,12,'duplicate old reply cannot settle current job');
    workers[0].emit({type:'error',id:12,message:'synthetic failure'});assert.equal(lane.snapshot().active,null);
    lane.submit({type:'render',id:13,epoch:0,view:0,code,full:true,interacting:false,key:'13'});
    workers[0].onerror({message:'crash'});assert.equal(workers[0].terminated,true);assert.equal(failures.length,1);
    lane.submit({type:'render',id:14,epoch:0,view:0,code,full:true,interacting:false,key:'14'});
    assert.equal(workers.length,2);workers[1].emit({type:'render',id:14});
    assert.deepEqual(received,[1,12,14]);
    lane.destroy();lane.submit({type:'render',id:15});assert.equal(workers[1].sent.length,1);
  }finally{lane.destroy();globalThis.Worker=previous;}
});

test('preview work replaces obsolete requests and runs ahead of checker encoding',() => {
  const previous=globalThis.Worker,workers=[];
  globalThis.Worker=class{constructor(){this.sent=[];workers.push(this);}postMessage(m){this.sent.push(m);}terminate(){}};
  const lane=new api.LatestWorker('','test',['preview','checker-png'],()=>{},()=>{});
  try{
    for(const [id,type] of [[1,'preview'],[2,'checker-png'],[3,'preview'],[4,'preview']])lane.submit({id,type,epoch:0,view:0});
    assert.equal(lane.snapshot().maxPending,2);
    workers[0].onmessage({data:{type:'preview',id:1}});assert.equal(workers[0].sent[1].id,4);
    workers[0].onmessage({data:{type:'preview',id:4}});assert.equal(workers[0].sent[2].id,2);
    lane.destroy();assert.equal(lane.snapshot().pending.length,0);
  }finally{lane.destroy();globalThis.Worker=previous;}
});

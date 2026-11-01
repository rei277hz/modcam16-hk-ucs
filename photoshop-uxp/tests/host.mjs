// Synthetic Photoshop/UXP transport plus real redacted input and ordinary
// conversion descriptors. Other conversions and all pixels remain mocks;
// these tests do not establish actual native painting or float readback.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
const source=await fs.readFile(path.join(process.env.EXT_PLUGIN,'plugin/host.js'),'utf8');
const captured=JSON.parse(await fs.readFile(new URL('./fixtures/photoshop-hsb.json',import.meta.url),'utf8'));
const ordinary=JSON.parse(await fs.readFile(new URL('./fixtures/photoshop-hsb-ordinary-rgb.json',import.meta.url),'utf8'));
const manifest=JSON.parse(await fs.readFile(path.join(process.env.EXT_PLUGIN,'plugin/manifest.json'),'utf8'));
function host({observer=true,grip=true}={}){
  const state={id:7,rgb:[.18,.18,.18],view:'ACES 2.0 - HDR 1000 nits (Rec.2020)',float:true,
    foreground:null,conversions:[],conversionError:null,conversionResult:null,rgbProperty:null,scheme:'dark',
    sourceDepth:32,sourceProfile:'ACEScg',probeProfile:'ACEScg (Linear RGB Profile)',probeComponentSize:32,
    probeError:null,beforeProbe:null,probeCalls:[],probes:0,disposals:0,autoClosed:0,partialWriteError:null,closeActivatesOwner:false,
    getError:null,writeError:null,modalError:null,clamp:false,beforeCommand:null,modalOptions:[],
    colors:{background:'rgb(50, 50, 50)',foreground:'rgb(240, 240, 240)',border:'rgb(35, 35, 35)',secondary:'rgb(185, 185, 185)',hoverBackground:'rgb(70, 70, 70)'},
    bounds:{width:340,height:360},observers:[],attributes:[],gripCalls:[],gripError:null,beforeGrip:null,
    calls:[],messages:[],modal:0,add:0,remove:0,timers:new Map(),saved:null};
  let panel, notification;
  const documents=new Map(),nativeColors=new Map();let nextDocument=100;
  function doc(id,owner=null) {
    const temporary=owner!==null;
    const document={id,width:1024,height:512,dirty:false,history:4,layers:[{id:20}],activeLayers:[{id:20}],
      selection:{bounds:{left:10,top:10,right:20,bottom:20},async deselect(){
        assert.ok(temporary,'sampling must never change the source selection');
        await probe('deselect',id);this.bounds=null;
      }},async duplicate(name,merged){
        assert.equal(state.modal,1);assert.equal(merged,true);assert.equal(state.id,id);
        await probe('duplicate',id);state.probes++;
        const copy=doc(++nextDocument,id);documents.set(copy.id,copy);state.id=copy.id;return copy;
      },async crop(bounds){
        assert.ok(temporary,'sampling must never crop the source');assert.equal(state.id,id);
        await probe('crop',id);assert.deepEqual(JSON.parse(JSON.stringify(bounds)),{left:0,top:0,right:1,bottom:1});
        this.width=1;this.height=1;this.dirty=true;this.history++;
      },async createPixelLayer(){
        assert.ok(temporary,'sampling must never create a source layer');assert.equal(state.id,id);
        await probe('layer',id);const layer={id:30,owner:id};this.layers.push(layer);this.activeLayers=[layer];return layer;
      },async close(option){
        assert.ok(temporary,'sampling must never close the source');assert.equal(option,'dontSave');
        await probe('close',id);documents.delete(id);if(state.id===id||state.closeActivatesOwner)state.id=owner;
      }};
    return document;
  }
  function active() {if(!documents.has(state.id))documents.set(state.id,doc(state.id));return documents.get(state.id);}
  async function probe(phase,id) {
    state.probeCalls.push({phase,id});await state.beforeProbe?.(phase,id);
    if(state.modalContext?.isCancelled)throw Error('Synthetic foreground sampling cancelled');
    if(state.probeError===phase)throw Error(`Synthetic native ${phase} failed`);
  }
  active();
  const listeners=new Map(),themeProbe={};
  const rootListeners=new Map();
  const body={getBoundingClientRect:()=>state.bounds,
    addEventListener(type,fn){if(!rootListeners.has(type))rootListeners.set(type,new Set());rootListeners.get(type).add(fn);},
    removeEventListener(type,fn){rootListeners.get(type)?.delete(fn);}};
  const webview={style:{},postMessage:m=>state.messages.push(JSON.parse(JSON.stringify(m))),
    setAttribute(name,value){state.attributes.push({name,value});this[name]=value;},
    getBoundingClientRect(){return{width:Number.parseFloat(this.width??'300px'),height:Number.parseFloat(this.height??'150px')};}};
  class FakeResizeObserver {
    constructor(callback){this.callback=callback;this.connected=false;state.observers.push(this);}
    observe(root){assert.ok(root);this.target=root;this.connected=true;}
    disconnect(){this.connected=false;}
  }
  const action={async batchPlay([command]){
    state.calls.push(command);
    await state.beforeCommand?.(command);
    if(command._obj==='get'&&command._target[0]._ref==='document')return [{documentID:command._target[0]._id,
      depth:state.sourceDepth,profile:state.sourceProfile,openColorIO:{view:state.view}}];
    if(command._obj==='get'&&command._target[0]._property==='foregroundColorRGB')return [
      state.rgbProperty??{_obj:'error',message:'Synthetic RGB property unavailable',result:-1}];
    if(command._obj==='get') {
      const color=state.foreground??(state.float?{redFloat:state.rgb[0],greenFloat:state.rgb[1],blueFloat:state.rgb[2]}:
        {_obj:'RGBColor',red:128,green:128,blue:128});
      nativeColors.set(JSON.stringify(color),[...state.rgb]);return [state.getError??{foregroundColor:color}];
    }
    if(command._obj==='select') {
      assert.ok(state.id>=100,'composite channel selection must target the duplicate');return [{}];
    }
    if(command._obj==='fill') {
      assert.equal(state.modal,1);assert.ok(state.id>=100,'native Fill must never target the source');
      assert.equal(command.using._value,'foregroundColor');assert.equal(command.opacity._value,100);
      assert.equal(command.preserveTransparency,false);
      assert.equal(command.mode._value,'normal');await probe('fill',state.id);active().pixel=[...state.rgb,1];return [{}];
    }
    assert.equal(command._obj,'set');
    assert.ok(state.modal>0,'foreground mutation must be modal');
    assert.deepEqual(JSON.parse(JSON.stringify(command._target)),[{_ref:'color',_property:'foregroundColor'}]);
    if(state.writeError)return [state.writeError];
    if(command.to.redFloat!==undefined) {
      assert.equal(command.to._obj,'RGBColor');
      assert.deepEqual(Object.keys(command.to).sort(),['_obj','blueFloat','greenFloat','redFloat']);
      state.rgb=[command.to.redFloat,command.to.greenFloat,command.to.blueFloat].map(v=>state.clamp?Math.max(0,Math.min(1,v)):v);
      state.foreground=null;
      if(state.partialWriteError){const error=state.partialWriteError;state.partialWriteError=null;return[error];}
    } else {
      assert.ok(nativeColors.has(JSON.stringify(command.to)),'restore must use an actual native backup');
      state.rgb=nativeColors.get(JSON.stringify(command.to));state.foreground=command.to;
    }
    return [{}];
  },addNotificationListener(events,fn){state.add++;notification=fn;},removeNotificationListener(){state.remove++;}};
  const photoshop={app:{get documents(){if(state.id===null)return[];active();return[...documents.values()];},
      get activeDocument(){return active();},set activeDocument(value){assert.equal(state.modal,1);state.id=value.id;}},action,
    constants:{SaveOptions:{DONOTSAVECHANGES:'dontSave'}},imaging:{async getPixels(options){
      assert.equal(state.modal,1);assert.ok(options.documentID>=100);assert.equal(options.documentID,state.id);
      assert.equal(options.componentSize,32);assert.equal(options.colorProfile,undefined,'keep native source profile');
      await probe('getPixels',state.id);const pixel=active().pixel;
      return{imageData:{componentSize:state.probeComponentSize,components:4,colorSpace:'RGB',colorProfile:state.probeProfile,
        width:1,height:1,async getData(){await probe('getData',options.documentID);return new Float32Array(pixel);},
        dispose(){state.disposals++;}}};
    }},
    core:{suppressResizeGripper:grip?async options=>{
      assert.equal(state.modal,0,'requesting the native grip must not acquire a color modal scope');
      state.gripCalls.push(JSON.parse(JSON.stringify(options)));await state.beforeGrip?.();
      if(state.gripError)throw Error(state.gripError);
    }:undefined,convertColor(color,model){
      state.conversions.push({color,model});if(state.conversionError)throw Error(state.conversionError);
      return state.conversionResult??(state.float?{_obj:'RGBColor',redFloat:state.rgb[0],greenFloat:state.rgb[1],blueFloat:state.rgb[2]}:color);
    },async executeAsModal(callback,options){
      state.modalOptions.push(options);assert.equal(options.timeOut,1,'Photoshop timeout uses seconds');
      if(state.modalError)throw Object.assign(new Error(state.modalError),{number:9});
      assert.equal(state.modal,0,'never acquire a nested native modal scope');
      const registered=new Set(),context={isCancelled:false,hostControl:{
        async registerAutoCloseDocument(id){registered.add(id);},async unregisterAutoCloseDocument(id){registered.delete(id);}}};
      state.modal++;state.modalContext=context;
      try{await callback(context);}finally{
        for(const id of registered)if(documents.has(id)){documents.delete(id);state.autoClosed++;if(state.id===id)state.id=7;}
        state.modal--;state.modalContext=null;
      }
    }}};
  const uxp={host:{version:'27.11.0'},entrypoints:{setup(config){panel=config.panels.picker;}},storage:{localFileSystem:{async getFileForSaving(){return{async write(text){state.saved=JSON.parse(text);}};}}}};
  vm.runInNewContext(source,{require:name=>name==='photoshop'?photoshop:uxp,
    document:{body,getElementById:id=>id==='theme-probe'?themeProbe:webview},
    ResizeObserver:observer?FakeResizeObserver:undefined,
    window:{addEventListener(type,fn){if(!listeners.has(type))listeners.set(type,new Set());listeners.get(type).add(fn);},
      removeEventListener(type,fn){listeners.get(type)?.delete(fn);},matchMedia:query=>({matches:query===`(prefers-color-scheme: ${state.scheme})`})},
    getComputedStyle:element=>element===body?{backgroundColor:state.colors.background,color:state.colors.foreground,borderTopColor:state.colors.border}:
      {backgroundColor:state.colors.hoverBackground,color:state.colors.secondary},
    setInterval:fn=>{state.timers.set(1,fn);return 1;},clearInterval:id=>state.timers.delete(id),console});
  const dispatch=(type,event)=>Promise.all([...listeners.get(type)??[]].map(fn=>fn(event)));
  return{state,panel,root:body,webview,listeners,rootListeners,documents,source:documents.get(7),
    send:(data,sender=webview)=>dispatch('message',{source:sender,data}),
    async refresh(){await dispatch('message',{source:webview,data:{type:'refresh'}});},
    resize(width,height){state.bounds={width,height};for(const o of state.observers)if(o.connected)o.callback([{target:o.target,contentRect:o.target.getBoundingClientRect()}]);},
    resized:()=>dispatch('resize',{}),
    rootResized:()=>Promise.all([...rootListeners.get('resize')??[]].map(fn=>fn({}))),
    notification:()=>notification?.()};
}

test('shipping host bundle starts once, polls context, and removes listeners on hide',async()=>{
  const h=host();h.panel.show(h.root);h.panel.show(h.root);
  await h.send({type:'ready'},{});assert.equal(h.state.messages.length,0,'reject another message source');
  await h.send({type:'ready'});
  assert.equal(h.state.add,1);assert.equal(h.state.timers.size,1);
  const c=h.state.messages.at(-1).context;
  assert.deepEqual(c.foreground,[.18,.18,.18]);assert.equal(c.view,0);assert.equal(c.fallback,false);
  h.panel.hide();assert.equal(h.state.remove,1);assert.equal(h.state.timers.size,0);
  h.panel.show(h.root);assert.equal(h.state.add,2);h.panel.hide();
});
test('shipping bridge commits HDR floats in a modal and discards another document ID',async()=>{
  const h=host();h.panel.show(h.root);await h.send({type:'ready'});
  await h.send({type:'commit',id:3,documentId:7,scene:[4.5,2,.1]});
  assert.deepEqual(h.state.rgb,[4.5,2,.1]);
  assert.ok(h.state.messages.some(m=>m.type==='committed'&&m.id===3&&m.applied));
  const sets=h.state.calls.filter(c=>c._obj==='set').length;
  h.state.id=9;await h.send({type:'commit',id:4,documentId:7,scene:[8,2,.1]});
  assert.equal(h.state.calls.filter(c=>c._obj==='set').length,sets);
  assert.equal(h.state.messages.find(m=>m.type==='committed'&&m.id===4).applied,false);
  h.panel.hide();
});
test('shipping bridge follows view changes and fails closed without float descriptors',async()=>{
  const h=host();h.panel.show(h.root);await h.send({type:'ready'});
  h.state.view='ACES 2.0 - SDR 100 nits (P3 D65)';await h.refresh();
  assert.equal(h.state.messages.at(-1).context.view,4);
  h.state.view='Raw';h.state.float=false;h.state.probeError='fill';await h.refresh();
  const c=h.state.messages.at(-1).context;assert.equal(c.view,0);assert.equal(c.fallback,true);assert.equal(c.foreground,null);
  await h.send({type:'commit',id:5,documentId:7,scene:[4,1,.1]});
  assert.match(h.state.messages.find(m=>m.type==='committed'&&m.id===5).error,/floating-point/);
  assert.equal(h.state.calls.filter(c=>c._obj==='set').length,0);h.panel.hide();
});
test('diagnostics preserve raw descriptors and explicitly leave visual validation pending',async()=>{
  const h=host();h.panel.show(h.root);await h.send({type:'ready'});
  await h.send({type:'diagnostics',capabilities:{renderer:'WebGPU',fixture:'synthetic'}});
  assert.equal(h.state.saved.schema,4);assert.equal(h.state.saved.foregroundDescriptor.foregroundColor.redFloat,.18);
  assert.deepEqual(h.state.saved.extension,{id:manifest.id,version:manifest.version});
  assert.equal(h.state.saved.bridge.ready,true);assert.ok(h.state.saved.bridge.received>=2);
  assert.deepEqual(h.state.saved.transactions,[]);
  assert.equal(h.state.saved.photoshop,'27.11.0');assert.equal(h.state.saved.theme.background,h.state.colors.background);
  assert.deepEqual(h.state.saved.layout.panel,{width:340,height:360});
  assert.deepEqual(h.state.saved.layout.webview,{width:340,height:340});
  assert.deepEqual(h.state.saved.layout.appliedWebview,{width:340,height:340});
  assert.deepEqual(h.state.saved.layout.resizeGrip,{requestedVisible:true,status:'applied',nativeStripHeight:20});
  assert.equal(h.state.saved.layout.configuration.minimumSize,undefined);
  assert.deepEqual(h.state.saved.layout.configuration.maximumSize,{width:10000,height:10000});
  assert.ok(h.state.saved.layout.recentResizes.length>0&&h.state.saved.layout.recentResizes.length<=8);
  assert.match(h.state.saved.verification,/still require/);h.panel.hide();
});

test('native WebView tracks independent root width and height changes without resize feedback',async()=>{
  const h=host();h.panel.show(h.root);await h.send({type:'ready'});
  assert.equal(h.state.observers.length,1);assert.equal(h.listeners.get('resize').size,1);
  for(const [width,height] of [[800,360],[800,800],[280,800],[280,180],[1000,800],[120,40]]) {
    const count=h.state.attributes.length;h.resize(width,height);
    const webHeight=height-Math.min(20,height/4);
    assert.equal(h.webview.width,`${width}px`);assert.equal(h.webview.height,`${webHeight}px`);
    assert.equal(h.webview.style.width,`${width}px`);assert.equal(h.webview.style.height,`${webHeight}px`);
    assert.equal(h.state.attributes.length,count+2);
    h.resize(width,height);await h.resized();
    assert.equal(h.state.attributes.length,count+2,'unchanged allocations must not reapply sizes');
  }
  const count=h.state.attributes.length;
  for(const [width,height] of [[0,800],[1000,0],[NaN,800],[Infinity,800]])h.resize(width,height);
  assert.equal(h.state.attributes.length,count,'zero or nonfinite allocations must not collapse the native WebView');
  h.resize(340.9,360.4);assert.equal(h.webview.width,'340px');assert.equal(h.webview.height,'340px');
  h.panel.hide();
});
test('sizing observation reconnects once, adopts a new root, and cleans up on hide and destroy',async()=>{
  const h=host();h.panel.show(h.root);h.panel.show(h.root);await h.send({type:'ready'});
  assert.equal(h.state.observers.length,1);
  const old=h.state.observers[0],count=h.state.attributes.length;
  h.panel.hide();assert.equal(old.connected,false);assert.equal(h.listeners.get('resize').size,0);
  assert.equal(h.rootListeners.get('resize').size,0);
  h.resize(700,400);old.callback([]);await h.send({type:'ready'});
  assert.equal(h.state.attributes.length,count,'late observer and ready callbacks must not resurrect a hidden panel');
  h.panel.show(h.root);assert.equal(h.state.observers.length,2);assert.equal(h.listeners.get('resize').size,1);
  assert.equal(h.webview.width,'700px');assert.equal(h.webview.height,'380px');
  assert.equal(h.rootListeners.get('resize').size,1);
  const replacement={getBoundingClientRect:()=>({width:900,height:600})};
  h.panel.show(replacement);assert.equal(h.state.observers[1].connected,false);
  assert.equal(h.state.observers[2].target,replacement);assert.equal(h.webview.width,'900px');
  h.panel.destroy();assert.equal(h.state.observers[2].connected,false);assert.equal(h.listeners.get('resize').size,0);
  assert.equal(h.state.timers.size,0);assert.equal(h.state.remove,2);
});
test('resize events and existing polling keep sizing usable if ResizeObserver is unavailable',async()=>{
  const h=host({observer:false});h.panel.show(h.root);await h.send({type:'ready'});
  h.state.bounds={width:650,height:500};await h.resized();
  assert.equal(h.webview.width,'650px');assert.equal(h.webview.height,'480px');
  h.state.bounds={width:540,height:200};await h.rootResized();
  assert.equal(h.webview.width,'540px');assert.equal(h.webview.height,'180px');
  h.state.bounds={width:600,height:350};await h.refresh();
  assert.equal(h.webview.width,'600px');assert.equal(h.webview.height,'330px');
  h.panel.hide();assert.equal(h.listeners.get('resize').size,0);
});

test('native grip requests target the panel on show and readiness and retain bounded resize evidence',async()=>{
  const h=host({observer:false});h.panel.show(h.root);h.panel.show(h.root);
  await h.send({type:'ready',id:1});await h.send({type:'ready',id:1});
  assert.deepEqual(h.state.gripCalls,Array(2).fill({type:'panel',target:'picker',value:false}));
  for(let i=0;i<12;i++){
    h.state.bounds={width:280+i,height:180+i};await h.rootResized();
  }
  await h.send({type:'diagnostics'});
  const layout=h.state.saved.layout;
  assert.equal(layout.recentResizes.length,8);
  assert.ok(layout.recentResizes.every(event=>event.source==='root-resize'&&event.nativeStripHeight===20));
  assert.equal(layout.resizeGrip.status,'applied');
  assert.equal(layout.webview.height,layout.panel.height-20);
  assert.equal(h.state.calls.filter(command=>command._obj==='set').length,0);
  h.panel.hide();assert.equal(h.rootListeners.get('resize').size,0);
});

test('missing or failed grip API stays diagnostic and cannot block foreground sync or release',async()=>{
  for(const grip of [false,true]){
    const h=host({grip});h.state.gripError='Synthetic grip API failure';
    h.panel.show(h.root);await h.send({type:'ready',id:1});
    await h.send({type:'commit',id:2,documentId:7,scene:[4,2,.1]});
    assert.equal(h.state.messages.find(message=>message.type==='committed'&&message.id===2).applied,true);
    await h.send({type:'diagnostics'});
    assert.equal(h.state.saved.layout.resizeGrip.status,grip?'failed':'unsupported');
    if(grip)assert.match(h.state.saved.layout.resizeGrip.error,/Synthetic grip API failure/);
    assert.deepEqual(h.state.saved.context.foreground,[4,2,.1]);h.panel.hide();
  }
});

test('late grip results cannot override a reopened panel or resurrect sizing after destroy',async()=>{
  const h=host();let release;
  const gate=new Promise(resolve=>release=resolve);
  h.state.beforeGrip=async()=>{await gate;throw Error('Stale grip failure');};
  h.panel.show(h.root);await h.send({type:'ready',id:1});
  h.panel.hide();h.state.beforeGrip=null;h.panel.show(h.root);await h.send({type:'ready',id:2});
  release();await Promise.resolve();await h.send({type:'diagnostics'});
  assert.equal(h.state.saved.layout.resizeGrip.status,'applied');
  assert.equal(h.state.saved.layout.resizeGrip.error,undefined);
  let finish;
  h.state.beforeGrip=()=>new Promise(resolve=>finish=resolve);
  h.panel.hide();h.panel.show(h.root);const count=h.state.attributes.length;
  h.panel.destroy();finish();await Promise.resolve();await Promise.resolve();
  assert.equal(h.state.attributes.length,count);assert.equal(h.state.timers.size,0);
});

test('captured HSB foreground synchronizes through native RGB conversion and supports the next HDR commit',async()=>{
  const h=host();h.state.foreground=captured.foregroundDescriptor.foregroundColor;
  // Mock response, not a numerical oracle for the captured input.
  h.state.rgb=[3.25,.45,.1];h.panel.show(h.root);await h.send({type:'ready'});
  const c=h.state.messages.at(-1).context;
  assert.deepEqual(c.foreground,[3.25,.45,.1]);assert.equal(c.error,undefined);
  assert.equal(h.state.conversions[0].model,15);
  assert.deepEqual(h.state.conversions[0].color,captured.foregroundDescriptor.foregroundColor);
  assert.equal(h.state.calls.filter(c=>c._obj==='set').length,0,'sync must not change the foreground');
  await h.send({type:'diagnostics',capabilities:{renderer:'WebGL2'}});
  assert.deepEqual(h.state.saved.foregroundDescriptor,captured.foregroundDescriptor);
  assert.equal(h.state.saved.foregroundConversion.targetModel,15);
  assert.equal(h.state.saved.foregroundConversion.descriptor.redFloat,3.25);
  await h.send({type:'commit',id:6,documentId:7,scene:[8,2,.5]});
  assert.deepEqual(h.state.rgb,[8,2,.5]);assert.ok(h.state.messages.some(m=>m.type==='committed'&&m.id===6&&m.applied));
  h.panel.hide();
});
test('conversion errors plus failed native sampling retain diagnostics and prevent a foreground write',async()=>{
  const h=host();h.state.foreground=captured.foregroundDescriptor.foregroundColor;h.state.conversionError='Unsupported native conversion';
  h.state.probeError='fill';
  h.panel.show(h.root);await h.send({type:'ready'});
  assert.match(h.state.messages.at(-1).context.error,/HSBColorClass/);
  await h.send({type:'commit',id:8,documentId:7,scene:[4,1,.1]});
  assert.equal(h.state.calls.filter(c=>c._obj==='set').length,0);
  await h.send({type:'diagnostics'});
  assert.match(h.state.saved.foregroundConversion.error,/Unsupported native conversion/);h.panel.hide();
});
test('Photoshop theme colors reach the WebView and update without a document',async()=>{
  const h=host();h.panel.show(h.root);await h.send({type:'ready'});
  assert.deepEqual(h.state.messages.find(m=>m.type==='theme').colors,{...h.state.colors,scheme:'dark'});
  h.state.id=null;h.state.scheme='lightest';
  h.state.colors={background:'rgb(240, 240, 240)',foreground:'rgb(25, 25, 25)',border:'rgb(200, 200, 200)',secondary:'rgb(80, 80, 80)',hoverBackground:'rgb(220, 220, 220)'};
  await h.refresh();
  assert.deepEqual(h.state.messages.findLast(m=>m.type==='theme').colors,{...h.state.colors,scheme:'light'});
  assert.equal(h.state.messages.at(-1).context.documentId,null);h.panel.hide();
});

test('capture validator accepts native float conversions and rejects lossy or incomplete captures',async()=>{
  const {execFile}=await import('node:child_process'),{promisify}=await import('node:util'),{tmpdir}=await import('node:os');
  const run=promisify(execFile),directory=await fs.mkdtemp(path.join(tmpdir(),'modcam16-captures-'));
  try {
    const files=[],views=['ACES 2.0 - HDR 1000 nits (Rec.2020)','ACES 2.0 - SDR 100 nits (Rec.709)','ACES 2.0 - HDR 1000 nits (P3 D65)','ACES 2.0 - SDR 100 nits (P3 D65)','Raw'];
    for(const [i,view] of views.entries()) {
      const file=path.join(directory,`${i}.json`),rgb={_obj:'RGBColor',redFloat:4,greenFloat:.2,blueFloat:.1};
      await fs.writeFile(file,JSON.stringify({schema:i===0?1:i===4?3:2,extension:i===4?{id:manifest.id,version:manifest.version}:undefined,
        transactions:i===4?[{requested:[4,.2,.1],outcome:{applied:true,foreground:[4,.2,.1]}}]:undefined,
        photoshop:'27.11.0',context:{foreground:[4,.2,.1]},
        documentDescriptor:{openColorIO:{view}},foregroundDescriptor:i===0?{foregroundColor:rgb}:captured.foregroundDescriptor,
        foregroundConversion:i===0?undefined:{targetModel:15,descriptor:rgb}}));files.push(file);
    }
    const args=[path.join(process.env.EXT_ROOT,'tools/validate_host.mjs'),'--plugin',process.env.EXT_PLUGIN,...files];
    assert.match((await run(process.execPath,args)).stdout,/Descriptor coverage passes/);
    const invalid=JSON.parse(await fs.readFile(files[1],'utf8'));
    invalid.foregroundConversion.descriptor={_obj:'RGBColor',red:255,green:255,blue:255};
    await fs.writeFile(files[1],JSON.stringify(invalid));
    await assert.rejects(run(process.execPath,args),error=>/neither the foreground nor its native RGB conversion/.test(error.stderr));
    delete invalid.photoshop;await fs.writeFile(files[1],JSON.stringify(invalid));
    await assert.rejects(run(process.execPath,args),error=>/unsupported diagnostics version\/host/.test(error.stderr));
    const transaction=JSON.parse(await fs.readFile(files[4],'utf8'));transaction.transactions[0].outcome.foreground=[1,1,1];
    await fs.writeFile(files[4],JSON.stringify(transaction));
    await assert.rejects(run(process.execPath,[path.join(process.env.EXT_ROOT,'tools/validate_host.mjs'),'--plugin',process.env.EXT_PLUGIN,files[4]]),error=>/does not match verified readback/.test(error.stderr));
  } finally {await fs.rm(directory,{recursive:true,force:true});}
});

test('ready requests are acknowledged by ID without duplicating refresh work',async()=>{
  const h=host();h.panel.show(h.root);
  await h.send({type:'ready',id:10});
  const gets=h.state.calls.length;
  await h.send({type:'ready',id:10});
  assert.equal(h.state.calls.length,gets);
  const replies=h.state.messages.filter(m=>m.type==='connected');
  assert.equal(replies.length,2);assert.equal(replies[0].id,10);
  assert.deepEqual(replies[0].extension,{id:manifest.id,version:manifest.version});h.panel.hide();
});

test('explicit sync replies survive a busy refresh and carry unchanged foregrounds by request ID',async()=>{
  const h=host();h.panel.show(h.root);await h.send({type:'ready',id:1});
  let release,started;
  const gate=new Promise(resolve=>release=resolve),entered=new Promise(resolve=>started=resolve);
  h.state.beforeCommand=async command=>{
    if(command._obj==='get'&&command._target[0]._ref==='document'){
      h.state.beforeCommand=null;started();await gate;
    }
  };
  const busy=h.refresh();await entered;
  const a=h.send({type:'refresh',id:20}),b=h.send({type:'refresh',id:21});
  release();await Promise.all([busy,a,b]);
  for(const id of [20,21]) {
    const reply=h.state.messages.find(m=>m.type==='context'&&m.requestId===id);
    assert.ok(reply);assert.equal(reply.forceImport,true);assert.deepEqual(reply.context.foreground,[.18,.18,.18]);
  }
  assert.equal(h.state.calls.filter(c=>c._obj==='set').length,0);h.panel.hide();
});

test('explicit sync cancels a queued commit before any mutation',async()=>{
  const h=host();h.panel.show(h.root);await h.send({type:'ready',id:1});
  let release,started;
  const gate=new Promise(resolve=>release=resolve),entered=new Promise(resolve=>started=resolve);
  h.state.beforeCommand=async command=>{if(command._obj==='get'){
    h.state.beforeCommand=null;started();await gate;
  }};
  const busy=h.refresh();await entered;
  const write=h.send({type:'commit',id:30,documentId:7,scene:[4,2,.1]});
  const sync=h.send({type:'refresh',id:31});release();await Promise.all([busy,write,sync]);
  assert.equal(h.state.calls.filter(c=>c._obj==='set').length,0);
  assert.equal(h.state.messages.find(m=>m.type==='committed'&&m.id===30).applied,false);
  assert.deepEqual(h.state.messages.find(m=>m.requestId===31).context.foreground,[.18,.18,.18]);h.panel.hide();
});

test('explicit sync waits for an active transaction and reads its verified HDR foreground',async()=>{
  const h=host();h.panel.show(h.root);await h.send({type:'ready',id:1});
  let release,started;
  const gate=new Promise(resolve=>release=resolve),entered=new Promise(resolve=>started=resolve);
  h.state.beforeCommand=async command=>{if(command._obj==='set'){
    h.state.beforeCommand=null;started();await gate;
  }};
  const write=h.send({type:'commit',id:40,documentId:7,scene:[4,2,-.01]});await entered;
  const sync=h.send({type:'refresh',id:41});release();await Promise.all([write,sync]);
  const result=h.state.messages.find(m=>m.type==='committed'&&m.id===40);
  assert.equal(result.applied,true);assert.deepEqual(result.foreground,[4,2,-.01]);
  assert.deepEqual(h.state.messages.find(m=>m.requestId===41).context.foreground,result.foreground);
  assert.equal(h.state.calls.filter(c=>c._obj==='set').length,1);h.panel.hide();
});

test('native acquisition and command errors produce failed replies with actual foreground and diagnostic evidence',async()=>{
  const h=host();h.panel.show(h.root);await h.send({type:'ready',id:1});
  h.state.modalError='Photoshop is busy in another modal scope';
  await h.send({type:'commit',id:50,documentId:7,scene:[4,2,.1]});
  let reply=h.state.messages.find(m=>m.type==='committed'&&m.id===50);
  assert.equal(reply.applied,false);assert.match(reply.error,/busy/);assert.deepEqual(reply.foreground,[.18,.18,.18]);
  h.state.modalError=null;h.state.writeError={_obj:'error',message:'Native set was rejected',result:-25920};
  await h.send({type:'commit',id:51,documentId:7,scene:[4,2,.1]});
  reply=h.state.messages.find(m=>m.type==='committed'&&m.id===51);
  assert.equal(reply.applied,false);assert.match(reply.error,/Native set/);
  await h.send({type:'diagnostics',capabilities:{fixture:'synthetic'}});
  const [modal,command]=h.state.saved.transactions;
  assert.equal(modal.events.find(e=>e.phase==='failed').result.number,9);
  assert.deepEqual(command.events.find(e=>e.phase==='failed').result,h.state.writeError);
  assert.equal(command.events.find(e=>e.phase==='write-requested').command.to.redFloat,4);h.panel.hide();
});

test('rollback is reported with restored floats and diagnostics keep only the last eight transactions',async()=>{
  const h=host();h.panel.show(h.root);await h.send({type:'ready',id:1});h.state.clamp=true;
  await h.send({type:'commit',id:60,documentId:7,scene:[4,2,.1]});
  const reply=h.state.messages.find(m=>m.type==='committed'&&m.id===60);
  assert.equal(reply.applied,false);assert.match(reply.error,/previous foreground was restored/);
  assert.deepEqual(reply.foreground,[.18,.18,.18]);
  await h.send({type:'diagnostics'});
  const trace=h.state.saved.transactions[0];
  assert.deepEqual(trace.events.find(e=>e.phase==='readback').reading.foreground,[1,1,.1]);
  assert.deepEqual(trace.events.find(e=>e.phase==='restored').reading.foreground,[.18,.18,.18]);
  h.state.clamp=false;
  for(let id=61;id<=69;id++)await h.send({type:'commit',id,documentId:7,scene:[id/10,2,.1]});
  await h.send({type:'diagnostics'});
  assert.deepEqual(h.state.saved.transactions.map(t=>t.id),[62,63,64,65,66,67,68,69]);h.panel.hide();
});

test('a failed native foreground get can still be saved with raw error data',async()=>{
  const h=host();h.panel.show(h.root);await h.send({type:'ready',id:1});
  h.state.getError={_obj:'error',message:'Native foreground get failed',result:-1};
  await h.send({type:'refresh',id:70});
  const reply=h.state.messages.find(m=>m.requestId===70);
  assert.equal(reply.context.foreground,null);assert.match(reply.context.error,/get failed/);
  await h.send({type:'diagnostics',capabilities:{fixture:'synthetic failure'}});
  assert.deepEqual(h.state.saved.foregroundDescriptor,h.state.getError);
  assert.match(h.state.saved.foregroundError,/get failed/);assert.equal(h.state.saved.schema,4);h.panel.hide();
});

test('diagnostics without a document capture a fresh foreground instead of the prior document reading',async()=>{
  const h=host();h.panel.show(h.root);await h.send({type:'ready',id:1});
  h.state.id=null;h.state.rgb=[4,.3,-.01];
  await h.send({type:'diagnostics'});
  assert.equal(h.state.saved.context.documentId,null);
  assert.equal(h.state.saved.context.foreground,null);
  assert.deepEqual(h.state.saved.foregroundDescriptor.foregroundColor,{redFloat:4,greenFloat:.3,blueFloat:-.01});
  h.panel.hide();
});

function capturedOrdinaryHost(rgb=[.3,.2,.1]) {
  const h=host();h.state.foreground=ordinary.foregroundDescriptor.foregroundColor;
  h.state.conversionResult=ordinary.foregroundConversion.descriptor;
  // Actual conversion input/output, synthetic paint pixels; not a numerical
  // oracle for the captured HSB color and not evidence of native Photoshop.
  h.state.rgb=[...rgb];return h;
}
function sourceState(h) {
  return JSON.parse(JSON.stringify({width:h.source.width,height:h.source.height,dirty:h.source.dirty,
    history:h.source.history,layers:h.source.layers,activeLayers:h.source.activeLayers,selection:h.source.selection.bounds}));
}
test('actual ordinary RGB conversion takes native pixel fallback, caches polling, and forces fresh explicit sync',async()=>{
  const h=capturedOrdinaryHost(),before=sourceState(h),foreground=JSON.parse(JSON.stringify(h.state.foreground));
  h.panel.show(h.root);await h.send({type:'ready',id:1});
  assert.deepEqual(h.state.messages.at(-1).context.foreground,h.state.rgb.map(Math.fround));
  assert.equal(h.state.messages.at(-1).context.error,undefined);assert.equal(h.state.probes,1);
  await h.refresh();await h.refresh();assert.equal(h.state.probes,1,'ordinary polling reuses verified pixels');
  h.state.rgb=[.8,.6,.4];await h.send({type:'refresh',id:200});
  assert.equal(h.state.probes,2);const reply=h.state.messages.find(message=>message.requestId===200);
  assert.equal(reply.forceImport,true);assert.deepEqual(reply.context.foreground,h.state.rgb.map(Math.fround));
  assert.equal(h.state.calls.filter(command=>command._obj==='set').length,0,'sync must never change foreground');
  assert.deepEqual(h.state.foreground,foreground);assert.deepEqual(sourceState(h),before);assert.equal(h.state.id,7);
  assert.equal(h.documents.size,1);assert.equal(h.state.disposals,2);h.panel.hide();
});

test('native RGB property float output avoids modal pixel sampling even for an HSB foreground',async()=>{
  const h=capturedOrdinaryHost();h.state.rgbProperty={foregroundColorRGB:{_obj:'RGBColor',redFloat:8,greenFloat:0,blueFloat:-.02}};
  h.panel.show(h.root);await h.send({type:'ready',id:1});
  assert.deepEqual(h.state.messages.at(-1).context.foreground,[8,0,-.02]);assert.equal(h.state.probes,0);
  assert.equal(h.state.modalOptions.length,0);assert.equal(h.state.conversions.length,0);
  await h.send({type:'diagnostics'});assert.equal(h.state.saved.foregroundSource,'rgb-property');
  assert.deepEqual(h.state.saved.foregroundRGBProperty.descriptor,h.state.rgbProperty);h.panel.hide();
});

test('pixel fallback preserves negative/HDR floats and snapshots the native probe and cleanup in schema 4',async()=>{
  const h=capturedOrdinaryHost([4.5,-.02,8]),before=sourceState(h);
  h.panel.show(h.root);await h.send({type:'ready',id:1});
  await h.send({type:'diagnostics',capabilities:{fixture:'synthetic paint sample, actual ordinary conversion'}});
  const capture=h.state.saved;assert.equal(capture.schema,4);assert.equal(capture.extension.version,manifest.version);
  assert.equal(capture.foregroundSource,'paint-sample');assert.deepEqual(capture.foregroundConversion,ordinary.foregroundConversion);
  assert.equal(capture.foregroundSample.componentSize,32);assert.equal(capture.foregroundSample.colorProfile,h.state.probeProfile);
  assert.equal(capture.foregroundSample.cached,false,'diagnostics sample freshly');
  assert.deepEqual(capture.foregroundSample.foreground,h.state.rgb.map(Math.fround));
  assert.deepEqual(capture.foregroundSample.cleanup,{closed:true,sourceRestored:true,autoCloseRegistered:true,imageDataDisposed:true});
  assert.ok(capture.foregroundSample.stages.some(stage=>stage.phase==='foreground-filled'));
  for(const name of ['duplicateMs','cropMs','fillMs','getPixelsMs','getDataMs','closeMs','totalMs'])assert.ok(Number.isFinite(capture.foregroundSample.timings[name])&&capture.foregroundSample.timings[name]>=0,name);
  assert.ok(capture.foregroundSample.stages.every((stage,i,all)=>stage.elapsedMs>=0&&stage.sincePreviousMs>=0&&(!i||stage.elapsedMs>=all[i-1].elapsedMs)));
  assert.deepEqual(sourceState(h),before);assert.equal(h.documents.size,1);h.panel.hide();
});

test('foreground notifications invalidate the native sample cache without source-document mutation',async()=>{
  const h=capturedOrdinaryHost(),before=sourceState(h);h.panel.show(h.root);await h.send({type:'ready',id:1});
  assert.equal(h.state.probes,1);h.notification();await h.refresh();
  assert.equal(h.state.probes,2);assert.deepEqual(sourceState(h),before);h.panel.hide();
});

test('native probe errors and cancellation close duplicates, dispose buffers, preserve source state, and block writes',async()=>{
  for(const phase of ['duplicate','deselect','crop','layer','fill','getPixels','getData','close','cancel']) {
    const h=capturedOrdinaryHost(),before=sourceState(h);
    if(phase==='cancel')h.state.beforeProbe=async current=>{if(current==='crop')h.state.modalContext.isCancelled=true;};
    else h.state.probeError=phase;
    h.panel.show(h.root);await h.send({type:'ready',id:1});
    const context=h.state.messages.at(-1).context;assert.equal(context.foreground,null,phase);assert.ok(context.error,phase);
    assert.equal(h.state.id,7,phase);assert.equal(h.documents.size,1,phase);assert.deepEqual(sourceState(h),before,phase);
    if(phase==='getData'||phase==='close')assert.equal(h.state.disposals,1);
    if(phase==='cancel'||phase==='close')assert.equal(h.state.autoClosed,1);
    await h.send({type:'commit',id:300,documentId:7,scene:[4,2,1]});
    assert.equal(h.state.messages.find(message=>message.type==='committed'&&message.id===300).applied,false);
    assert.equal(h.state.calls.filter(command=>command._obj==='set').length,0,phase);
    assert.equal(h.documents.size,1,phase);h.panel.hide();
  }
});

test('wrong source or sampled profiles/depth never become ACEScg foreground values',async()=>{
  for(const patch of [{sourceDepth:16},{sourceProfile:'sRGB IEC61966-2.1'},{probeComponentSize:16},{probeProfile:'sRGB IEC61966-2.1'}]) {
    const h=capturedOrdinaryHost();Object.assign(h.state,patch);const before=sourceState(h);
    h.panel.show(h.root);await h.send({type:'ready',id:1});
    assert.equal(h.state.messages.at(-1).context.foreground,null);assert.ok(h.state.messages.at(-1).context.error);
    assert.deepEqual(sourceState(h),before);assert.equal(h.state.id,7);assert.equal(h.documents.size,1);h.panel.hide();
  }
});

test('an external document switch during sampling retains its focus and cannot publish stale context',async()=>{
  for(const closeActivatesOwner of [false,true]) {
    const h=capturedOrdinaryHost(),before=sourceState(h);h.state.closeActivatesOwner=closeActivatesOwner;
    h.state.beforeProbe=async phase=>{if(phase==='getData')h.state.id=9;};
    h.panel.show(h.root);await h.send({type:'ready',id:1});
    assert.equal(h.state.id,9);assert.equal([...h.documents.keys()].some(id=>id>=100),false);
    assert.deepEqual(sourceState(h),before);assert.equal(h.state.messages.some(message=>message.type==='context'),false);
    assert.match(h.state.messages.at(-1).message,/Document changed/);h.panel.hide();
  }
});

test('a sampled native backup supports HDR release in one modal scope and restores HSB after a partial set',async()=>{
  const h=capturedOrdinaryHost(),before=sourceState(h),native=JSON.parse(JSON.stringify(h.state.foreground));
  h.panel.show(h.root);await h.send({type:'ready',id:1});
  await h.send({type:'commit',id:400,documentId:7,scene:[4.5,-.02,8]});
  const success=h.state.messages.find(message=>message.type==='committed'&&message.id===400);
  assert.equal(success.applied,true);assert.deepEqual(success.foreground,[4.5,-.02,8]);
  h.state.foreground=native;h.state.rgb=[.3,.2,.1];
  h.state.partialWriteError={_obj:'error',message:'Synthetic partial set failed',result:-25920};
  await h.send({type:'commit',id:401,documentId:7,scene:[4,2,1]});
  const failure=h.state.messages.find(message=>message.type==='committed'&&message.id===401);
  assert.equal(failure.applied,false);assert.match(failure.error,/partial set failed.*previous foreground was restored/);
  assert.deepEqual(failure.foreground,[.3,.2,.1].map(Math.fround));assert.deepEqual(h.state.foreground,native);
  assert.ok(h.state.calls.some(command=>command._obj==='set'&&command.to._obj==='HSBColorClass'));
  assert.equal(h.state.modal,0);assert.equal(h.documents.size,1);assert.deepEqual(sourceState(h),before);
  await h.send({type:'diagnostics'});const trace=h.state.saved.transactions.find(transaction=>transaction.id===401);
  assert.deepEqual(trace.events.find(event=>event.phase==='restore-requested').command.to,native);
  assert.deepEqual(trace.events.find(event=>event.phase==='failed').result,{_obj:'error',message:'Synthetic partial set failed',result:-25920});
  h.panel.hide();
});

test('schema-4 foreground-only validation requires native sample metadata and matching applied readback',async()=>{
  const {execFile}=await import('node:child_process'),{promisify}=await import('node:util'),{tmpdir}=await import('node:os');
  const run=promisify(execFile),directory=await fs.mkdtemp(path.join(tmpdir(),'modcam16-native-sample-'));
  const file=path.join(directory,'capture.json'),h=capturedOrdinaryHost();
  const args=[path.join(process.env.EXT_ROOT,'tools/validate_host.mjs'),'--plugin',process.env.EXT_PLUGIN,'--foreground-only',file];
  try {
    h.panel.show(h.root);await h.send({type:'ready',id:1});
    await h.send({type:'commit',id:500,documentId:7,scene:[4,2,-.01]});
    h.state.foreground=ordinary.foregroundDescriptor.foregroundColor;h.state.rgb=[4,2,-.01];h.state.view='View unavailable';
    await h.send({type:'diagnostics'});
    const capture=h.state.saved;await fs.writeFile(file,JSON.stringify(capture));
    assert.match((await run(process.execPath,args)).stdout,/Foreground checks pass \(1 applied transaction readbacks checked\)/);
    const bad=JSON.parse(JSON.stringify(capture));bad.foregroundSample.cleanup.closed=false;
    await fs.writeFile(file,JSON.stringify(bad));await assert.rejects(run(process.execPath,args),error=>/verified floating-point ACEScg/.test(error.stderr));
    bad.foregroundSample.cleanup.closed=true;bad.transactions[0].events.find(event=>event.phase==='readback').reading.descriptor.foregroundColor.redFloat=1;
    await fs.writeFile(file,JSON.stringify(bad));await assert.rejects(run(process.execPath,args),error=>/no matching native readback evidence/.test(error.stderr));
  } finally {h.panel.hide();await fs.rm(directory,{recursive:true,force:true});}
});

test('new real short-panel capture retains eight native foreground readbacks and validates older layout data',async()=>{
  const fixture=new URL('./fixtures/photoshop-resize-foreground.json',import.meta.url);
  const capture=JSON.parse(await fs.readFile(fixture,'utf8'));
  assert.deepEqual(capture.layout.panel,{width:280,height:180});
  assert.equal(capture.layout.resizeGrip,undefined,'capture predates native grip diagnostics');
  assert.equal(capture.extension.version,'0.1.4');assert.equal(capture.transactions.length,8);
  const sources=capture.transactions.map(transaction=>transaction.events.find(event=>event.phase==='readback').reading.source);
  assert.deepEqual(sources,Array(6).fill('paint-sample').concat('native-float','native-float'));
  assert.ok(capture.context.foreground.some(value=>value>1));
  const {execFile}=await import('node:child_process'),{promisify}=await import('node:util');
  const result=await promisify(execFile)(process.execPath,[path.join(process.env.EXT_ROOT,'tools/validate_host.mjs'),
    '--plugin',process.env.EXT_PLUGIN,'--foreground-only',fileURLToPath(fixture)]);
  assert.match(result.stdout,/Foreground checks pass \(8 applied transaction readbacks checked\)/);
});

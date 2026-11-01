// Repeatable shipping-panel benchmark. All JavaScript runs via Buck2's :node.
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {pathToFileURL} from 'node:url';
const args=process.argv.slice(2),arg=name=>args[args.indexOf(name)+1];
if(args[0]!=='--plugin')throw Error('Use buck2 run //:benchmark');
const root=process.cwd(),current=path.resolve(arg('--plugin'));
const baseline=path.resolve(args.includes('--baseline')?arg('--baseline'):'.tools/latency-v0.1.5');
const output=path.resolve(args.includes('--output')?arg('--output'):'.tools/latency-benchmark.json');
const {chromium}=await import(pathToFileURL(path.join(root,'node_modules/playwright/index.mjs')));
const versions=[['current',current]];
try{await fs.access(path.join(baseline,'plugin/web/app.js'));versions.unshift(['baseline',baseline]);}catch{}
const roots=new Map(versions);
const server=http.createServer(async(req,res)=>{
  const parts=new URL(req.url,'http://localhost').pathname.split('/').filter(Boolean),base=roots.get(parts.shift());
  if(!base){res.writeHead(404).end();return;}
  const file=path.resolve(base,...parts);
  if(!file.startsWith(base+path.sep)){res.writeHead(403).end();return;}
  try{const body=await fs.readFile(file);res.setHeader('Content-Type',file.endsWith('.html')?'text/html':file.endsWith('.css')?'text/css':'text/javascript');res.end(body);}catch{res.writeHead(404).end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const env={...process.env,LD_LIBRARY_PATH:path.join(root,'.tools/browser-libs/usr/lib/x86_64-linux-gnu')+path.delimiter+(process.env.LD_LIBRARY_PATH??'')};
let browser;
const runs=[];
try{
  browser=await chromium.launch({headless:true,env,args:['--no-sandbox','--enable-unsafe-webgpu','--enable-unsafe-swiftshader','--use-angle=swiftshader','--enable-features=Vulkan','--use-vulkan=swiftshader','--disable-vulkan-surface']});
  for(const [version,directory] of versions)for(const backend of ['WebGL2','WebGPU'])for(let repeat=0;repeat<3;repeat++){
    const page=await browser.newPage({viewport:{width:380,height:760}});
    await page.addInitScript(({backend})=>{
      window.jobs=new Map();window.completed=[];window.stages=[];window.commits=[];window.sliceDecodeMs=null;
      const NativeBlob=Blob;
      window.Blob=class extends NativeBlob{
        constructor(parts=[],options){
          if(options?.type==='text/javascript'){
            let source=parts.join('');
            const instrumentation=`
              const benchWrap=(stage,fn)=>function(...args){const start=performance.now();try{return fn.apply(this,args);}finally{globalThis.postMessage({type:'benchmark-stage',stage,ms:performance.now()-start});}};
              if(typeof encodePreview!=='undefined')encodePreview=benchWrap('previewPngMs',encodePreview);
              if(typeof encodeLinearRgbaPng!=='undefined')encodeLinearRgbaPng=benchWrap('slicePngMs',encodeLinearRgbaPng);
              if(typeof zlibSync!=='undefined')zlibSync=benchWrap('compressionMs',zlibSync);
              if(typeof ColorCore!=='undefined')ColorCore.prototype.evaluate=benchWrap('evaluationMs',ColorCore.prototype.evaluate);
              if(typeof WebGL2RenderingContext!=='undefined')WebGL2RenderingContext.prototype.readPixels=benchWrap('webglWaitReadbackMs',WebGL2RenderingContext.prototype.readPixels);
            `;
            source=source.replace('globalThis.onmessage =',instrumentation+'globalThis.onmessage =');
            parts=[backend==='WebGL2'?"Object.defineProperty(navigator,'gpu',{value:undefined});":'',source];
          }
          super(parts,options);
        }
      };
      const NativeWorker=Worker;
      window.Worker=class{
        constructor(url,options){this.native=new NativeWorker(url,options);this.native.onmessage=event=>{
          const m=event.data;
          if(m.type==='benchmark-stage'){window.stages.push(m);return;}
          if(m.type==='render')window.lastRenderJ=window.jobs.get('render:'+m.id).code[0];
          window.completed.push({type:m.type,id:m.id,renderer:m.renderer,timings:m.timings});
          this.onmessage?.(event);
        };this.native.onerror=event=>this.onerror?.(event);}
        postMessage(m,transfer){window.jobs.set(m.type+':'+m.id,m);this.native.postMessage(m,transfer);}
        terminate(){this.native.terminate();}
      };
      const descriptor=Object.getOwnPropertyDescriptor(HTMLImageElement.prototype,'src');
      Object.defineProperty(HTMLImageElement.prototype,'src',{...descriptor,set(value){
        if(this.id==='slice'){const start=performance.now();this.addEventListener('load',()=>{window.sliceDecodeMs=performance.now()-start;},{once:true});}
        descriptor.set.call(this,value);
      }});
      const context={documentId:7,view:0,viewName:'ACES 2.0 - HDR 1000 nits (Rec.2020)',fallback:false,foreground:[.18,.18,.18]};
      const publish=data=>window.dispatchEvent(new MessageEvent('message',{data}));
      window.uxpHost={postMessage:m=>{
        if(m.type==='ready')setTimeout(()=>{publish({type:'connected',id:m.id});publish({type:'context',context});},20);
        if(m.type==='commit')window.commits.push({at:performance.now(),scene:m.scene});
        if(m.type==='diagnostics')window.diagnostic=m.capabilities;
      }};
    },{backend});
    await page.goto(`http://127.0.0.1:${server.address().port}/${version}/plugin/web/index.html`);
    await page.waitForFunction(()=>document.getElementById('rgb').textContent==='0.18000  0.18000  0.18000'&&document.querySelectorAll('.patch img').length===18&&[...document.querySelectorAll('img')].every(image=>image.naturalWidth>0));
    await page.waitForFunction(()=>window.lastRenderJ?.toFixed(4)===document.getElementById('j').value&&document.getElementById('slice').complete);
    await page.evaluate(()=>document.getElementById('slice').decode());
    await page.waitForTimeout(100);
    const result=await page.evaluate(async()=>{
      window.completed=[];window.stages=[];window.commits=[];window.sliceDecodeMs=null;window.lastRenderJ=undefined;
      const wheel=document.getElementById('wheel'),oldSource=document.getElementById('slice').src;
      const start=performance.now();wheel.focus();
      for(let i=0;i<12;i++)wheel.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowUp',bubbles:true,altKey:true,repeat:i>0}));
      const target=document.getElementById('j').value;
      const until=predicate=>new Promise((resolve,reject)=>{const deadline=performance.now()+15000;const check=()=>{if(predicate())resolve();else if(performance.now()>deadline)reject(Error('Benchmark timed out'));else requestAnimationFrame(check);};check();});
      await until(()=>{const img=document.getElementById('slice');return window.lastRenderJ?.toFixed(4)===target&&img.src!==oldSource&&img.complete&&img.naturalWidth===256;});
      const dragToDecodedImageMs=performance.now()-start;
      const completedBeforeRelease=[...window.completed],stagesBeforeRelease=[...window.stages];
      const released=performance.now();wheel.dispatchEvent(new KeyboardEvent('keyup',{key:'ArrowUp',bubbles:true,altKey:true}));
      await until(()=>window.commits.length>0);
      document.getElementById('diagnostics').click();
      const stages={};for(const m of stagesBeforeRelease){const stage=stages[m.stage]??={calls:0,totalMs:0};stage.calls++;stage.totalMs+=m.ms;}
      for(const value of Object.values(stages))value.totalMs=+value.totalMs.toFixed(2);
      return {dragToDecodedImageMs:+dragToDecodedImageMs.toFixed(2),releaseToCommitSendMs:+(window.commits[0].at-released).toFixed(2),
        slicePngs:completedBeforeRelease.filter(m=>m.type==='render').length,stages,
        decodeMs:window.diagnostic?.displayed?.timings?.decodeMs??window.sliceDecodeMs,
        device:window.diagnostic?.device??null,displayedTimings:window.diagnostic?.displayed?.timings??null};
    });
    const manifest=JSON.parse(await fs.readFile(path.join(directory,'plugin/manifest.json'),'utf8'));
    runs.push({version:manifest.version,backend,repeat,...result});
    console.log(JSON.stringify(runs.at(-1)));await page.close();
  }
  const report={environment:'Chromium on SwiftShader; shipping panel with in-memory timing wrappers; warmed 12-key J burst',
    notes:['Compression is included in PNG timings; do not add it twice.','readPixels includes GPU completion wait, not isolated transfer time.','Image endpoint checks decoding at an animation frame, not physical presentation.','Foreground timing ends at sending a commit to the mock bridge; Photoshop latency is excluded.'],runs};
  await fs.mkdir(path.dirname(output),{recursive:true});await fs.writeFile(output,JSON.stringify(report,null,2)+'\n');
  console.log('Saved '+output);
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}

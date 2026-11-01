import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readPng } from './png_reader.mjs';
const {chromium}=await import(pathToFileURL(path.join(process.env.EXT_MODULES,'playwright/index.mjs')));
const root=process.env.EXT_PLUGIN;
await fs.mkdir(process.env.EXT_RESULTS,{recursive:true});
const server=http.createServer(async(req,res)=>{
  if(req.url==='/test.html'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Renderer test</title>');return;}
  if(req.url==='/panel-harness.html'){
    res.setHeader('Content-Type','text/html');
    res.end(await fs.readFile(path.join(process.env.EXT_ROOT,'tests/fixtures/panel-harness.html')));return;
  }
  const relative=decodeURIComponent(new URL(req.url,'http://localhost').pathname).slice(1);
  const file=path.resolve(root,relative);
  if(!file.startsWith(path.resolve(root)+path.sep)){res.writeHead(403).end();return;}
  try{const data=await fs.readFile(file);res.setHeader('Content-Type',file.endsWith('.html')?'text/html':file.endsWith('.css')?'text/css':'text/javascript');res.end(data);}
  catch{res.writeHead(404).end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`;
let browser;
test.after(async()=>{await browser?.close();await new Promise(resolve=>server.close(resolve));});
browser=await chromium.launch({headless:true,executablePath:process.env.EXT_BROWSER||undefined,args:[
  '--no-sandbox','--enable-unsafe-webgpu','--enable-unsafe-swiftshader','--use-angle=swiftshader',
  '--enable-features=Vulkan','--use-vulkan=swiftshader','--disable-vulkan-surface',
]});

test('WebGPU and WebGL2 compile and agree with WASM in all views and gamut modes',{timeout:120000},async()=>{
  const page=await browser.newPage();await page.goto(base+'/test.html');
  const result=await page.evaluate(async()=>{
    const api=await import('/test-api.mjs'), core=await api.ColorCore.create(), params=core.parameters();
    const results=[];
    const adapter=await navigator.gpu?.requestAdapter();
    const adapterInfo=adapter?.info;
    results.push({name:'adapter',info:adapterInfo?{vendor:adapterInfo.vendor,architecture:adapterInfo.architecture,device:adapterInfo.device,description:adapterInfo.description}:null});
    for(const [name,Renderer] of [['WebGPU',api.SliceWebGpuRenderer],['WebGL2',api.SliceWebGlRenderer]]) {
      const renderer=new Renderer();let max=0,maskMismatches=0,samples=0;const boundaries=[],anchors=[];
      try{
        for(const view of [0,1,2,4])for(const full of [false,true])for(const j of [0,.15,.46,.8,1]) {
          const gpu=await renderer.render(params,view,j,17,17,full), cpu=core.slice(view,j,17,17,0,17,full);
          for(let i=0;i<gpu.length;i+=4) {
            if(gpu[i+3]!==cpu[i+3]){maskMismatches++;boundaries.push({view,full,j,pixel:i/4,cpu:cpu[i+3],gpu:gpu[i+3]});continue;}
            if(!cpu[i+3])continue;
            for(let c=0;c<3;c++) {
              if(!Number.isFinite(gpu[i+c]))throw Error(`Nonfinite pixel ${view}/${j}/${i}/${c}`);
              max=Math.max(max,Math.abs(gpu[i+c]-cpu[i+c])/Math.max(1,Math.abs(cpu[i+c])));samples++;
            }
          }
        }
        for(const view of [0,2])for(const full of [false,true])for(const [j,nits] of [[100/217.2768649129496,203],[1,1000]]) {
          const pixel=await renderer.render(params,view,j,1,1,full);
          anchors.push({view,full,j,nits,png:[...api.encodeLinearRgbaPng(view,1,1,pixel)]});
        }
        results.push({name,max,maskMismatches,samples,boundaries,anchors});
      }catch(e){results.push({name,error:String(e)});}finally{renderer.dispose();}
    }
    return results;
  });
  console.log('GPU comparisons:',JSON.stringify(result));
  await fs.writeFile(path.join(process.env.EXT_RESULTS,'gpu.json'),JSON.stringify(result,null,2));
  assert.ok(result[0].info,'WebGPU software adapter required');
  for(const r of result.slice(1)){
    assert.equal(r.error,undefined,`${r.name}: ${r.error}`);assert.ok(r.samples>1000);assert.ok(r.max<.006,`${r.name} relative error ${r.max}`);assert.equal(r.maskMismatches,0,`${r.name} masks ${r.maskMismatches}`);
    for(const anchor of r.anchors) {
      const png=readPng(anchor.png);assert.equal(png.alpha(0,0),65535);
      for(const code of png.pixel(0,0)) {
        const p=(code/65535)**(32/2523),nits=10000*(Math.max(0,p-3424/4096)/(2413/128-2392/128*p))**(16384/2610);
        assert.ok(Math.abs(nits-anchor.nits)<.5,`${r.name} ${anchor.view}/${anchor.full}/${anchor.j}: ${nits} nits`);
      }
    }
  }
  await page.close();
});

test('panel gestures commit on release, track external colors and reject stale document work',{timeout:90000},async()=>{
  const page=await browser.newPage({viewport:{width:380,height:760}}), errors=[];
  page.on('pageerror',error=>errors.push(String(error)));
  await page.addInitScript(()=>{
    window.commits=[];
    window.commitDelay=20;
    window.hostContext={documentId:7,view:0,viewName:'ACES 2.0 - HDR 1000 nits (Rec.2020)',fallback:false,foreground:[.18,.18,.18]};
    window.pushContext=c=>{window.hostContext=c;window.dispatchEvent(new MessageEvent('message',{data:{type:'context',context:c}}));};
    window.uxpHost={postMessage:m=>{
      if(m.type==='ready')setTimeout(()=>{
        window.dispatchEvent(new MessageEvent('message',{data:{type:'connected',id:m.id}}));window.pushContext(window.hostContext);
      },20);
      if(m.type==='refresh')setTimeout(()=>window.dispatchEvent(new MessageEvent('message',{data:{type:'context',context:window.hostContext,requestId:m.id,forceImport:true}})),20);
      if(m.type==='commit'){
        window.commits.push(m);
        setTimeout(()=>{
          if(m.documentId!==window.hostContext.documentId)return;
          window.dispatchEvent(new MessageEvent('message',{data:{...m,type:'committed',applied:true,foreground:m.scene}}));
          window.pushContext({...window.hostContext,foreground:m.scene});
        },window.commitDelay);
      }
    }};
  });
  await page.goto(base+'/plugin/web/index.html');
  await page.waitForFunction(()=>document.querySelector('#slice').naturalWidth===256);
  assert.equal(await page.locator('#slice').evaluate(img=>img.naturalHeight),256);
  assert.equal(await page.locator('#renderer').textContent(),'WebGPU · 256² · software');
  await page.waitForFunction(()=>document.querySelectorAll('.patch').length===18);
  await page.waitForFunction(()=>document.querySelector('#selection-state').textContent==='Within authoring gamut');
  await page.waitForFunction(()=>document.querySelector('#rgb').textContent==='0.18000  0.18000  0.18000');
  await page.screenshot({path:path.join(process.env.EXT_RESULTS,'panel.png')});
  assert.equal(await page.locator('#gamut').inputValue(),'limited');
  const box=await page.locator('#pad').boundingBox();
  await page.mouse.move(box.x+box.width*.5,box.y+box.height*.5);await page.mouse.down();
  await page.mouse.move(box.x+box.width*.49,box.y+box.height*.49,{steps:4});
  await page.waitForTimeout(100);assert.equal(await page.evaluate(()=>window.commits.length),0);
  await page.mouse.up();await page.waitForFunction(()=>window.commits.length===1);
  await page.waitForTimeout(100);assert.equal(await page.evaluate(()=>window.commits.length),1,'self echo must not create writes');
  const jBefore=Number(await page.locator('#j').inputValue());
  await page.locator('#wheel').focus();await page.keyboard.press('ArrowUp');
  await page.waitForFunction(()=>window.commits.length===2);
  assert.ok(Number(await page.locator('#j').inputValue())>jBefore);
  await page.waitForTimeout(60);
  // A delayed echo of our previous commit must not cancel a newer gesture.
  await page.evaluate(()=>{window.commitDelay=250;});
  await page.mouse.move(box.x+box.width*.49,box.y+box.height*.49);await page.mouse.down();await page.mouse.up();
  await page.waitForFunction(()=>window.commits.length===3);
  await page.mouse.move(box.x+box.width*.51,box.y+box.height*.49);await page.mouse.down();
  await page.waitForTimeout(350);
  await page.mouse.up();await page.waitForFunction(()=>window.commits.length===4);
  await page.waitForTimeout(300);
  await page.evaluate(()=>{window.commitDelay=20;});
  await page.evaluate(()=>window.pushContext({...window.hostContext,foreground:[1000,0,0]}));
  await page.waitForFunction(()=>document.querySelector('#selection').hidden);
  assert.match(await page.locator('#selection-state').textContent(),/outside picker domain/);
  const externalCommits=await page.evaluate(()=>window.commits.length);
  await page.selectOption('#gamut','full');await page.waitForTimeout(100);
  assert.equal(await page.evaluate(()=>window.commits.length),externalCommits);
  await page.evaluate(()=>window.pushContext({...window.hostContext,foreground:[.18,.18,.18]}));
  await page.waitForFunction(()=>!document.querySelector('#selection').hidden);
  await page.mouse.move(box.x+box.width*.5,box.y+box.height*.5);await page.mouse.down();
  await page.evaluate(()=>window.pushContext({...window.hostContext,documentId:8,view:1,viewName:'ACES 2.0 - SDR 100 nits (Rec.709)',foreground:[.3,.3,.3]}));
  await page.mouse.up();await page.waitForTimeout(150);
  assert.equal(await page.evaluate(()=>window.commits.length),externalCommits,'document switch cancels the gesture');
  assert.match(await page.locator('#view').textContent(),/SDR 100 nits \(Rec.709\)/);
  await page.evaluate(()=>window.pushContext({...window.hostContext,view:0,viewName:'Raw',fallback:true}));
  await page.waitForFunction(()=>document.querySelector('#fallback').textContent.includes('Raw'));
  // Last request wins even while GPU readbacks and PNG encodes are in flight.
  await page.evaluate(()=>{for(const view of [2,4,0,1])window.pushContext({...window.hostContext,view,fallback:false});});
  await page.waitForFunction(()=>document.querySelector('#view').textContent.includes('Rec.709'));
  await page.waitForFunction(()=>document.querySelector('#slice').naturalWidth===256);
  assert.deepEqual(errors,[]);
  console.log('Panel renderer:',await page.locator('#renderer').textContent());
  await page.close();
});

test('WASM fallback remains interactive when both GPU APIs are unavailable',{timeout:90000},async()=>{
  const page=await browser.newPage();
  // The override is prepended to the Blob worker source, where rendering lives.
  await page.addInitScript(()=>{
    const NativeBlob=window.Blob;
    window.Blob=class extends NativeBlob {constructor(parts=[],options){super(options?.type==='text/javascript'?[
      "Object.defineProperty(navigator,'gpu',{value:undefined});globalThis.OffscreenCanvas=undefined;",...parts]:parts,options);}};
  });
  await page.goto(base+'/plugin/web/index.html');
  await page.waitForFunction(()=>document.querySelector('#renderer').textContent==='WASM · 256²');
  assert.ok(await page.locator('#preview').evaluate(img=>img.naturalWidth===256));
  assert.deepEqual(await page.locator('#slice').evaluate(img=>[img.naturalWidth,img.naturalHeight]),[256,256]);
  await page.locator('#wheel').focus();await page.keyboard.down('ArrowUp');
  await page.waitForFunction(()=>document.querySelector('#renderer').textContent==='WASM · 128²'&&document.querySelector('#slice').naturalWidth===128);
  assert.equal(await page.locator('#slice').evaluate(img=>img.naturalHeight),128);
  await page.keyboard.up('ArrowUp');
  await page.waitForFunction(()=>document.querySelector('#renderer').textContent==='WASM · 256²'&&document.querySelector('#slice').naturalWidth===256);
  await page.close();
});

test('a failed WebGPU device falls back to a WebGL2-rendered PNG',{timeout:90000},async()=>{
  const page=await browser.newPage();
  await page.addInitScript(()=>{
    const NativeBlob=window.Blob;
    window.Blob=class extends NativeBlob {constructor(parts=[],options){super(options?.type==='text/javascript'?[
      "Object.defineProperty(navigator,'gpu',{value:{requestAdapter:async()=>({requestDevice:async()=>{throw Error('Simulated device loss');}})}});",...parts]:parts,options);}};
  });
  await page.goto(base+'/plugin/web/index.html');
  await page.waitForFunction(()=>document.querySelector('#renderer').textContent.startsWith('WebGL2 · 256²'));
  assert.equal(await page.locator('#slice').evaluate(img=>img.naturalWidth),256);
  assert.equal(await page.locator('#slice').evaluate(img=>img.naturalHeight),256);
  await page.close();
});

async function fittedLayout(page) {
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const layout=await page.evaluate(()=>{
    const main=document.querySelector('main'),pad=document.querySelector('#pad').getBoundingClientRect(),wheel=document.querySelector('#wheel').getBoundingClientRect();
    const controls=['header','#gamut','#j','#x','#y','#wheel','#pad','#preview','#rgb','#selection-state','#view','#fallback','#snap-label','#renderer','#status','#refresh','#diagnostics'];
    return {width:innerWidth,height:innerHeight,pageWidth:document.documentElement.scrollWidth,pageHeight:document.documentElement.scrollHeight,
      mainHeight:main.clientHeight,contentHeight:main.scrollHeight,overflow:getComputedStyle(main).overflowY,
      transform:getComputedStyle(document.querySelector('#interface')).transform,
      scale:Number(getComputedStyle(document.querySelector('#interface')).transform.match(/matrix\(([^,]+)/)?.[1]??1),
      padWidth:pad.width,padHeight:pad.height,wheelHeight:wheel.height,
      imageSize:[document.querySelector('#slice').naturalWidth,document.querySelector('#slice').naturalHeight],
      controls:controls.map(selector=>{
        const element=document.querySelector(selector),rect=element.getBoundingClientRect();
        return {selector,text:element.textContent,hidden:getComputedStyle(element).display==='none',
          x:rect.x,y:rect.y,width:rect.width,height:rect.height,bottom:rect.bottom,right:rect.right,
          scrollHeight:element.scrollHeight,clientHeight:element.clientHeight};
      })};
  });
  assert.ok(layout.pageWidth<=layout.width&&layout.pageHeight<=layout.height,JSON.stringify(layout));
  assert.equal(layout.overflow,'visible');assert.ok(layout.contentHeight<=layout.mainHeight+1,'main has no vertical scroll range');
  assert.ok(layout.padWidth>0&&Math.abs(layout.padWidth-layout.padHeight)<.1,'pad stays square');
  assert.ok(Math.abs(layout.padHeight-layout.wheelHeight)<.1,'wheel uses the displayed pad height');
  for(const control of layout.controls){
    if(control.selector==='#fallback'&&!control.text)continue;
    assert.equal(control.hidden,false,JSON.stringify(control));
    assert.ok(control.width>0&&control.height>0,JSON.stringify(control));
    assert.ok(control.x>=-.5&&control.y>=-.5&&control.right<=layout.width+.5&&control.bottom<=layout.height+.5,JSON.stringify({layout,control}));
    if(['#status','#selection-state','#view','#fallback','#snap-label','#renderer','#rgb'].includes(control.selector))
      assert.ok(control.scrollHeight<=control.clientHeight+1,'full text remains visible: '+JSON.stringify(control));
  }
  return layout;
}

test('panel follows Photoshop themes and fits every control without scrolling or a minimum',{timeout:90000},async()=>{
  const page=await browser.newPage({viewport:{width:340,height:360}}), errors=[];
  page.on('pageerror',error=>errors.push(String(error)));
  await page.addInitScript(()=>{
    window.messages=[];window.uxpHost={postMessage:m=>{
      window.messages.push(m);
      if(m.type==='ready')setTimeout(()=>window.dispatchEvent(new MessageEvent('message',{data:{type:'connected',id:m.id}})),0);
      if(m.type==='refresh')setTimeout(()=>window.dispatchEvent(new MessageEvent('message',{data:{type:'context',requestId:m.id,context:{documentId:null,view:0,foreground:null,fallback:true,viewName:'No document'}}})),0);
    }};
  });
  await page.goto(base+'/plugin/web/index.html');
  await page.waitForFunction(()=>document.querySelector('#slice').naturalWidth===256);
  const colors={background:'rgb(50, 50, 50)',foreground:'rgb(240, 240, 240)',border:'rgb(35, 35, 35)',secondary:'rgb(185, 185, 185)',hoverBackground:'rgb(70, 70, 70)',scheme:'dark'};
  for(const theme of [colors,{...colors,background:'rgb(240, 240, 240)',foreground:'rgb(25, 25, 25)',secondary:'rgb(80, 80, 80)',border:'rgb(190, 190, 190)',scheme:'light'}]) {
    await page.evaluate(colors=>window.dispatchEvent(new MessageEvent('message',{data:{type:'theme',colors}})),theme);
    const rendered=await page.evaluate(()=>({
      backgrounds:['html','body','footer','button','input','select'].map(selector=>getComputedStyle(document.querySelector(selector)).backgroundColor),
      text:getComputedStyle(document.body).color,scheme:getComputedStyle(document.documentElement).colorScheme,
      border:getComputedStyle(document.querySelector('select')).borderTopColor,
    }));
    assert.deepEqual(rendered.backgrounds,Array(6).fill(theme.background));
    assert.equal(rendered.text,theme.foreground);assert.equal(rendered.scheme,theme.scheme);assert.equal(rendered.border,theme.border);
  }
  const sizes=[{width:380,height:760},{width:340,height:360},{width:300,height:280},{width:280,height:180},
    {width:800,height:180},{width:180,height:120},{width:120,height:80},{width:40,height:40}];
  for(const viewport of sizes) {
    await page.setViewportSize(viewport);
    const layout=await fittedLayout(page);assert.deepEqual(layout.imageSize,[256,256]);
    if(viewport.height<=180)assert.ok(layout.scale<1,'small allocations shrink the entire interface');
    if(viewport.width>=340&&viewport.height>=360)assert.equal(layout.transform,'none','readable layouts avoid transformed HDR ancestors');
    await page.locator('#refresh').click();
  }
  assert.equal(await page.evaluate(()=>window.messages.filter(m=>m.type==='refresh').length),sizes.length);
  await page.setViewportSize({width:280,height:180});await fittedLayout(page);
  await page.screenshot({path:path.join(process.env.EXT_RESULTS,'panel-short-light.png')});
  await page.setViewportSize({width:340,height:360});
  await page.evaluate(colors=>window.dispatchEvent(new MessageEvent('message',{data:{type:'theme',colors}})),colors);
  await fittedLayout(page);
  await page.screenshot({path:path.join(process.env.EXT_RESULTS,'panel-docked-dark.png')});
  const manifest=JSON.parse(await fs.readFile(path.join(root,'plugin/manifest.json'),'utf8'));
  assert.equal(manifest.entrypoints[0].minimumSize,undefined);
  assert.deepEqual(manifest.entrypoints[0].maximumSize,{width:10000,height:10000});
  assert.ok(manifest.entrypoints[0].preferredDockedSize.height<=360);
  assert.deepEqual(errors,[]);await page.close();
});

test('shipping native host resizes the embedded viewport with the outer panel allocation',{timeout:90000},async()=>{
  const page=await browser.newPage({viewport:{width:1400,height:1100}}),errors=[];
  page.on('pageerror',error=>errors.push(String(error)));
  await page.addInitScript(()=>{
    if(window.parent!==window)window.uxpHost={postMessage:message=>window.parent.postMessage(message,location.origin)};
  });
  await page.goto(base+'/panel-harness.html');
  const frame=page.frame({name:'picker-browser'});
  await frame.waitForFunction(()=>document.querySelector('#slice')?.naturalWidth===256);
  const layouts=[];
  for(const size of [{width:280,height:180},{width:340,height:360},{width:800,height:360},{width:340,height:800},{width:800,height:800},{width:1000,height:800},{width:120,height:40}]) {
    const webSize={width:size.width,height:size.height-Math.min(20,size.height/4)};
    await page.evaluate(({width,height})=>{
      const root=document.getElementById('panel-root');root.style.width=`${width}px`;root.style.height=`${height}px`;
    },size);
    await page.waitForFunction(({width,height})=>{
      const view=document.getElementById('picker');
      return view.style.width===`${width}px`&&view.style.height===`${height}px`&&view.getAttribute('width')===`${width}px`&&view.getAttribute('height')===`${height}px`;
    },webSize);
    await frame.waitForFunction(({width,height})=>innerWidth===width&&innerHeight===height,webSize);
    const layout=await fittedLayout(frame);layouts.push(layout);
    assert.equal(layout.width,webSize.width);assert.equal(layout.height,webSize.height);
    assert.deepEqual(layout.imageSize,[256,256]);
    const strip=await page.evaluate(()=>{
      const panel=document.getElementById('panel-root').getBoundingClientRect(),webview=document.getElementById('picker').getBoundingClientRect();
      return panel.bottom-webview.bottom;
    });
    assert.equal(strip,size.height-webSize.height,'native resize area stays outside the WebView');
    assert.equal(await page.locator('#neighbor').evaluate(node=>node.getBoundingClientRect().height),120,'neighboring panel retains its allocation');
    await frame.locator('#diagnostics').click();
    await page.waitForFunction(({width,height})=>hostState.saved?.capabilities.viewport.width===width&&hostState.saved?.capabilities.viewport.height===height,webSize);
    const saved=await page.evaluate(()=>hostState.saved);
    assert.deepEqual(saved.layout.panel,size);assert.deepEqual(saved.layout.webview,webSize);assert.deepEqual(saved.layout.appliedWebview,webSize);
    assert.equal(saved.layout.resizeGrip.status,'applied');assert.equal(saved.layout.resizeGrip.nativeStripHeight,strip);
    assert.equal(saved.layout.configuration.minimumSize,undefined);
    assert.ok(saved.capabilities.layout.scale>0&&saved.capabilities.layout.scale<=1);
    assert.ok(Math.abs(saved.capabilities.layout.pad.width-saved.capabilities.layout.pad.height)<.1);
    assert.deepEqual(saved.capabilities.slice,{width:256,height:256});
  }
  assert.ok(layouts[4].padWidth>layouts[3].padWidth,'more width grows the pad when height permits');
  assert.ok(layouts[4].padWidth>layouts[2].padWidth,'more height grows the square in a wide panel');
  assert.deepEqual(await page.evaluate(()=>hostState.gripCalls),Array(2).fill({type:'panel',target:'picker',value:false}));
  assert.equal(await page.evaluate(()=>hostState.writes.length),0,'resizing alone never changes the foreground');
  await page.evaluate(()=>{const panel=document.getElementById('panel-root');panel.style.width='1000px';panel.style.height='800px';});
  await frame.waitForFunction(()=>innerWidth===1000&&innerHeight===780);await fittedLayout(frame);
  for(const view of ['ACES 2.0 - SDR 100 nits (Rec.709)','ACES 2.0 - HDR 1000 nits (P3 D65)','ACES 2.0 - SDR 100 nits (P3 D65)','ACES 2.0 - HDR 1000 nits (Rec.2020)']) {
    const previous=await frame.locator('#slice').getAttribute('src');
    await page.evaluate(view=>{hostState.view=view;},view);await frame.locator('#refresh').click();
    await frame.waitForFunction(({previous,view})=>document.querySelector('#slice').src!==previous&&document.querySelector('#slice').naturalWidth===256&&document.querySelector('#view').textContent===view.replace('ACES 2.0 - ',''),{previous,view});
    assert.equal(await frame.locator('#slice').evaluate(img=>img.naturalHeight),256);
  }
  await frame.locator('#pad').scrollIntoViewIfNeeded();
  const box=await frame.locator('#pad').boundingBox();
  await page.mouse.click(box.x+box.width*.5,box.y+box.height*.5);
  await page.waitForFunction(()=>hostState.writes.length===1);
  const marker=await frame.locator('#selection').boundingBox();
  assert.ok(Math.abs(marker.x+marker.width/2-(box.x+box.width/2))<1);
  assert.ok(Math.abs(marker.y+marker.height/2-(box.y+box.height/2))<1,'selection coordinates remain aligned after resizing');
  await page.screenshot({path:path.join(process.env.EXT_RESULTS,'panel-outer-wide.png')});
  assert.deepEqual(errors,[]);await page.close();
});

async function mockPanel(options={}) {
  const page=await browser.newPage({viewport:{width:380,height:760}});
  await page.addInitScript(options=>{
    window.requests=[];window.commits=[];window.diagnosticRequests=[];
    window.bridgeSilent=options.bridgeSilent??false;window.commitSilent=false;
    window.commitMode='success';window.commitDelay=20;window.syncDelay=20;window.selectionDelay=0;
    window.hostContext={documentId:7,view:0,viewName:'ACES 2.0 - HDR 1000 nits (Rec.2020)',fallback:false,foreground:[.18,.18,.18]};
    const publish=data=>window.dispatchEvent(new MessageEvent('message',{data}));
    window.pushContext=c=>{window.hostContext=c;publish({type:'context',context:c});};
    window.workerReplies=[];window.stageStarts=[];window.stalls={};window.decodeWaiters=[];window.liveUrls=new Map();
    if(options.performance){
      const NativeBlob=window.Blob;
      const backend=options.backend==='WebGL2'?"Object.defineProperty(navigator,'gpu',{value:undefined});":options.backend==='WASM'?"Object.defineProperty(navigator,'gpu',{value:undefined});globalThis.OffscreenCanvas=undefined;":'';
      const hide=options.hideDevice?"const nativeExtension=WebGL2RenderingContext.prototype.getExtension;WebGL2RenderingContext.prototype.getExtension=function(n){return /debug_renderer_info|timer_query/.test(n)?null:nativeExtension.call(this,n);};":'';
      const stall="globalThis.addEventListener('message',event=>{const m=event.data;if(m.__stallMs){postMessage({type:'test-start',kind:m.type,id:m.id});const start=performance.now();while(performance.now()-start<m.__stallMs){}}});";
      window.Blob=class extends NativeBlob{constructor(parts=[],options){super(options?.type==='text/javascript'?[backend,hide,stall,...parts]:parts,options);}};
      const create=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL);
      URL.createObjectURL=blob=>{const url=create(blob);window.liveUrls.set(url,blob);return url;};
      URL.revokeObjectURL=url=>{window.liveUrls.delete(url);revoke(url);};
      const decode=HTMLImageElement.prototype.decode;
      HTMLImageElement.prototype.decode=async function(){
        if(window.holdDecodes){
          const bytes=new Uint8Array(await window.liveUrls.get(this.src).arrayBuffer());
          await new Promise(resolve=>window.decodeWaiters.push({kind:bytes[25]===6?'slice':'preview',resolve,url:this.src}));
        }
        if(window.failDecode)throw Error('Synthetic PNG decode failure');
        return decode.call(this);
      };
    }
    const NativeWorker=window.Worker;
    window.Worker=class {
      constructor(url,options){this.native=new NativeWorker(url,options);this.native.onmessage=event=>{
        const m=event.data;
        if(m.type==='test-start'){window.stageStarts.push(m);return;}
        window.workerReplies.push({id:m.id,type:m.type,size:m.size,renderer:m.renderer,at:performance.now()});
        const delay=m.type==='selection'?window.selectionDelay:0;
        setTimeout(()=>this.onmessage?.(event),delay);
      };this.native.onerror=event=>this.onerror?.(event);this.native.onmessageerror=event=>this.onmessageerror?.(event);}
      postMessage(message){(window.workerRequests??=[]).push(structuredClone(message));this.native.postMessage({...message,__stallMs:window.stalls[message.type]??0});}
      terminate(){this.native.terminate();}
    };
    window.makeBridge=()=>{window.uxpHost={postMessage:message=>{
      window.requests.push(message);
      if(message.type==='ready'&&!window.bridgeSilent)setTimeout(()=>{
        publish({type:'connected',id:message.id,extension:{id:'com.modcam16.hdr-picker',version:'synthetic'}});
        publish({type:'context',context:window.hostContext});
      },20);
      if(message.type==='refresh'){
        const snapshot=structuredClone(window.hostContext);
        setTimeout(()=>publish({type:'context',context:snapshot,requestId:message.id,forceImport:true}),window.syncDelay);
      }
      if(message.type==='commit'){
        window.commits.push(message);
        if(window.commitSilent)return;
        setTimeout(()=>{
          if(message.documentId!==window.hostContext.documentId)return;
          const applied=window.commitMode==='success';
          if(applied)window.hostContext={...window.hostContext,foreground:message.scene.map(Math.fround)};
          publish({type:'committed',id:message.id,documentId:message.documentId,applied,
            foreground:window.hostContext.foreground,error:applied?undefined:'Synthetic native foreground write rejected'});
          publish({type:'context',context:window.hostContext,sourceCommitId:message.id});
        },window.commitDelay);
      }
      if(message.type==='diagnostics')window.diagnosticRequests.push(message);
    }};};
    if(options.captureUnavailable)HTMLElement.prototype.setPointerCapture=function(){throw Error('Synthetic native pointer capture unavailable');};
    window.addEventListener('pointerdown',event=>window.testPointerId=event.pointerId,true);
    if(options.lateBridge)setTimeout(window.makeBridge,options.lateBridge);else window.makeBridge();
  },options);
  await page.goto(base+'/plugin/web/index.html');
  return page;
}
async function synchronized(page) {
  await page.waitForFunction(()=>document.querySelector('#rgb')?.textContent==='0.18000  0.18000  0.18000'&&document.querySelector('#status')?.textContent==='Foreground synchronized.');
}

test('scaled pad and trackwheel use displayed pointer distances for release commits',{timeout:30000},async()=>{
  const page=await mockPanel({captureUnavailable:true});await synchronized(page);
  const deltas=[];
  for(const viewport of [{width:380,height:760},{width:180,height:120}]){
    await page.setViewportSize(viewport);await fittedLayout(page);
    const count=await page.evaluate(()=>window.commits.length);
    await page.evaluate(()=>{
      const pad=document.getElementById('pad'),rect=pad.getBoundingClientRect();
      const init={bubbles:true,pointerId:21,button:0,altKey:true,clientX:rect.left+rect.width*.51,clientY:rect.top+rect.height*.51};
      pad.dispatchEvent(new PointerEvent('pointerdown',init));window.dispatchEvent(new PointerEvent('pointerup',init));
    });
    await page.waitForFunction(count=>window.commits.length===count+1&&document.querySelector('#status').textContent==='Foreground set.',count);
    await page.locator('#diagnostics').click();
    const code=await page.evaluate(()=>window.diagnosticRequests.at(-1).capabilities.transactions.at(-1).code);
    assert.ok(Math.abs(code[1]-.51)<1e-8&&Math.abs(code[2]-.49)<1e-8,'scaled pad releases at its displayed point');
    const before=await page.evaluate(()=>window.workerRequests.findLast(message=>message.type==='selection').code[0]);
    await page.evaluate(()=>{
      const wheel=document.getElementById('wheel'),rect=wheel.getBoundingClientRect(),x=rect.left+rect.width/2,y=rect.top+rect.height/2;
      const dispatch=(element,type,clientY,time)=>{
        const event=new PointerEvent(type,{bubbles:true,pointerId:22,button:0,altKey:true,clientX:x,clientY});
        Object.defineProperty(event,'timeStamp',{value:time});element.dispatchEvent(event);
      };
      dispatch(wheel,'pointerdown',y,1000);dispatch(window,'pointermove',y+rect.height*.1,2000);dispatch(window,'pointerup',y+rect.height*.1,2100);
    });
    await page.waitForFunction(count=>window.commits.length===count+2&&document.querySelector('#status').textContent==='Foreground set.',count);
    await page.locator('#diagnostics').click();
    const after=await page.evaluate(()=>window.diagnosticRequests.at(-1).capabilities.transactions.at(-1).code[0]);
    deltas.push(before-after);
  }
  assert.ok(deltas[0]>.02&&deltas[0]<.1);assert.ok(Math.abs(deltas[0]-deltas[1])<1e-8,'normal and scaled wheels respond to the same fraction of displayed height');
  await page.close();
});

test('allocation changes cancel active and queued releases without writing or rerendering idle slices',{timeout:30000},async()=>{
  const page=await mockPanel({captureUnavailable:true});await synchronized(page);
  await page.waitForFunction(()=>document.querySelector('#slice').naturalWidth===256);
  const before=await page.evaluate(()=>({renders:window.workerRequests.filter(message=>message.type==='render').length,rgb:document.getElementById('rgb').textContent}));
  await page.setViewportSize({width:280,height:180});await fittedLayout(page);
  assert.equal(await page.evaluate(()=>window.workerRequests.filter(message=>message.type==='render').length),before.renders);
  assert.equal(await page.locator('#rgb').textContent(),before.rgb);
  await page.evaluate(()=>{
    const rect=document.getElementById('pad').getBoundingClientRect();
    document.getElementById('pad').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:23,button:0,altKey:true,clientX:rect.left+rect.width/2,clientY:rect.top+rect.height/2}));
  });
  await page.setViewportSize({width:340,height:240});
  await page.waitForFunction(()=>document.getElementById('status').textContent.includes('Panel resized. Gesture cancelled'));
  await page.evaluate(()=>window.dispatchEvent(new PointerEvent('pointerup',{pointerId:23,button:0})));
  await page.locator('#diagnostics').click();
  let interaction=await page.evaluate(()=>window.diagnosticRequests.at(-1).capabilities.interaction);
  assert.equal(interaction.dragging,null);assert.equal(interaction.pointer,null);assert.equal(interaction.lastGesture.phase,'cancelled by resize');
  assert.equal(await page.evaluate(()=>window.commits.length),0);
  await page.evaluate(()=>{
    window.selectionDelay=400;
    const pad=document.getElementById('pad'),rect=pad.getBoundingClientRect(),init={bubbles:true,pointerId:24,button:0,altKey:true,clientX:rect.left+rect.width/2,clientY:rect.top+rect.height/2};
    pad.dispatchEvent(new PointerEvent('pointerdown',init));window.dispatchEvent(new PointerEvent('pointerup',init));
  });
  await page.setViewportSize({width:800,height:180});await fittedLayout(page);
  await page.waitForTimeout(500);await page.locator('#diagnostics').click();
  const diagnostic=await page.evaluate(()=>window.diagnosticRequests.at(-1).capabilities);
  interaction=diagnostic.interaction;
  assert.equal(interaction.queuedCommit,undefined);assert.equal(interaction.lastGesture.phase,'cancelled by resize');
  assert.equal(diagnostic.transactions.at(-1).events.at(-1).phase,'cancelled');
  assert.equal(await page.evaluate(()=>window.commits.length),0);assert.deepEqual(diagnostic.slice,{width:256,height:256});
  await page.close();
});

test('complete long error and readout text fits short panels without clipping or scrollbars',{timeout:30000},async()=>{
  const page=await mockPanel();await synchronized(page);await page.setViewportSize({width:280,height:180});
  const error='Native foreground operation failed. '+Array(18).fill('Detailed host error retains every word and wraps within the panel.').join(' ');
  await page.evaluate(error=>window.dispatchEvent(new MessageEvent('message',{data:{type:'host-error',message:error}})),error);
  await page.waitForFunction(error=>document.getElementById('status').textContent===error,error);
  await fittedLayout(page);assert.equal(await page.locator('#status').textContent(),error);
  await page.setViewportSize({width:120,height:80});await fittedLayout(page);
  await page.screenshot({path:path.join(process.env.EXT_RESULTS,'panel-complete-long-error.png')});
  assert.equal(await page.evaluate(()=>window.commits.length),0);await page.close();
});

test('late bridge readiness and queued explicit sync import the host foreground',{timeout:30000},async()=>{
  const page=await mockPanel({lateBridge:400});
  await page.locator('#refresh').click();await synchronized(page);
  const requests=await page.evaluate(()=>window.requests);
  assert.ok(requests.some(m=>m.type==='ready'));
  assert.equal(requests.filter(m=>m.type==='refresh').length,1);
  assert.equal(requests.filter(m=>m.type==='commit').length,0);
  await page.locator('#wheel').focus();await page.keyboard.press('ArrowUp');
  await page.waitForFunction(()=>window.commits.length===1&&document.querySelector('#status').textContent==='Foreground set.');
  await page.locator('#diagnostics').click();
  const diagnostic=await page.evaluate(()=>window.diagnosticRequests.at(-1).capabilities);
  assert.equal(diagnostic.bridge.connected,true);assert.equal(diagnostic.bridge.available,true);
  assert.ok(diagnostic.bridge.attempts>=2);assert.equal(diagnostic.transactions[0].events.at(-1).phase,'host-reply');
  await page.close();
});

test('missing bridge acknowledgement times out visibly and explicit sync reconnects',{timeout:30000},async()=>{
  const page=await mockPanel({bridgeSilent:true});
  await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Could not connect to Photoshop'),{},{timeout:10000});
  const attempts=await page.evaluate(()=>window.requests.length);
  assert.ok(attempts>=2&&attempts<=23,'readiness retries must be bounded');
  await page.waitForTimeout(350);assert.equal(await page.evaluate(()=>window.requests.length),attempts);
  await page.evaluate(()=>{window.bridgeSilent=false;});await page.locator('#refresh').click();await synchronized(page);
  assert.equal(await page.evaluate(()=>window.commits.length),0);await page.close();
});

test('explicit sync has a visible reply timeout and accepts its late current response',{timeout:30000},async()=>{
  const page=await mockPanel();await synchronized(page);
  await page.evaluate(()=>{window.syncDelay=6000;window.hostContext={...window.hostContext,foreground:[3.25,.45,.1]};});
  await page.locator('#refresh').click();
  await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('did not return its foreground'),{},{timeout:10000});
  await page.evaluate(()=>window.dispatchEvent(new MessageEvent('message',{data:{type:'context',context:{...window.hostContext,foreground:[.18,.18,.18]}}})));
  assert.match(await page.locator('#status').textContent(),/did not return its foreground/);
  await page.waitForFunction(()=>document.querySelector('#rgb').textContent==='3.25000  0.45000  0.10000'&&document.querySelector('#status').textContent==='Foreground synchronized.',{},{timeout:10000});
  assert.equal(await page.evaluate(()=>window.commits.length),0);await page.close();
});

test('explicit sync imports unchanged cached color and cancels a released evaluation',{timeout:30000},async()=>{
  const page=await mockPanel();await synchronized(page);
  await page.evaluate(()=>{window.selectionDelay=300;});
  await page.locator('#wheel').focus();await page.keyboard.press('ArrowUp');
  assert.equal(await page.evaluate(()=>window.commits.length),0);
  await page.locator('#refresh').click();await synchronized(page);
  await page.waitForTimeout(450);
  assert.equal(await page.locator('#rgb').textContent(),'0.18000  0.18000  0.18000');
  assert.equal(await page.evaluate(()=>window.commits.length),0,'sync cancels the unsent release');
  await page.close();
});

test('rejected writes restore actual readouts and keep errors across unchanged polls',{timeout:30000},async()=>{
  const page=await mockPanel();await synchronized(page);
  await page.evaluate(()=>{window.commitMode='reject';});
  await page.locator('#wheel').focus();await page.keyboard.press('ArrowUp');
  await page.waitForFunction(()=>document.querySelector('#status').textContent==='Synthetic native foreground write rejected');
  await page.waitForFunction(()=>document.querySelector('#rgb').textContent==='0.18000  0.18000  0.18000');
  await page.evaluate(()=>window.pushContext(window.hostContext));
  assert.equal(await page.locator('#status').textContent(),'Synthetic native foreground write rejected');
  await page.setViewportSize({width:280,height:180});
  await fittedLayout(page);
  const statusBox=await page.locator('#status').boundingBox();
  assert.ok(statusBox.y>=0&&statusBox.y+statusBox.height<=180);
  await page.locator('#refresh').click();await synchronized(page);
  assert.equal(await page.evaluate(()=>window.commits.length),1);await page.close();
});

test('release uses the final sample once without native pointer capture and cancels pointer loss',{timeout:30000},async()=>{
  const page=await mockPanel({captureUnavailable:true});await synchronized(page);
  const wheel=await page.locator('#wheel').boundingBox(),j=Number(await page.locator('#j').inputValue());
  await page.mouse.move(wheel.x+wheel.width/2,wheel.y+wheel.height/2);await page.mouse.down();
  // Emulate a native WebView delivering release on its window without a last
  // move sample, rather than relying on Chromium pointer capture behavior.
  await page.evaluate(({x,y})=>document.body.dispatchEvent(new PointerEvent('pointerup',{
    bubbles:true,pointerId:window.testPointerId,button:0,clientX:x,clientY:y,
  })),{x:wheel.x+wheel.width+40,y:wheel.y+wheel.height/2-12});
  await page.mouse.up();
  await page.waitForFunction(()=>window.commits.length===1&&document.querySelector('#status').textContent==='Foreground set.');
  assert.ok(Number(await page.locator('#j').inputValue())>j);
  const pad=await page.locator('#pad').boundingBox();
  await page.mouse.move(pad.x+pad.width*.5,pad.y+pad.height*.5);await page.mouse.down();
  await page.evaluate(()=>document.body.dispatchEvent(new PointerEvent('pointercancel',{bubbles:true,pointerId:window.testPointerId})));
  await page.mouse.up();await page.waitForTimeout(150);
  assert.equal(await page.evaluate(()=>window.commits.length),1,'cancelled pointers never commit');
  await page.locator('#diagnostics').click();
  const diagnostic=await page.evaluate(()=>window.diagnosticRequests.at(-1).capabilities);
  assert.equal(diagnostic.interaction.lastGesture.capture,false);assert.equal(diagnostic.interaction.lastGesture.phase,'cancelled');
  await page.close();
});

test('pad release waits for its last evaluation and stale sync replies cannot replace newer work',{timeout:30000},async()=>{
  const page=await mockPanel();await synchronized(page);
  await page.evaluate(()=>{window.selectionDelay=250;});
  const pad=await page.locator('#pad').boundingBox();
  await page.keyboard.down('Alt');
  await page.mouse.move(pad.x+pad.width*.5,pad.y+pad.height*.5);await page.mouse.down();
  await page.mouse.move(pad.x+pad.width*.52,pad.y+pad.height*.49);
  await page.mouse.up();await page.keyboard.up('Alt');
  assert.equal(await page.evaluate(()=>window.commits.length),0);
  await page.waitForFunction(()=>window.commits.length===1&&document.querySelector('#status').textContent==='Foreground set.');
  assert.equal(await page.locator('#x').inputValue(),'0.5200');assert.equal(await page.locator('#y').inputValue(),'0.5100');
  const sent=await page.evaluate(()=>window.commits[0].scene),displayed=(await page.locator('#rgb').textContent()).trim().split(/\s+/).map(Number);
  sent.forEach((v,i)=>assert.ok(Math.abs(v-displayed[i])<.000006));
  await page.evaluate(()=>{window.selectionDelay=0;window.syncDelay=300;});
  await page.locator('#refresh').click();
  await page.locator('#wheel').focus();await page.keyboard.press('ArrowUp');
  await page.waitForFunction(()=>window.commits.length===2&&document.querySelector('#status').textContent==='Foreground set.');
  const newer=await page.locator('#rgb').textContent();
  await page.waitForTimeout(450);assert.equal(await page.locator('#rgb').textContent(),newer,'obsolete sync snapshot must be ignored');
  await page.close();
});

test('evaluation and commit watchdogs distinguish unsent colors from unconfirmed writes',{timeout:30000},async()=>{
  const page=await mockPanel();await synchronized(page);
  await page.evaluate(()=>{window.selectionDelay=6000;});
  await page.locator('#wheel').focus();await page.keyboard.press('ArrowUp');
  await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Color evaluation did not finish'),{},{timeout:10000});
  assert.equal(await page.evaluate(()=>window.commits.length),0);
  await page.waitForTimeout(1200);assert.equal(await page.evaluate(()=>window.commits.length),0,'late evaluation cannot revive timed out release');
  await page.evaluate(()=>{window.selectionDelay=0;window.commitDelay=6000;});
  await page.keyboard.press('ArrowUp');
  await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('has not confirmed the foreground update'),{},{timeout:10000});
  assert.equal(await page.evaluate(()=>window.commits.length),1);
  await page.waitForFunction(()=>document.querySelector('#status').textContent==='Foreground set.',{},{timeout:10000});
  await page.close();
});

test('shipping host and embedded picker exchange HDR floats, sync unchanged colors, and retain native failures',{timeout:60000},async()=>{
  const page=await browser.newPage({viewport:{width:800,height:1000}}),errors=[];
  page.on('pageerror',error=>errors.push(String(error)));
  await page.addInitScript(()=>{if(window.parent!==window)window.uxpHost={postMessage:message=>window.parent.postMessage(message,location.origin)};});
  await page.goto(base+'/panel-harness.html');
  const frame=page.frame({name:'picker-browser'});await synchronized(frame);
  await page.evaluate(()=>{
    hostState.rgb=[3.25,.45,.1];hostState.foreground={_obj:'HSBColorClass',hue:{_unit:'angleUnit',_value:60},saturation:81,brightness:79};
  });
  await frame.locator('#refresh').click();
  await frame.waitForFunction(()=>document.querySelector('#rgb').textContent==='3.25000  0.45000  0.10000');
  assert.equal(await page.evaluate(()=>hostState.conversions.at(-1).model),15);
  await frame.locator('#pad').scrollIntoViewIfNeeded();
  const pad=await frame.locator('#pad').boundingBox();
  await page.mouse.move(pad.x+pad.width*.5,pad.y+pad.height*.5);await page.mouse.down();
  await frame.waitForFunction(()=>document.querySelector('#rgb').textContent!=='3.25000  0.45000  0.10000');
  await frame.evaluate(()=>document.querySelector('#refresh').click());
  await frame.waitForFunction(()=>document.querySelector('#rgb').textContent==='3.25000  0.45000  0.10000');
  await page.mouse.up();assert.equal(await page.evaluate(()=>hostState.writes.length),0,'sync never writes a preview');
  await page.evaluate(()=>{hostState.foreground=null;hostState.rgb=[.18,.18,.18];});
  await frame.locator('#refresh').click();await synchronized(frame);
  await frame.locator('#j').fill('0.6');await frame.locator('#j').press('Tab');
  await page.waitForFunction(()=>hostState.writes.length===1);
  await frame.waitForFunction(()=>document.querySelector('#status').textContent==='Foreground set.');
  const hdr=await page.evaluate(()=>hostState.rgb);assert.ok(hdr.every(v=>v>1),'host float32 foreground retains HDR');
  const rendered=(await frame.locator('#rgb').textContent()).trim().split(/\s+/).map(Number);
  hdr.forEach((v,i)=>assert.ok(Math.abs(v-rendered[i])<.000006));
  await page.evaluate(()=>{hostState.modalError='Synthetic Photoshop modal acquisition failed';});
  await frame.locator('#j').fill('0.61');await frame.locator('#j').press('Tab');
  await frame.waitForFunction(()=>document.querySelector('#status').textContent.includes('modal acquisition failed'));
  await frame.waitForFunction(rgb=>document.querySelector('#rgb').textContent===rgb,hdr.map(v=>v.toFixed(5)).join('  '));
  await page.waitForTimeout(1100);assert.match(await frame.locator('#status').textContent(),/modal acquisition failed/);
  await frame.locator('#diagnostics').click();await page.waitForFunction(()=>hostState.saved?.transactions.length===2);
  let saved=await page.evaluate(()=>hostState.saved);
  assert.equal(saved.schema,4);assert.equal(saved.extension.version,'0.1.7');
  assert.equal(saved.transactions[0].outcome.applied,true);assert.equal(saved.transactions[1].outcome.applied,false);
  assert.equal(saved.capabilities.transactions.length,2);assert.equal(saved.capabilities.bridge.connected,true);
  await page.evaluate(()=>{hostState.modalError=null;hostState.rgb=[.18,.18,.18];});
  await frame.locator('#refresh').click();await synchronized(frame);
  await page.evaluate(()=>{hostState.clamp=true;});
  await frame.locator('#j').fill('0.6');await frame.locator('#j').press('Tab');
  await frame.waitForFunction(()=>document.querySelector('#status').textContent.includes('previous foreground was restored'));
  await frame.waitForFunction(()=>document.querySelector('#rgb').textContent==='0.18000  0.18000  0.18000');
  await page.waitForTimeout(1100);assert.match(await frame.locator('#status').textContent(),/previous foreground was restored/);
  await page.evaluate(()=>{hostState.clamp=false;hostState.readError={_obj:'error',message:'Synthetic native foreground read failed',result:-1};});
  await frame.locator('#refresh').click();await frame.waitForFunction(()=>document.querySelector('#status').textContent.includes('foreground read failed'));
  await frame.locator('#diagnostics').click();await page.waitForFunction(()=>hostState.saved?.foregroundError?.includes('foreground read failed'));
  saved=await page.evaluate(()=>hostState.saved);
  assert.equal(saved.transactions.length,3);assert.match(saved.foregroundError,/foreground read failed/);
  assert.equal(saved.capabilities.interaction.feedback,'error');
  await page.screenshot({path:path.join(process.env.EXT_RESULTS,'panel-foreground-error.png')});
  assert.deepEqual(errors,[]);await page.close();
});

test('captured ordinary RGB reaches the shipping picker through native sampling, fresh Sync and release',{timeout:60000},async()=>{
  const capture=JSON.parse(await fs.readFile(path.join(process.env.EXT_ROOT,'tests/fixtures/photoshop-hsb-ordinary-rgb.json'),'utf8'));
  const page=await browser.newPage({viewport:{width:800,height:1000}}),errors=[];
  page.on('pageerror',error=>errors.push(String(error)));
  await page.addInitScript(()=>{if(window.parent!==window)window.uxpHost={postMessage:message=>window.parent.postMessage(message,location.origin)};});
  await page.goto(base+'/panel-harness.html');
  const frame=page.frame({name:'picker-browser'});await synchronized(frame);
  const original=await page.evaluate(()=>sourceState());
  // Only the input/conversion descriptors are captured host evidence. The
  // painted Float32 pixels and all Photoshop transport below are synthetic.
  await page.evaluate(capture=>{
    hostState.forceOrdinary=true;hostState.ordinaryForeground=capture.foregroundDescriptor.foregroundColor;
    hostState.conversionResult=capture.foregroundConversion.descriptor;hostState.rgb=[.3,.2,.1];
  },capture);
  await frame.locator('#refresh').click();
  await frame.waitForFunction(()=>document.querySelector('#rgb').textContent==='0.30000  0.20000  0.10000');
  assert.ok(await page.evaluate(()=>hostState.probes)>0);
  assert.equal(await page.evaluate(()=>hostState.writes.length),0);
  // The native descriptor stays unchanged here: explicit Sync must still
  // sample again instead of importing the polling cache.
  await page.evaluate(()=>{hostState.rgb=[.4,.3,.2];});
  await frame.locator('#refresh').click();
  await frame.waitForFunction(()=>document.querySelector('#rgb').textContent==='0.40000  0.30000  0.20000');
  await frame.locator('#pad').scrollIntoViewIfNeeded();
  const pad=await frame.locator('#pad').boundingBox();
  await page.mouse.move(pad.x+pad.width*.5,pad.y+pad.height*.5);await page.mouse.down();
  await frame.waitForFunction(()=>document.querySelector('#rgb').textContent!=='0.40000  0.30000  0.20000');
  assert.equal(await page.evaluate(()=>hostState.writes.length),0,'drag only previews');
  await page.mouse.up();
  try { await frame.waitForFunction(()=>document.querySelector('#status').textContent==='Foreground set.',{},{timeout:10000}); }
  catch(error) {
    console.log('Synthetic sampling release failure:',await frame.locator('#status').textContent(),
      await page.evaluate(()=>({id:hostState.id,writes:hostState.writes,probes:hostState.probes,
        closed:hostState.closed,disposed:hostState.disposed,messages:hostState.messages.slice(-3)})));
    throw error;
  }
  assert.equal(await page.evaluate(()=>hostState.writes.length),1,'release writes once');
  const foreground=await page.evaluate(()=>hostState.rgb);
  const displayed=(await frame.locator('#rgb').textContent()).trim().split(/\s+/).map(Number);
  foreground.forEach((value,i)=>assert.ok(Math.abs(value-displayed[i])<.000006));
  await frame.locator('#diagnostics').click();
  await page.waitForFunction(()=>hostState.saved?.transactions.length===1);
  const saved=await page.evaluate(()=>hostState.saved);
  assert.equal(saved.foregroundSource,'paint-sample');assert.equal(saved.foregroundSample.cached,false);
  assert.deepEqual(saved.foregroundConversion,capture.foregroundConversion);
  assert.equal(saved.transactions[0].outcome.applied,true);
  assert.equal(saved.transactions[0].events.find(event=>event.phase==='readback').reading.source,'paint-sample');
  assert.deepEqual(await page.evaluate(()=>sourceState()),original);
  assert.ok(await page.evaluate(()=>hostState.probes)>=5);
  assert.equal(await page.evaluate(()=>hostState.closed),await page.evaluate(()=>hostState.probes));
  assert.equal(await page.evaluate(()=>hostState.disposed),await page.evaluate(()=>hostState.probes));
  assert.equal(await page.evaluate(()=>hostState.id),7);
  assert.deepEqual(errors,[]);await page.close();
});

async function rendered(page){
  await page.waitForFunction(()=>{
    const image=document.getElementById('slice');
    return image.naturalWidth>0&&Number(image.dataset.j).toFixed(4)===document.getElementById('j').value&&!document.getElementById('renderer').textContent.includes('updating');
  });
}
async function warmed(page){await synchronized(page);await rendered(page);await page.waitForFunction(()=>document.querySelectorAll('.patch img').length===18&&[...document.querySelectorAll('.patch img'),document.getElementById('preview')].every(img=>img.naturalWidth>0));}
async function capturePerformance(page){await page.locator('#diagnostics').click();return page.evaluate(()=>window.diagnosticRequests.at(-1).capabilities);}

for(const backend of ['WebGL2','WebGPU','WASM'])test(`${backend} sender coalesces a 12-change burst and only WASM refines on release`,{timeout:30000},async()=>{
  const page=await mockPanel({performance:true,backend});await warmed(page);
  await page.evaluate(()=>{window.commitSilent=true;window.workerRequests=[];window.workerReplies=[];const wheel=document.getElementById('wheel');wheel.focus();for(let i=0;i<12;i++)wheel.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowUp',bubbles:true,repeat:i>0}));});
  await rendered(page);
  const before=await page.evaluate(()=>({renders:window.workerRequests.filter(m=>m.type==='render'),selections:window.workerRequests.filter(m=>m.type==='selection')}));
  assert.ok(before.renders.length<=2,`${backend} submitted ${before.renders.length} renders`);
  assert.ok(before.selections.length<=2,`${backend} submitted ${before.selections.length} evaluations`);
  assert.equal(await page.locator('#slice').evaluate(img=>img.naturalWidth),backend==='WASM'?128:256);
  await page.evaluate(()=>document.getElementById('wheel').dispatchEvent(new KeyboardEvent('keyup',{key:'ArrowUp',bubbles:true})));
  await page.waitForFunction(()=>window.commits.length===1);await rendered(page);
  const after=await page.evaluate(()=>window.workerRequests.filter(m=>m.type==='render').length);
  assert.equal(after,before.renders.length+(backend==='WASM'?1:0));
  const diagnostic=await capturePerformance(page);
  assert.equal(diagnostic.displayed.id,diagnostic.requested.id);assert.equal(diagnostic.displayed.size,256);
  assert.ok(diagnostic.performance.history.length<=32);assert.equal(diagnostic.performance.queues.slice.maxPending,1);
  assert.ok(diagnostic.performance.queues.slice.replaced>=10);
  if(backend!=='WASM'){assert.equal(diagnostic.device.software,true);assert.ok(diagnostic.displayed.timings.readbackWaitMs>=0);}
  if(backend==='WebGPU'){assert.equal(diagnostic.displayed.timings.gpuTimer,'measured');assert.ok(diagnostic.displayed.timings.gpuMs>=0);}
  await fs.writeFile(path.join(process.env.EXT_RESULTS,'latency-'+backend+'.json'),JSON.stringify(diagnostic,null,2));
  assert.ok(diagnostic.displayed.timings.packMs>=0);assert.ok(diagnostic.displayed.timings.compressMs>=0);assert.ok(diagnostic.displayed.timings.decodeMs>=0);
  await page.close();
});

for(const stage of ['render','preview','decode'])test(`foreground release proceeds while ${stage} is stalled`,{timeout:30000},async()=>{
  const page=await mockPanel({performance:true,backend:'WebGL2'});await warmed(page);
  await page.evaluate(stage=>{window.commitSilent=true;if(stage==='decode')window.holdDecodes=true;else window.stalls[stage]=1500;},stage);
  await page.locator('#wheel').focus();await page.keyboard.down('ArrowUp');
  if(stage==='decode')await page.waitForFunction(()=>window.decodeWaiters.length>0);
  else await page.waitForFunction(stage=>window.stageStarts.some(m=>m.kind===stage),stage);
  await page.keyboard.up('ArrowUp');await page.waitForFunction(()=>window.commits.length===1);
  if(stage!=='decode')assert.equal(await page.evaluate(stage=>{const active=window.stageStarts.find(m=>m.kind===stage);return window.workerReplies.some(m=>m.id===active.id&&m.type===stage);},stage),false,'commit precedes blocked image result');
  else {
    assert.equal(await page.locator('#renderer').evaluate(el=>el.textContent.includes('updating')),true);
    await page.evaluate(()=>{window.holdDecodes=false;window.decodeWaiters.forEach(item=>item.resolve());});
  }
  assert.equal((await capturePerformance(page)).transactions.at(-1).events.some(event=>event.phase==='sent'),true);
  await page.close();
});

test('out-of-order PNG decoding cannot replace a newer slice and failures retain the displayed image',{timeout:30000},async()=>{
  const page=await mockPanel({performance:true,backend:'WebGL2'});await warmed(page);
  const errors=[];page.on('pageerror',error=>errors.push(String(error)));
  await page.evaluate(()=>{window.commitSilent=true;window.holdDecodes=true;const j=document.getElementById('j');j.value='.41';j.dispatchEvent(new Event('change'));});
  await page.waitForFunction(()=>window.decodeWaiters.filter(m=>m.kind==='slice').length===1);
  await page.evaluate(()=>{const j=document.getElementById('j');j.value='.42';j.dispatchEvent(new Event('change'));});
  await page.waitForFunction(()=>window.decodeWaiters.filter(m=>m.kind==='slice').length===2);
  await page.evaluate(()=>window.decodeWaiters.filter(m=>m.kind==='slice')[1].resolve());
  await page.waitForFunction(()=>document.getElementById('slice').dataset.j==='0.42');
  const displayed=await page.locator('#slice').getAttribute('src');
  await page.evaluate(()=>{window.holdDecodes=false;window.decodeWaiters.forEach(item=>item.resolve());});
  await page.waitForTimeout(60);assert.equal(await page.locator('#slice').getAttribute('src'),displayed);
  await page.evaluate(()=>{window.failDecode=true;const j=document.getElementById('j');j.value='.43';j.dispatchEvent(new Event('change'));});
  await page.waitForFunction(()=>document.getElementById('status').textContent.includes('Synthetic PNG decode failure'));
  assert.equal(await page.locator('#slice').getAttribute('src'),displayed);
  const d=await capturePerformance(page);assert.equal(d.displayed.j,.42);assert.equal(d.requested.j,.43);
  await page.evaluate(()=>{window.failDecode=false;document.getElementById('j').dispatchEvent(new Event('change'));});
  await rendered(page);assert.equal(await page.locator('#slice').getAttribute('data-j'),'0.43','same coordinate can retry after decode failure');
  await page.evaluate(()=>window.dispatchEvent(new Event('pagehide')));
  await page.waitForFunction(()=>window.liveUrls.size===0);assert.deepEqual(errors,[]);await page.close();
});

test('unexposed device identity and GPU timers remain explicitly unavailable',{timeout:30000},async()=>{
  const page=await mockPanel({performance:true,backend:'WebGL2',hideDevice:true});await warmed(page);
  const diagnostic=await capturePerformance(page);
  assert.equal(diagnostic.device.vendor,'');assert.equal(diagnostic.device.renderer,'');assert.equal(diagnostic.device.software,null);
  assert.equal(diagnostic.displayed.timings.gpuMs,null);assert.equal(diagnostic.displayed.timings.gpuTimer,'unavailable');
  assert.match(await page.locator('#renderer').textContent(),/device unknown/);await page.close();
});

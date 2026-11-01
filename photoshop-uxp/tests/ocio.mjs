import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
const {ColorCore}=await import(pathToFileURL(path.join(process.env.EXT_PLUGIN,'test-api.mjs')));
const core=await ColorCore.create();
const oracle=JSON.parse(execFileSync(process.env.EXT_PYTHON,[path.join(process.env.EXT_ROOT,'references/ocio_oracle.py')],{maxBuffer:8e6}));
function near(actual,expected,tolerance=5e-4) {
  actual.forEach((v,i)=>assert.ok(Number.isFinite(v)&&Math.abs(v-expected[i])<=tolerance*Math.max(1,Math.abs(expected[i])),`${i}: ${v} vs ${expected[i]}`));
}
for(const view of [0,1,2,4]) {
  test(`OCIO ${view}: inverse authoring, forward view, and neutral surround`,()=>{
    oracle.picker.codes.forEach((code,i)=>{
      const values=core.evaluate(view,code,true);
      if (!values[0]) return; // Boundary validity is covered by Rust and gamut tests.
      near([...values.slice(1,4)],oracle.picker.scene[i],8e-4);
      near([...values.slice(23,26)],oracle.picker.source_rec2020[i],2e-6);
      near([...values.slice(26,29)],oracle.picker.views[view].rgb[i],8e-4);
      near([...values.slice(29,32)],oracle.picker.views[view].background_rgb[1],8e-4);
      const imported=core.import([...values.slice(1,4)],true);
      assert.equal(imported[0],1,'representable OCIO scene has available coordinates');
      near([...imported.slice(1,4)],oracle.picker.import_codes[i],3e-5);
    });
    // Forward checks include >1 highlights and saturated scene-linear colors.
    const matrix=view===0?[[1.71665118797,-.35567078378,-.25336628137],[-.66668435183,1.61648123663,.01576854581],[.01763985745,-.04277061326,.94210312124]]:
      view===1?[[3.2409699419,-1.5373831776,-.4986107603],[-.9692436363,1.8759675015,.0415550574],[.0556300797,-.2039769589,1.0569715142]]:
      [[2.4934969119,-.9313836179,-.4027107845],[-.8294889696,1.7626640603,.0236246858],[.0358458302,-.0761723893,.9568845240]];
    oracle.vectors.forEach((scene,i)=>{
      const xyz=oracle.profiles[view].forward_xyz[i];
      near([...core.view(view,scene)],matrix.map(row=>row.reduce((sum,v,c)=>sum+v*xyz[c],0)),.0015);
    });
  });
  test(`OCIO ${view}: all 18 ColorChecker indicators`,()=>{
    const patches=core.checker(view);
    assert.equal(patches.length,126);
    oracle.colorchecker.views[view].forEach((rgb,i)=>near([...patches.slice(i*7+3,i*7+6)],rgb,7e-4));
    oracle.colorchecker.codes.forEach((code,i)=>near([...patches.slice(i*7,i*7+3)],code,3e-5));
  });
}

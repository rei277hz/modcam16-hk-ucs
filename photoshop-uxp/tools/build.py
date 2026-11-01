"""Buck2 action/test driver. All JavaScript is executed by the :node target."""
import argparse
import base64
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import zipfile
from shader import fragment

p = argparse.ArgumentParser()
p.add_argument('operation')
for name in ('root', 'out', 'node', 'rustc', 'modules', 'browser', 'plugin', 'binary'):
    p.add_argument('--' + name)
a = p.parse_args()
root = Path(a.root).resolve()
node = Path(a.node).resolve()
modules = Path(a.modules).resolve()
env = dict(os.environ, PATH=str(node.parent) + os.pathsep + os.environ['PATH'],
           EXT_MODULES=str(modules), EXT_ROOT=str(root), EXT_BROWSER=a.browser or '',
           EXT_PYTHON=sys.executable, EXT_RESULTS=str(modules.parent/'.tools/test-results'))
if a.plugin:
    env['EXT_PLUGIN'] = str(Path(a.plugin).resolve())
browser_libraries = modules.parent/'.tools/browser-libs/usr/lib/x86_64-linux-gnu'
if browser_libraries.is_dir():
    env['LD_LIBRARY_PATH'] = str(browser_libraries) + os.pathsep + env.get('LD_LIBRARY_PATH', '')


def run(*args, **kwargs):
    subprocess.run(list(map(str, args)), check=True, env=env, **kwargs)


lock = json.loads((root/'toolchains.json').read_text())
actual = subprocess.check_output([node, '--version'], text=True).strip()
if actual != 'v' + lock['node']:
    raise RuntimeError('Buck Node version mismatch: ' + actual)
if not (modules/'esbuild/lib/main.js').is_file():
    raise RuntimeError('Run buck2 run //:bootstrap first.')

if a.operation == 'plugin':
    out = Path(a.out).resolve()
    out.mkdir(parents=True, exist_ok=True)
    plugin = out/'plugin'
    plugin.mkdir()
    (plugin/'web').mkdir()
    with tempfile.TemporaryDirectory(prefix='modcam16-build-') as temporary:
        stage = Path(temporary)
        for folder in ('web', 'host'):
            shutil.copytree(root/folder, stage/folder)
        manifest = json.loads((root/'manifest.json').read_text())
        metadata = {key: manifest[key] for key in ('id', 'version')}
        panel = manifest['entrypoints'][0]
        configuration = {key: panel[key] for key in ('minimumSize', 'maximumSize', 'preferredDockedSize', 'preferredFloatingSize') if key in panel}
        (stage/'host/version.ts').write_text('export const EXTENSION = '+json.dumps(metadata)+';\nexport const PANEL_CONFIGURATION = '+json.dumps(configuration)+';\n')
        wasm = out/'color_core.wasm'
        run(a.rustc, root/'color/lib.rs', '--edition=2021', '--crate-type=cdylib',
            '--target=wasm32-unknown-unknown', '-O', '-C', 'panic=abort', '-o', wasm)
        (stage/'web/wasm_bytes.ts').write_text('export const wasmBase64 = '+json.dumps(base64.b64encode(wasm.read_bytes()).decode())+';\n')
        glsl = fragment((root/'web/webgpu.ts').read_text())
        (stage/'web/glsl_source.ts').write_text('export const fragmentShader = '+json.dumps(glsl)+';\n')
        (out/'slice.frag').write_text(glsl)
        run(node, root/'tools/bundle.mjs', stage, out)
        # Preserve the exact generated modules for the typecheck target.
        shutil.copytree(stage, out/'typed-source')
    for name in ('manifest.json', 'panel.html', 'panel.css'):
        shutil.copy2(root/name, plugin/name)
    for name in ('index.html', 'style.css'):
        shutil.copy2(root/'web'/name, plugin/'web'/name)
    shutil.copytree(root/'icons', plugin/'icons')
    for name in ('THIRD_PARTY_NOTICES.md',):
        if (root/name).exists(): shutil.copy2(root/name, plugin/name)
    print('Plugin directory:', plugin)
elif a.operation == 'hdr-audit':
    out = Path(a.out).resolve()
    out.mkdir(parents=True, exist_ok=True)
    run(node, root/'tools/hdr_audit.mjs', Path(a.plugin).resolve(), out)
elif a.operation == 'rust-tests':
    out = Path(a.out).resolve()
    out.mkdir(parents=True, exist_ok=True)
    run(a.rustc, root/'color/lib.rs', '--edition=2021', '--test', '-O', '-o', out/'color-tests')
elif a.operation == 'test-rust':
    run(Path(a.binary).resolve()/'color-tests')
elif a.operation in ('test-unit', 'test-browser', 'test-ocio', 'test-host'):
    run(node, '--test', root/'tests'/f'{a.operation[5:]}.mjs')
elif a.operation == 'typecheck':
    with tempfile.TemporaryDirectory(prefix='modcam16-types-') as temporary:
        stage = Path(temporary)
        shutil.copytree(Path(a.plugin).resolve()/'typed-source', stage/'src')
        (stage/'node_modules').symlink_to(modules, target_is_directory=True)
        config = json.loads((root/'tsconfig.json').read_text())
        config['include'] = ['src/**/*.ts']
        (stage/'tsconfig.json').write_text(json.dumps(config))
        run(node, modules/'typescript/bin/tsc', '--project', stage/'tsconfig.json')
elif a.operation == 'package':
    out = Path(a.out).resolve()
    out.mkdir(parents=True, exist_ok=True)
    plugin = Path(a.plugin).resolve()/'plugin'
    run(node, root/'tools/package.mjs', plugin, out)
    archives = list(out.glob('*.ccx'))
    assert len(archives) == 1, 'Expected exactly one Photoshop package'
    with zipfile.ZipFile(archives[0]) as package:
        assert package.testzip() is None
        expected = {str(p.relative_to(plugin)) for p in plugin.rglob('*') if p.is_file()}
        assert set(package.namelist()) == expected, 'CCX contents differ from plugin directory'
        for name in expected - {'manifest.json'}:
            assert package.read(name) == (plugin/name).read_bytes(), name
        assert json.loads(package.read('manifest.json')) == json.loads((plugin/'manifest.json').read_text())
    print('CCX contents, manifest, CRCs, and runtime byte equality verified.')
else:
    raise ValueError(a.operation)

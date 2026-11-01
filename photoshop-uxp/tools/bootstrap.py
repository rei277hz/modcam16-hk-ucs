"""Provision tools only. Build/test/package operations belong to Buck2 targets."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import argparse

arguments = argparse.ArgumentParser()
arguments.add_argument('--node', required=True)
args = arguments.parse_args()

root = Path.cwd()
if not (root / '.buckroot').exists() or not (root / 'GOAL.md').exists():
    raise SystemExit('Run buck2 run //:bootstrap from photoshop-uxp.')
lock = json.loads((root / 'toolchains.json').read_text())
node = str(Path(args.node).resolve())
rustc = shutil.which('rustc')
if not rustc:
    raise SystemExit('Put Rust 1.99.0 on PATH before bootstrap.')
os.environ['PATH'] = str(Path(node).parent) + os.pathsep + os.environ.get('PATH', '')
npm = [node, str(Path(node).parent.parent / 'lib/node_modules/npm/bin/npm-cli.js')]
def run(args, **kwargs):
    subprocess.run(args, check=True, cwd=root, **kwargs)
if subprocess.check_output([node, '--version'], text=True).strip() != 'v' + lock['node']:
    raise SystemExit('Expected Node ' + lock['node'])
if not subprocess.check_output([rustc, '--version'], text=True).startswith('rustc ' + lock['rust'] + ' '):
    raise SystemExit('Expected Rust ' + lock['rust'])
run(['rustup', 'target', 'add', lock['rustTarget']])
if not (root / 'package-lock.json').exists():
    run(npm + ['install', '--package-lock-only', '--ignore-scripts', '--no-audit'])
# Adobe's optional native helper installer does not support Linux. Packaging
# itself is JavaScript. esbuild's platform binary is installed as a locked npm
# optional dependency, so its installer script is unnecessary here as well.
run(npm + ['ci', '--ignore-scripts', '--no-audit', '--no-fund'])
venv = root / '.tools' / 'python'
if not venv.exists():run([sys.executable, '-m', 'venv', str(venv)])
python = venv / 'bin' / 'python'
run([str(python), '-m', 'pip', 'install', 'opencolorio==2.5.0', 'numpy==2.4.2', 'Pillow==12.1.1'])
run([node, str(root / 'node_modules' / 'playwright' / 'cli.js'), 'install', 'chromium'])
browser = subprocess.check_output([node, '--input-type=module', '-e',
    "import {chromium} from 'playwright'; process.stdout.write(chromium.executablePath())"], cwd=root, text=True)
real_rustc = subprocess.check_output(['rustup', 'which', 'rustc'], text=True).strip()
(root / '.buckconfig.local').write_text('[extension]\n' + '\n'.join(
    f'{key} = {value}' for key, value in dict(rustc=real_rustc,
        modules=root / 'node_modules', python=python, browser=browser).items()) + '\n')
print('Tools ready. Run buck2 build //:plugin and buck2 test //tests/...')

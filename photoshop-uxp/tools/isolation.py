"""Prove that only this folder is needed, using a fresh Buck2 root in /tmp."""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import platform
import shutil
import subprocess
import tempfile

p=argparse.ArgumentParser()
p.add_argument('--node',required=True)
p.parse_args()
root=Path.cwd()
if not (root/'GOAL.md').is_file():raise SystemExit('Run from the extension root.')
with tempfile.TemporaryDirectory(prefix='modcam16-standalone-') as temporary:
    isolated=Path(temporary)/'project'
    shutil.copytree(root,isolated,ignore=shutil.ignore_patterns(
        'node_modules','buck-out','.tools','.buckconfig.local','__pycache__','.git','host-results'))
    def run(*args):subprocess.run(args,cwd=isolated,check=True)
    try:
        run('buck2','run','//:bootstrap')
        if platform.system()=='Linux':run('buck2','run','//:browser_deps')
        run('buck2','test','//tests/...')
        run('buck2','build','//:hdr_audit')
        run('buck2','build','//:package')
        (root/'.tools').mkdir(exist_ok=True)
        (root/'.tools/isolation-report.json').write_text(json.dumps({
            'extension':json.loads((root/'manifest.json').read_text())['version'],
            'timestamp':datetime.now(timezone.utc).isoformat(),
            'standaloneCopy':True,'copiedDependencies':False,
            'bootstrap':True,'tests':True,'hdrAudit':True,'package':True,
            'method':'Fresh temporary checkout, independently bootstrapped tools and Buck output',
        },indent=2)+'\n')
    finally:
        subprocess.run(['buck2','kill'],cwd=isolated,check=False)
print('Standalone bootstrap, tests, and packaging pass outside the repository.')

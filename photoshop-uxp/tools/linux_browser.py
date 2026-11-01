"""Optional Debian/Ubuntu CI browser libraries, extracted locally without sudo."""
import argparse
import json
import platform
from pathlib import Path
import subprocess

p=argparse.ArgumentParser()
p.add_argument('--node',required=True)
a=p.parse_args()
if platform.system() != 'Linux':
    raise SystemExit('This helper is only needed on minimal Debian/Ubuntu Linux hosts.')
root=Path.cwd()
directory=root/'.tools/browser-libs'
directory.mkdir(parents=True,exist_ok=True)
packages=['libnspr4','libnss3','libatk1.0-0','libatk-bridge2.0-0','libatspi2.0-0','libcups2','libxcomposite1','libxdamage1','libavahi-common3','libavahi-client3']
for i, name in enumerate(packages):
    policy=subprocess.check_output(['apt-cache','policy',name],text=True)
    if 'Candidate: (none)' in policy:
        packages[i]=name+'t64'
subprocess.run(['apt-get','download',*packages],cwd=directory,check=True)
records=[]
for archive in directory.glob('*.deb'):
    subprocess.run(['dpkg-deb','-x',archive,directory],check=True)
    records.append(archive.name)
(directory/'packages.json').write_text(json.dumps(sorted(records),indent=2)+'\n')
print('Local browser libraries:',directory)

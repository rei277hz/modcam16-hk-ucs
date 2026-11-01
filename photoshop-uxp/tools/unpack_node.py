import pathlib
import sys
import tarfile

archive, destination = map(pathlib.Path, sys.argv[1:])
destination.mkdir(parents=True, exist_ok=True)
with tarfile.open(archive) as source:
    for member in source.getmembers():
        components = pathlib.PurePosixPath(member.name).parts[1:]
        if not components:
            continue
        member.name = str(pathlib.PurePosixPath(*components))
        source.extract(member, destination, filter='data')

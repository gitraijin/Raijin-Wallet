#!/usr/bin/env python3
"""
Restores Unix file modes in a Linux .tar.gz built on Windows.

electron-builder on Windows writes every file as 0644, so the app binary
and Tor would not start. On Linux/macOS (and in CI) this is not needed.

    python scripts/fix-tar-modes.py ../dist/desktop/raijin-0.1.0-linux-x64.tar.gz
"""
import io
import os
import sys
import tarfile

EXECUTABLE_NAMES = {'raijin', 'chrome_crashpad_handler', 'tor'}
# chrome-sandbox must be setuid root to be used; without it Electron falls
# back to the user-namespace sandbox, so 0755 is the safe portable choice.
EXECUTABLE_NAMES.add('chrome-sandbox')


def is_executable(name: str) -> bool:
    base = os.path.basename(name)
    return base in EXECUTABLE_NAMES or '.so' in base


def main(path: str) -> None:
    with tarfile.open(path, 'r:gz') as src:
        members = [(m, src.extractfile(m).read() if m.isfile() else None) for m in src.getmembers()]
    out = io.BytesIO()
    fixed = 0
    with tarfile.open(fileobj=out, mode='w:gz') as dst:
        for member, data in members:
            if member.isdir():
                member.mode = 0o755
            elif member.isfile() and is_executable(member.name):
                member.mode = 0o755
                fixed += 1
            dst.addfile(member, io.BytesIO(data) if data is not None else None)
    with open(path, 'wb') as f:
        f.write(out.getvalue())
    print(f'{path}: {fixed} executables fixed')


if __name__ == '__main__':
    for arg in sys.argv[1:]:
        main(arg)

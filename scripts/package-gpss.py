#!/usr/bin/env python3
"""Package tracked GPSS source from a clean checkout for production deployment."""

import argparse
import hashlib
import io
from pathlib import Path
import subprocess
import tarfile


ROOT = Path(__file__).resolve().parent.parent
EXCLUDED = ("server/seed-data/", "docs/manuals/", "test-results/", "release/")


def git(*args: str) -> bytes:
    return subprocess.check_output(["git", "-C", str(ROOT), *args])


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("output", type=Path, help="destination .tar.gz path")
    args = parser.parse_args()

    if git("status", "--porcelain", "--untracked-files=no").strip():
        parser.error("tracked files have uncommitted changes; commit before packaging")
    commit = git("rev-parse", "HEAD").decode().strip()
    paths = [p.decode() for p in git("ls-files", "-z").split(b"\0") if p]
    paths = [p for p in paths if not p.startswith(EXCLUDED) and not Path(p).name.startswith(".env")]
    output = args.output.resolve()
    if output.exists():
        parser.error(f"output already exists: {output}")
    output.parent.mkdir(parents=True, exist_ok=True)

    with tarfile.open(output, "w:gz") as archive:
        for path in paths:
            source = ROOT / path
            if not source.is_file() or source.is_symlink():
                parser.error(f"expected regular tracked file: {path}")
            info = archive.gettarinfo(str(source), arcname=f"gpss-src/{path}")
            info.uid = info.gid = 0
            info.uname = info.gname = ""
            with source.open("rb") as file:
                archive.addfile(info, file)
        marker = (commit + "\n").encode()
        info = tarfile.TarInfo("gpss-src/DEPLOY_COMMIT")
        info.size = len(marker)
        info.mode = 0o644
        archive.addfile(info, io.BytesIO(marker))

    digest = hashlib.sha256(output.read_bytes()).hexdigest()
    checksum = output.with_name(output.name + ".sha256")
    checksum.write_text(f"{digest}  {output.name}\n", encoding="ascii")
    print(f"{output}\n{checksum}\ncommit={commit}\nsha256={digest}")


if __name__ == "__main__":
    main()

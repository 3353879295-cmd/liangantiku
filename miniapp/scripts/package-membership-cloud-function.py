#!/usr/bin/env python3
"""Create a Linux-safe deployment ZIP for the membership cloud function.

Example:
  python miniapp/scripts/package-membership-cloud-function.py --output dist/membership.zip
"""

from __future__ import annotations

import argparse
import shutil
import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile
import zipfile


SCRIPT_DIR = Path(__file__).resolve().parent
SOURCE_DIR = SCRIPT_DIR.parent / "cloudfunctions" / "membership"
ROOT_FILES = ("index.js", "package.json", "package-lock.json")
SENSITIVE_SUFFIXES = (".pem", ".key", ".p12", ".pfx", ".crt", ".cer", ".log")


def fail(message: str) -> None:
    raise ValueError(message)


def require_regular_file(path: Path) -> None:
    if path.is_symlink():
        fail(f"Refusing symbolic link: {path.relative_to(SOURCE_DIR).as_posix()}")
    if not path.is_file():
        fail(f"Missing required file: {path.relative_to(SOURCE_DIR).as_posix()}")


def is_sensitive(path: Path) -> bool:
    name = path.name.lower()
    return name.startswith(".env") or name.endswith(SENSITIVE_SUFFIXES)


def validate_dependencies(source: Path) -> None:
    package_path = source / "package.json"
    lock_path = source / "package-lock.json"
    sdk_path = source / "node_modules" / "wx-server-sdk" / "package.json"
    for path in (*[source / name for name in ROOT_FILES], sdk_path):
        require_regular_file(path)
    if (source / "lib").is_symlink() or not (source / "lib").is_dir():
        fail("Missing or symbolic-link lib directory")
    if (source / "node_modules").is_symlink() or not (source / "node_modules").is_dir():
        fail("Missing or symbolic-link node_modules directory; run npm ci first")
    package = json.loads(package_path.read_text(encoding="utf-8"))
    lock = json.loads(lock_path.read_text(encoding="utf-8"))
    sdk = json.loads(sdk_path.read_text(encoding="utf-8"))
    declared = package.get("dependencies", {}).get("wx-server-sdk")
    locked = lock.get("packages", {}).get("", {}).get("dependencies", {}).get("wx-server-sdk")
    installed = sdk.get("version")
    resolved = lock.get("packages", {}).get("node_modules/wx-server-sdk", {}).get("version")
    if not all(isinstance(version, str) for version in (declared, locked, installed, resolved)):
        fail("wx-server-sdk version is missing from package metadata")
    if len({declared, locked, installed, resolved}) != 1:
        fail("wx-server-sdk package, lockfile, and installed versions do not match")


def package_files(source: Path) -> list[Path]:
    files = [source / name for name in ROOT_FILES]
    for directory in (source / "lib", source / "node_modules"):
        for path in directory.rglob("*"):
            if path.is_symlink():
                fail(f"Refusing symbolic link: {path.relative_to(source).as_posix()}")
            if path.is_file():
                files.append(path)
    for path in files:
        if is_sensitive(path):
            fail(f"Refusing sensitive file: {path.relative_to(source).as_posix()}")
        if path.relative_to(source).parts[0] == "lib" and path.suffix != ".js":
            fail(f"Non-runtime file in lib: {path.relative_to(source).as_posix()}")
    return sorted(files, key=lambda path: path.relative_to(source).as_posix())


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def archive_manifest(output: Path, source: Path | None = None, files: list[Path] | None = None, source_snapshot: str = "current-source", write_manifest: bool = True) -> Path:
    """Verify the archive against source bytes and write an auditable sidecar manifest."""
    expected = [path.relative_to(source).as_posix() for path in files] if source and files else None
    rows = []
    with zipfile.ZipFile(output) as archive:
        infos = archive.infolist()
        names = [item.filename for item in infos]
        if not all(name in names for name in ROOT_FILES) or not any(name.startswith("lib/") for name in names) or not any(name.startswith("node_modules/") for name in names):
            fail("ZIP is missing the required membership runtime inventory")
        if len(names) != len(set(names)) or (expected is not None and names != expected):
            fail("ZIP file list is not a unique ordered expected source list")
        if archive.testzip() is not None:
            fail("ZIP CRC verification failed")
        for index, item in enumerate(infos):
            name = item.filename
            if name.startswith("/") or ":" in name or "\\" in name or any(part in ("", ".", "..") for part in name.split("/")):
                fail(f"Unsafe ZIP path: {name}")
            if (item.external_attr >> 16) & 0xFFFF != 0o100644:
                fail(f"ZIP mode is not 100644: {name}")
            if is_sensitive(Path(name)):
                fail(f"Refusing sensitive ZIP file: {name}")
            archived = archive.read(item)
            if source and files:
                source_bytes = files[index].read_bytes()
                if archived != source_bytes:
                    fail(f"ZIP bytes differ from source: {name}")
            rows.append({"path": name, "size": len(archived), "sha256": hashlib.sha256(archived).hexdigest(), "crc32": f"{item.CRC:08x}", "mode": "100644"})
    manifest = output.with_suffix(output.suffix + ".manifest.json")
    if write_manifest:
        manifest.write_text(json.dumps({"archive": output.name, "sha256": sha256(output), "sourceSnapshot": source_snapshot, "files": rows}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return manifest


def write_archive(output: Path, source: Path, files: list[Path]) -> Path:
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{output.name}.", suffix=".tmp", dir=output.parent
    )
    temporary = Path(temporary_name)
    expected = [path.relative_to(source).as_posix() for path in files]
    try:
        os.close(descriptor)
        with zipfile.ZipFile(temporary, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for path, name in zip(files, expected):
                info = zipfile.ZipInfo(name)
                info.create_system = 3
                info.compress_type = zipfile.ZIP_DEFLATED
                info.external_attr = 0o100644 << 16
                archive.writestr(info, path.read_bytes())
        os.replace(temporary, output)
        return archive_manifest(output, source, files)
    finally:
        if temporary.exists():
            temporary.unlink()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--output", required=True, type=Path, help="destination ZIP outside the source directory")
    parser.add_argument("--rollback-source", type=Path, help="existing deployed standard ZIP to verify and copy as rollback")
    parser.add_argument("--rollback-output", type=Path, help="destination for verified deployed rollback ZIP; requires --rollback-source")
    parser.add_argument("--rollback-deployed-source", type=Path, help="read-only download of the currently deployed function; required to verify rollback bytes")
    args = parser.parse_args()
    source = SOURCE_DIR.resolve()
    output = args.output.resolve()
    if output == source or source in output.parents:
        parser.error("--output must be outside the membership cloud-function source directory")
    try:
        validate_dependencies(source)
        files = package_files(source)
        manifest = write_archive(output, source, files)
        print(f"Package: {output}")
        print(f"Manifest: {manifest}")
        print(f"Files: {len(files)}")
        print(f"SHA-256: {sha256(output)}")
        if args.rollback_output or args.rollback_source or args.rollback_deployed_source:
            if not all((args.rollback_output, args.rollback_source, args.rollback_deployed_source)):
                parser.error("--rollback-source, --rollback-output, and --rollback-deployed-source must be provided together")
            rollback = args.rollback_output.resolve()
            if rollback == output or rollback == source or source in rollback.parents:
                parser.error("--rollback-output must be a distinct path outside the source directory")
            deployed = args.rollback_source.resolve()
            if not deployed.is_file() or deployed.is_symlink():
                fail("--rollback-source must be a regular existing ZIP")
            if deployed == rollback:
                fail("--rollback-source and --rollback-output must differ")
            deployed_source = args.rollback_deployed_source.resolve()
            if deployed_source == source:
                fail("Rollback requires a separate read-only deployed-source download")
            validate_dependencies(deployed_source)
            deployed_files = package_files(deployed_source)
            archive_manifest(deployed, deployed_source, deployed_files, write_manifest=False)
            rollback.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(deployed, rollback)
            rollback_manifest = archive_manifest(rollback, deployed_source, deployed_files, source_snapshot="deployed-source-byte-verified")
            print(f"Rollback package: {rollback}")
            print(f"Rollback manifest: {rollback_manifest}")
    except (OSError, ValueError, json.JSONDecodeError) as error:
        print(f"Packaging failed: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

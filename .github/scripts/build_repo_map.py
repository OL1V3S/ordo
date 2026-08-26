#!/usr/bin/env python3
"""Generate a lightweight tracked-file/symbol map for Codex planning context."""

from __future__ import annotations

import argparse
import re
import subprocess
from pathlib import Path

SOURCE_EXTENSIONS = {".cs", ".js", ".jsx", ".ts", ".tsx", ".py"}
SKIP_NAMES = {
    "package-lock.json",
    "pnpm-lock.yaml",
    "yarn.lock",
}
MAX_SYMBOLS_PER_FILE = 40
MAX_SYMBOL_LENGTH = 220

PATTERNS = {
    ".cs": [
        re.compile(r"^\s*(?:public|private|protected|internal)?\s*(?:static\s+)?(?:partial\s+)?(?:class|interface|record|enum)\s+[A-Za-z_][A-Za-z0-9_<>]*"),
        re.compile(r"^\s*(?:public|private|protected|internal)\s+(?:static\s+|async\s+|virtual\s+|override\s+|sealed\s+|abstract\s+)*(?:[A-Za-z_][A-Za-z0-9_<>,.?\[\]]*\s+)+[A-Za-z_][A-Za-z0-9_]*\s*\([^;]*\)"),
    ],
    ".js": [
        re.compile(r"^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+[A-Za-z_$][A-Za-z0-9_$]*"),
        re.compile(r"^\s*(?:export\s+)?(?:const|let|var)\s+[A-Za-z_$][A-Za-z0-9_$]*\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][A-Za-z0-9_$]*)\s*=>"),
        re.compile(r"^\s*(?:export\s+)?class\s+[A-Za-z_$][A-Za-z0-9_$]*"),
    ],
    ".jsx": [
        re.compile(r"^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+[A-Za-z_$][A-Za-z0-9_$]*"),
        re.compile(r"^\s*(?:export\s+)?(?:const|let|var)\s+[A-Za-z_$][A-Za-z0-9_$]*\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][A-Za-z0-9_$]*)\s*=>"),
        re.compile(r"^\s*(?:export\s+)?class\s+[A-Za-z_$][A-Za-z0-9_$]*"),
    ],
    ".ts": [
        re.compile(r"^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+[A-Za-z_$][A-Za-z0-9_$]*"),
        re.compile(r"^\s*(?:export\s+)?(?:const|let|var)\s+[A-Za-z_$][A-Za-z0-9_$]*\s*[:=]"),
        re.compile(r"^\s*(?:export\s+)?(?:class|interface|type|enum)\s+[A-Za-z_$][A-Za-z0-9_$]*"),
    ],
    ".tsx": [
        re.compile(r"^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+[A-Za-z_$][A-Za-z0-9_$]*"),
        re.compile(r"^\s*(?:export\s+)?(?:const|let|var)\s+[A-Za-z_$][A-Za-z0-9_$]*\s*[:=]"),
        re.compile(r"^\s*(?:export\s+)?(?:class|interface|type|enum)\s+[A-Za-z_$][A-Za-z0-9_$]*"),
    ],
    ".py": [
        re.compile(r"^\s*(?:async\s+)?def\s+[A-Za-z_][A-Za-z0-9_]*\s*\("),
        re.compile(r"^\s*class\s+[A-Za-z_][A-Za-z0-9_]*"),
    ],
}


def tracked_files(root: Path) -> list[str]:
    result = subprocess.run(
        ["git", "-C", str(root), "ls-files"],
        check=True,
        capture_output=True,
        text=True,
    )
    return [line for line in result.stdout.splitlines() if line]


def symbols_for(path: Path) -> list[str]:
    patterns = PATTERNS.get(path.suffix.lower(), [])
    if not patterns:
        return []
    try:
        lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:
        return []
    symbols: list[str] = []
    for line in lines:
        candidate = line.strip()
        if not candidate or len(candidate) > MAX_SYMBOL_LENGTH:
            continue
        if any(pattern.search(line) for pattern in patterns):
            symbols.append(candidate)
            if len(symbols) >= MAX_SYMBOLS_PER_FILE:
                break
    return symbols


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", default=".")
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    root = Path(args.root).resolve()
    files = tracked_files(root)
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)

    with output.open("w", encoding="utf-8") as handle:
        handle.write("# Ordo repository structural map\n")
        handle.write("# Tracked paths plus concise source symbols; raw file contents are intentionally omitted.\n\n")
        for relative in files:
            handle.write(relative + "\n")
            path = root / relative
            if path.name in SKIP_NAMES or path.suffix.lower() not in SOURCE_EXTENSIONS:
                continue
            for symbol in symbols_for(path):
                handle.write(f"  - {symbol}\n")


if __name__ == "__main__":
    main()

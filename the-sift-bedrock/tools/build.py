#!/usr/bin/env python3
"""Empacota packs/ em dist/The_Sift_Bedrock.mcaddon (BP + RP)."""
import os
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PACKS = os.path.join(ROOT, "packs")
DIST = os.path.join(ROOT, "dist")


def main():
    os.makedirs(DIST, exist_ok=True)
    out = os.path.join(DIST, "The_Sift_Bedrock.mcaddon")
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for pack in sorted(os.listdir(PACKS)):
            base = os.path.join(PACKS, pack)
            for root, _, files in os.walk(base):
                for f in sorted(files):
                    p = os.path.join(root, f)
                    z.write(p, os.path.relpath(p, PACKS))
    print(out, os.path.getsize(out) // 1024, "KB")


if __name__ == "__main__":
    main()

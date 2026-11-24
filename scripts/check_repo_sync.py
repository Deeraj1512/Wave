#!/usr/bin/env python3
"""Compare every local src file against Deeraj1512/Wave@main via git blob SHAs.
One GitHub trees API call + local hashing; prints MATCH / DIFF / MISSING per file."""
import hashlib, json, os, urllib.request

REPO_TREE_URL = "https://api.github.com/repos/Deeraj1512/Wave/git/trees/main?recursive=1"
LOCAL_ROOT = "/home/z/my-project"

def blob_sha(path: str) -> str:
    data = open(path, "rb").read()
    return hashlib.sha1(f"blob {len(data)}\0".encode() + data).hexdigest()

req = urllib.request.Request(REPO_TREE_URL, headers={"User-Agent": "wave-sync-check", "Accept": "application/vnd.github+json"})
with urllib.request.urlopen(req, timeout=30) as r:
    tree = json.load(r)

remote = {t["path"]: t.get("sha") for t in tree.get("tree", []) if t["type"] == "blob"}

# everything under local src/ + key root configs
local_files = []
for base in ("src",):
    for root, _dirs, files in os.walk(os.path.join(LOCAL_ROOT, base)):
        for f in files:
            if f.endswith((".ts", ".tsx", ".css")):
                local_files.append(os.path.relpath(os.path.join(root, f), LOCAL_ROOT))
local_files.sort()

diffs, missing_remote, ok = [], [], 0
for rel in local_files:
    lsha = blob_sha(os.path.join(LOCAL_ROOT, rel))
    rsha = remote.get(rel)
    if rsha is None:
        missing_remote.append(rel)
    elif rsha == lsha:
        ok += 1
    else:
        diffs.append(rel)

print(f"identical: {ok}")
print(f"\nDIFFERENT (local != repo): {len(diffs)}")
for d in diffs:
    print("  ~", d)
print(f"\nNOT IN REPO (local only): {len(missing_remote)}")
for m in missing_remote:
    print("  +", m)

# also: files in repo src/ but not local (user added something?)
extra = [p for p in remote if p.startswith("src/") and p not in set(local_files)]
print(f"\nIN REPO ONLY: {len(extra)}")
for e in extra:
    print("  ?", e)

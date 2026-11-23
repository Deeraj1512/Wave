#!/usr/bin/env python3
"""Verify Wave CI signing setup: YAML parse, keystore base64 roundtrip, gradle sanity."""
import base64, hashlib, subprocess, sys, re

OK, BAD = "✅", "❌"
fails = []

# 1. YAML parse
try:
    import yaml
    with open("/home/z/my-project/.github/workflows/android.yml") as f:
        doc = yaml.safe_load(f)
    steps = doc["jobs"]["apk"]["steps"]
    names = [s.get("name") for s in steps if isinstance(s, dict)]
    assert any("Check signing secrets" in (n or "") for n in names)
    assert any("assembleRelease" in str(s) for s in steps)
    print(f"{OK} android.yml parses; {len(steps)} steps, assembleRelease present")
except Exception as e:
    fails.append(e)
    print(f"{BAD} YAML check failed: {e}")

# 2. base64 roundtrip: keystore -> base64 -> decode -> same bytes
ks = "/home/z/my-project/scripts/signing/wave-release.keystore"
raw = open(ks, "rb").read()
b64 = subprocess.run(["base64", "-w0", ks], capture_output=True, text=True).stdout.strip()
back = base64.b64decode(b64)
h1, h2 = hashlib.sha256(raw).hexdigest(), hashlib.sha256(back).hexdigest()
print(f"{OK if h1 == h2 else BAD} base64 roundtrip: {len(raw)}B -> {len(b64)} chars -> sha256 {'match' if h1==h2 else 'MISMATCH'} ({h1[:16]}…)")
if h1 != h2:
    fails.append("roundtrip")
# secret size vs GitHub 64KB limit
if len(b64) > 64000:
    fails.append("secret too big")

# 3. gradle sanity: key lines present, braces balanced, no leftover versionCode 1
g = open("/home/z/my-project/android/app/build.gradle").read()
checks = [
    ("signingConfigs block", "signingConfigs {" in g and "storeFile file(waveKeystorePath)" in g),
    ("release signingConfig", "signingConfig signingConfigs.release" in g),
    ("env-driven versionCode", "ciRunNumber ? ciRunNumber.toInteger() : 1" in g),
    ("old versionCode 1 gone", not re.search(r"^\s*versionCode 1\s*$", g, re.M)),
    ("applicationId unchanged", 'applicationId "com.deeraj.wave"' in g),
    ("lint safety", "checkReleaseBuilds false" in g),
]
for label, ok in checks:
    print(f"{OK if ok else BAD} build.gradle: {label}")
    if not ok:
        fails.append(label)
if g.count("{") != g.count("}"):
    fails.append("unbalanced braces")
    print(f"{BAD} build.gradle braces: {g.count('{')} vs {g.count('}')}")
else:
    print(f"{OK} build.gradle braces balanced ({g.count('{')})")

# 4. workflow env var names must match build.gradle expectations
for var in ["WAVE_KEYSTORE_FILE", "WAVE_KEYSTORE_PASSWORD", "WAVE_KEY_ALIAS", "WAVE_KEY_PASSWORD"]:
    ok = var in open("/home/z/my-project/.github/workflows/android.yml").read()
    print(f"{OK if ok else BAD} workflow sets {var}")
    if not ok:
        fails.append(var)

print("\nRESULT:", "ALL PASS" if not fails else f"{len(fails)} FAILURES: {fails}")
sys.exit(1 if fails else 0)

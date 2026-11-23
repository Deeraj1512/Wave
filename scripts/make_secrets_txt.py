#!/usr/bin/env python3
"""Build download/ci-signing-update/ package: secrets txt, keystore backup, 2 changed files."""
import subprocess, os, datetime

SRC = "/home/z/my-project/scripts/signing"
OUT = "/home/z/my-project/download/ci-signing-update"
PW = open(f"{SRC}/.pw").read().strip()
B64 = subprocess.run(["base64", "-w0", f"{SRC}/wave-release.keystore"], capture_output=True, text=True).stdout.strip()

os.makedirs(OUT, exist_ok=True)

txt = f"""WAVE APP — GITHUB SECRETS (copy these 4 into GitHub)
=====================================================
Where to put them:  your repo on github.com → Settings → Secrets and
variables → Actions → green "New repository secret" button → add one
by one. Name = left side, Secret = right side (paste exactly).

------------------------------------------------------------
1) Name:  KEYSTORE_BASE64
   Secret:
{B64}
------------------------------------------------------------
2) Name:  KEYSTORE_PASSWORD
   Secret: {PW}
------------------------------------------------------------
3) Name:  KEY_ALIAS
   Secret: wave
------------------------------------------------------------
4) Name:  KEY_PASSWORD
   Secret: {PW}
   (same as KEYSTORE_PASSWORD — that is correct for this keystore)
------------------------------------------------------------

BACKUP CARD (save this file + the keystore somewhere permanent!)
----------------------------------------------------------------
Keystore file : wave-release.keystore (in this same folder)
Alias         : wave
Valid until   : October 2056
Key size      : RSA 2048
SHA-1 fingerprint : FA:27:83:30:A0:53:40:84:DB:55:1C:4E:0D:86:4E:60:4E:0A:77:C2
SHA-256 fingerprint: 99:C4:AB:A2:5F:3F:D1:BF:35:6C:A9:F5:A9:F6:78:9E:C7:A1:D5:E1:9D:D2:69:35:F9:0E:60:B8:9E:33:46:04
Password      : {PW}

RULES
-----
* NEVER upload wave-release.keystore into the repo itself.
* If this keystore is lost, all future updates need uninstall again.
* Order of work on GitHub: FIRST add the 4 secrets, THEN edit the 2 files.
Generated: {datetime.date.today().isoformat()}
"""
with open(f"{OUT}/GITHUB_SECRETS.txt", "w") as f:
    f.write(txt)

import shutil
shutil.copy(f"{SRC}/wave-release.keystore", f"{OUT}/wave-release.keystore")
shutil.copy("/home/z/my-project/.github/workflows/android.yml", f"{OUT}/android.yml")
shutil.copy("/home/z/my-project/android/app/build.gradle", f"{OUT}/build.gradle")

for fn in sorted(os.listdir(OUT)):
    p = f"{OUT}/{fn}"
    print(f"{fn:24s} {os.path.getsize(p):>6} bytes")
print("PACKAGE READY")

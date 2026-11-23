#!/usr/bin/env bash
# Wave — deploy-folder cleanup: removes stale QA artifacts and template leftovers.
# App source (src/), configs, public/, lockfiles and workspace dirs are untouched.
set -u
cd /home/z/my-project

echo "== disk before =="
du -sh . 2>/dev/null

# 1. Stray QA screenshots at root from the early design sessions (superseded;
#    current verification evidence lives in download/)
rm -f ytm-1-home.png ytm-2-mobile.png ytm-3-search.png ytm-4-playing.png \
      ytm-5-aftertap.png ytm-6-nowplaying.png ytm-7-menu.png \
      dhun-1-home.png dhun-2-queue.png dhun-3-radio.png dhun-4-shuffle.png \
      dhun-5-jump.png dhun-6-issue.png dhun-embed-test.png dhun-final-home.png \
      spotify-1-home.png spotify-2-afterplay.png spotify-3-loginwall.png spotify-4-playerbar.png

# 2. Template infrastructure tests (python/database runtime — unrelated to Wave)
rm -rf tests

# 3. Unreferenced template database (no prisma/db usage anywhere in src/)
rm -rf db

# 4. Stale QA evidence in download/ — keep only the current-session verification set
cd download
keep="wave-mediasession-verify.png wave-duration-fix-verify.png wave-total-duration-constant.png wash-vertical-fade.png wash-vertical-fade-full.png wave-progress-fix-verify.png"
for f in *; do
  skip=0
  for k in $keep; do [ "$f" = "$k" ] && skip=1; done
  [ "$skip" -eq 0 ] && rm -f "$f"
done
cd ..

echo "== disk after =="
du -sh . 2>/dev/null
echo "== root now =="
ls -1 /home/z/my-project

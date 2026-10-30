#!/usr/bin/env bash
# Build Couch TV: run the tests and check JS/CSS for Chromium 76.
# Usage: ./build.sh            test + check
#        ./build.sh install    also package build/wgt (signing profile "couch"), install and launch on the TV
set -e
cd "$(dirname "$0")"
TV=${TV:-192.168.1.33}
TIZEN=~/tizen-studio/tools/ide/bin/tizen
SDB=~/tizen-studio/tools/sdb

mkdir -p build
node tests/test_data.js
node tests/test_pstream.js
node tests/test_addons.js
node tests/test_artwork.js
node tests/test_parallax.js
node tests/test_live.js
node tests/test_live_playback.js
node tools/check-js.js

[ "$1" = install ] || exit 0
# The TV's torrent service (docs/tv-torrent-service.md): build, sign, install and start it.
if [ -d tv-service ] && [ -x "$HOME/.dotnet/dotnet" ]; then
  TV=$TV:26101 bash tv-service/build.sh install
else
  echo "Skipping TV torrent service: ~/.dotnet/dotnet is missing"
fi
# Package a copy without the desktop test harnesses.
rm -rf build/wgt && cp -r web build/wgt
rm -f build/wgt/dev.html build/wgt/player-dev.html build/wgt/js/dev-main.js build/wgt/js/mock-data.js
$TIZEN package -t wgt -s couch -- build/wgt
mv build/wgt/*.wgt build/wgt/couchtv.wgt  # the TV installer fails on the space in "Couch TV.wgt"
$SDB connect $TV
$TIZEN install -n couchtv.wgt -- build/wgt -s $TV:26101
$TIZEN run -p CouchTV001.CouchTV -s $TV:26101

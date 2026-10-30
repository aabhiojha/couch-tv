#!/usr/bin/env bash
# Build Couch TV: run the tests and check JS/CSS for Chromium 76.
# Usage: ./build.sh            test + check
#        TV=<TV IP> [PROFILE=<certificate profile>] ./build.sh install
#                              also package build/wgt, sign it, install and launch it on the TV (docs/deployment.md)
set -e
cd "$(dirname "$0")"
PROFILE=${PROFILE:-couch}
TIZEN_STUDIO=${TIZEN_STUDIO:-$HOME/tizen-studio}
TIZEN=$TIZEN_STUDIO/tools/ide/bin/tizen
SDB=$TIZEN_STUDIO/tools/sdb

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
: "${TV:?set TV to the IP of the TV, for example TV=192.168.1.20 ./build.sh install}"
# The TV's torrent service (docs/tv-torrent-service.md): build, sign, install and start it.
if [ -d tv-service ] && [ -x "$HOME/.dotnet/dotnet" ]; then
  TV=$TV:26101 PROFILE=$PROFILE TIZEN_STUDIO=$TIZEN_STUDIO bash tv-service/build.sh install
else
  echo "Skipping TV torrent service: ~/.dotnet/dotnet is missing"
fi
# Package a copy without the desktop test harnesses.
rm -rf build/wgt && cp -r web build/wgt
rm -f build/wgt/dev.html build/wgt/player-dev.html build/wgt/js/dev-main.js build/wgt/js/mock-data.js
$TIZEN package -t wgt -s "$PROFILE" -- build/wgt
mv build/wgt/*.wgt build/wgt/couchtv.wgt  # the TV installer fails on the space in "Couch TV.wgt"
$SDB connect $TV
$TIZEN install -n couchtv.wgt -- build/wgt -s $TV:26101
$TIZEN run -p CouchTV001.CouchTV -s $TV:26101

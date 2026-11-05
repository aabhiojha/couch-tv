#!/usr/bin/env bash
# Build Couch TV: run the tests and check JS/CSS for Chromium 76.
# Usage: ./build.sh            test + check
#        TV=<TV IP> [PROFILE=<certificate profile>] ./build.sh install
#                              also package the app with its TV service, sign it, install and launch it on the TV (docs/deployment.md)
#        ./build.sh package    the unsigned package for a release (no secrets; an installer signs it per TV)
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
node tests/test_espn.js
node tests/test_live_playback.js
python3 tests/test_live_relay.py
node tools/check-js.js

case "$1" in install|package) ;; *) exit 0 ;; esac
[ "$1" = package ] || : "${TV:?set TV to the IP of the TV, for example TV=192.168.1.20 ./build.sh install}"
# One package: the TV service (tv-service/, docs/tv-torrent-service.md) at the root and the web app in res/wgt
# (Tizen's hybrid layout), so the app can launch its service. Signed as a tpk, installed as a wgt.
VERSION=$(sed -n 's/.*id="[^"]*" version="\([0-9.]*\)".*/\1/p' web/config.xml)
bash tv-service/build.sh
rm -rf build/pkg build/couchtv.wgt && mkdir -p build/pkg/res/wgt
cp -r tv-service/out/service/. build/pkg/
sed -i "s/<manifest package=\"CouchTV001\" version=\"[0-9.]*\"/<manifest package=\"CouchTV001\" version=\"$VERSION\"/" build/pkg/tizen-manifest.xml
cp -r web/. build/pkg/res/wgt/
rm -f build/pkg/res/wgt/dev.html build/pkg/res/wgt/player-dev.html build/pkg/res/wgt/js/dev-main.js build/pkg/res/wgt/js/mock-data.js \
  build/pkg/res/wgt/js/dev/sports-sample.json

# ./build.sh package: the unsigned package for a GitHub release, which an installer such as Apps2Samsung signs
# for each TV. It carries the template secrets.js (empty TMDB key, for the installer to fill in), never yours.
if [ "$1" = package ]; then
  cp web/js/secrets.example.js build/pkg/res/wgt/js/secrets.js
  rm -f build/CouchTV.wgt
  (cd build/pkg && zip -qr ../CouchTV.wgt . -x '*/.*' '.*')
  echo "built build/CouchTV.wgt (unsigned, version $VERSION)"
  exit 0
fi
(cd build/pkg && zip -qr ../couchtv.tpk . -x '*/.*' '.*')  # dotfiles aren't signed
$TIZEN package -t tpk -s "$PROFILE" -- "$PWD/build/couchtv.tpk" >/dev/null
mv build/couchtv.tpk build/couchtv.wgt
# The CLI's installer can't read this layout (it wants config.xml at the root); the TV's installer can.
$SDB connect $TV
$SDB -s $TV:26101 push build/couchtv.wgt /home/owner/share/tmp/sdk_tools/tmp/couchtv.wgt
# The first install over a running service sometimes fails with "Register application error"; a retry succeeds.
for attempt in 1 2; do
  out=$($SDB -s $TV:26101 shell 0 vd_appinstall CouchTV001.CouchTV /home/owner/share/tmp/sdk_tools/tmp/couchtv.wgt)
  echo "$out" | grep -E 'completed|failed'
  echo "$out" | grep -q 'install completed' && break
done
echo "$out" | grep -q 'install completed'
# Installing doesn't stop a running service, which would keep serving the old code: stop the package, then start
# the app (it launches its service). `tizen run` failed here with "Could not launch the null application".
$SDB -s $TV:26101 shell 0 kill CouchTV001 >/dev/null || true
$SDB -s $TV:26101 shell 0 execute CouchTV001.CouchTV

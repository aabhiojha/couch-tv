#!/usr/bin/env bash
# Builds and signs the Couch TV torrent service (CouchTor01) and optionally installs and starts it.
#   ./build.sh            build + sign  -> out/CouchTor01-1.0.0.tpk
#   ./build.sh install    ... then install on the TV and start the service
#   ./build.sh test       run the laptop unit tests
# Env: DOTNET (~/.dotnet/dotnet), TIZEN_STUDIO (~/tizen-studio), TV (<TV IP>:26101, needed to install), PROFILE (couch)
set -euo pipefail
cd "$(dirname "$0")"
DOTNET=${DOTNET:-$HOME/.dotnet/dotnet}
TIZEN_STUDIO=${TIZEN_STUDIO:-$HOME/tizen-studio}
TV=${TV:-}
PROFILE=${PROFILE:-couch}
TIZEN=$TIZEN_STUDIO/tools/ide/bin/tizen
SDB=$TIZEN_STUDIO/tools/sdb
TPK=CouchTor01-1.0.0.tpk

if [ "${1:-}" = test ]; then
  exec "$DOTNET" test CouchTor.Tests/CouchTor.Tests.csproj
fi

"$DOTNET" build -c Release CouchTor.Service/CouchTor.Service.csproj -nologo -v q
mkdir -p out
cp CouchTor.Service/bin/Release/tizen80/$TPK out/$TPK
"$TIZEN" package -t tpk -s "$PROFILE" -- out/$TPK >/dev/null
echo "signed out/$TPK"

if [ "${1:-}" = install ]; then
  "$SDB" connect "${TV%%:*}" >/dev/null 2>&1 || true
  "$SDB" -s "$TV" shell 0 kill CouchTor01 >/dev/null 2>&1 || true
  "$TIZEN" install -n $TPK -s "$TV" -- "$PWD/out" | grep -E "successfully|Fail|rror" || true
  "$SDB" -s "$TV" shell 0 execute CouchTor01.Service
fi

#!/usr/bin/env bash
# Builds the Couch TV service (CouchTV001.Service) -> out/service/, the files ../build.sh adds to the app's package.
# It shares the web app's package id, so it is never installed on its own (that would replace the app).
#   ./build.sh            build
#   ./build.sh test       run the laptop unit tests
# Env: DOTNET (~/.dotnet/dotnet)
set -euo pipefail
cd "$(dirname "$0")"
DOTNET=${DOTNET:-$HOME/.dotnet/dotnet}

if [ "${1:-}" = test ]; then
  exec "$DOTNET" test CouchTor.Tests/CouchTor.Tests.csproj
fi

"$DOTNET" build -c Release CouchTor.Service/CouchTor.Service.csproj -nologo -v q
rm -rf out/service && mkdir -p out/service
unzip -q CouchTor.Service/bin/Release/tizen80/CouchTV001-*.tpk -d out/service
rm -f out/service/author-signature.xml out/service/signature*.xml
echo "built out/service"

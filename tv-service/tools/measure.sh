#!/usr/bin/env bash
# Acceptance measurements of the TV torrent service, run from the laptop (docs/tv-torrent-service.md).
# Legal test content only: the Ubuntu 24.04.4 desktop ISO (magnet, no .torrent file).
#   tools/measure.sh speed [runs]   100 MB from offset 0, empty cache each run   (requirement 2)
#   tools/measure.sh cache [capMB]  100 MB at 0, 3 GiB, 5.5 GiB, then 0 again;
#                                   max data dir / min free space, sha256 vs laptop (requirement 3)
#   tools/measure.sh cold [runs]    restart the service, time to the first byte  (requirement 4)
#   tools/measure.sh ref            sha256 of the cache ranges from the laptop's Stremio server
#   tools/measure.sh refhttp        the same from releases.ubuntu.com (HTTP Range on the same ISO)
# Env: TV_IP (192.168.1.6), REF (laptop server, http://192.168.1.34:11470), OUT (/tmp/couch-measure)
set -uo pipefail
TV_IP=${TV_IP:-192.168.1.6}
S=http://$TV_IP:11470
REF=${REF:-http://192.168.1.34:11470}
OUT=${OUT:-/tmp/couch-measure}
SDB="$HOME/tizen-studio/tools/sdb -s $TV_IP:26101"
H=01c137287d6f0ed05a56742dae794f632c79ff3d
MB=$((1 << 20))
OFFSETS="0 3221225472 5905580032 0"
mkdir -p "$OUT"

remove() { curl -s -m 60 "$S/$H/remove" >/dev/null; sleep 15; }  # re-adding a torrent within ~1 s of removing it found no peers for minutes
debug() { curl -s -m 10 "$S/debug${1:-}"; }

ISO=https://releases.ubuntu.com/24.04/ubuntu-24.04.4-desktop-amd64.iso

# curl one 100 MB range; prints "<bytes> <first byte s> <total s> <MB/s from first byte> <sha256>"
fetch() {
  local base=$1 off=$2 end=$(( $2 + 100 * MB - 1 )) shaf
  shaf=$(mktemp)
  local w
  local url=$base/$H/-1
  [ "$base" = "$ISO" ] && url=$ISO
  w=$(curl -s -m 1200 -r "$off-$end" -w "%{size_download} %{time_starttransfer} %{time_total}" -o >(sha256sum | cut -c1-64 >"$shaf") "$url")
  sleep 1
  set -- $w
  awk -v b="$1" -v s="$2" -v t="$3" -v h="$(cat "$shaf")" 'BEGIN { printf "%d %.1f %.1f %.2f %s\n", b, s, t, (t > s ? b / (t - s) / 1048576 : 0), h }'
  rm -f "$shaf"
}

restart() {
  $SDB shell 0 kill CouchTor01 >/dev/null 2>&1
  sleep 2
  $SDB shell 0 execute CouchTor01.Service >/dev/null
  local t0=$(date +%s.%N)
  until curl -s -m 1 "$S/heartbeat" >/dev/null; do sleep 0.2; done
  echo "heartbeat after $(echo "$(date +%s.%N) - $t0" | bc) s"
}

case "${1:-}" in
speed)
  for i in $(seq 1 "${2:-3}"); do
    remove
    echo "run $i: $(fetch "$S" 0)   (bytes, first byte s, total s, MB/s from first byte, sha256)"
  done
  remove ;;
ref)
  for off in 0 3221225472 5905580032; do
    echo "$off $(fetch "$REF" "$off")" | tee -a "$OUT/ref.txt"
  done
  curl -s -m 60 "$REF/$H/remove" >/dev/null ;;
refhttp)
  for off in 0 3221225472 5905580032; do
    echo "$off $(fetch "$ISO" "$off")" | tee -a "$OUT/ref.txt"
  done ;;
cache)
  remove
  [ -n "${2:-}" ] && debug "?cacheCap=$(( $2 * MB ))" >/dev/null
  (while true; do debug | awk '/^cache used/ { u=$3; c=$5; e=$7; d=$(NF-1) } /^free/ { f=$2 } END { print u, c, e, d, f }'; sleep 2; done) >"$OUT/samples.txt" &
  sampler=$!
  for off in $OFFSETS; do
    r=$(fetch "$S" "$off")
    ref=$(awk -v o="$off" '$1 == o { print $NF }' "$OUT/ref.txt" 2>/dev/null | head -1)
    echo "offset $off: $r  $( [ "${r##* }" = "$ref" ] && echo MATCH || echo "MISMATCH (ref $ref)")"
  done
  kill $sampler
  awk '{ if ($4 > d) d = $4; if (f == "" || $5 < f) f = $5; c = $2; e = $3 } END { printf "max data dir %.0f MB, cap %.0f MB, min free %d MB, evicted %d pieces\n", d / 1048576, c / 1048576, f, e }' "$OUT/samples.txt"
  [ -n "${2:-}" ] && debug "?cacheCap=0" >/dev/null
  remove
  echo "after remove: $(debug | grep '^free')" ;;
cold)
  for i in $(seq 1 "${2:-3}"); do
    remove
    sleep 3
    restart
    t0=$(date +%s.%N)
    w=$(curl -s -m 120 -r 0-0 -o /dev/null -w "%{http_code} %{time_starttransfer}" "$S/$H/-1")
    echo "run $i: first byte $w s"
    debug | grep -E '^dht'
  done
  remove ;;
*) sed -n 2,10p "$0"; exit 1 ;;
esac

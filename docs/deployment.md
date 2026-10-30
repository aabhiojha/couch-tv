# Deploying to the TV

## One-time setup

| Thing | Value |
|---|---|
| TV | Samsung UA55AU7700 (Tizen 6.0, Chromium 76) at `192.168.1.33` |
| Laptop (developer host and stream provider) | `192.168.1.34` |
| Tizen Studio CLI | `~/tizen-studio/tools/ide/bin/tizen` and `~/tizen-studio/tools/sdb` |
| Signing profile | `couch` (Samsung TV certificate that includes this TV's DUID) |

1. **Developer Mode on the TV**: open Apps, type `12345`, switch Developer mode **On**, set
   *Host PC IP* to `192.168.1.34`, then restart the TV.
2. **Signing profile**: a Samsung TV certificate profile named `couch`, made in Tizen Studio's
   Certificate Manager. The profiles file contains certificate passwords, so never print or
   commit it.
3. **Check that the TV is reachable**:
   ```sh
   curl -s -m 3 http://192.168.1.33:8001/api/v2/ | python3 -c "import json,sys; d=json.load(sys.stdin)['device']; print(d['PowerState'], d.get('developerMode'), d.get('developerIP'))"
   # expected: on 1 192.168.1.34
   ```

If the TV or laptop IP changes, update `TV` in `build.sh` and `PROVIDER` in `web/js/pstream.js`.

## Build, install and launch

```sh
./build.sh install
```

This runs the tests and the compatibility check, then:

1. Copies `web/` to `build/wgt/` and removes the desktop harnesses (`dev.html`, `player-dev.html`).
2. Packages and signs it: `tizen package -t wgt -s couch`.
3. Renames the package to `couchtv.wgt`. Tizen names it after the app ("Couch TV.wgt"), and the
   TV's installer fails on the space with no explanation.
4. Connects with `sdb`, installs, and launches `CouchTV001.CouchTV`.

Success ends with `Tizen application is successfully launched.` Installing over the existing
app is an update, so its `localStorage` (watch history, My List, settings) should survive.
Uninstalling erases it.

Bump `version` in `web/config.xml` and in `screens/settings.js` (About) for a release.

## Useful commands

```sh
SDB=~/tizen-studio/tools/sdb; S=192.168.1.33:26101
$SDB connect 192.168.1.33                       # then: $SDB devices
$SDB -s $S shell 0 applist                     # installed apps
$SDB -s $S shell 0 was_kill CouchTV001         # stop the app
~/tizen-studio/tools/ide/bin/tizen run -p CouchTV001.CouchTV -s $S
~/tizen-studio/tools/ide/bin/tizen uninstall -p CouchTV001 -s $S
```

## Debugging on the TV

The TV has no console. Uncaught errors are kept in **Settings → App health** (last 20). For a
live session, use the inspector:

```sh
$SDB -s $S shell 0 was_kill CouchTV001                 # the app must not be running
$SDB -s $S shell 0 debug CouchTV001.CouchTV            # prints "... port: NNNNN"
$SDB -s $S forward tcp:NNNNN tcp:NNNNN
CDP=127.0.0.1:NNNNN node tools/shot.js - /tmp/tv "eval:Data.errors()" key:10252 "eval:Player.isOpen()"
$SDB -s $S forward --remove tcp:NNNNN                  # clean up afterwards
```

- `Runtime.evaluate` works, so you can read state, call functions and send key presses.
- The TV never answers `Page.captureScreenshot`, so you can't take screenshots on it. Check
  visuals in desktop Chrome at 1920×1080, or look at the TV.
- If `0 debug` hangs with no output, the app is probably still running: run `was_kill` first.
  Also check that the TV's Developer Mode host IP is this laptop.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `curl` to `:8001` gets no answer | TV off or still booting (about a minute). Wake-on-LAN, or turn it on |
| `sdb devices` shows `offline` | Still booting: `sdb disconnect 192.168.1.33`, wait, connect again |
| "Failed to install Tizen application" with no reason | Space in the `.wgt` name, or the package wasn't signed with `couch` |
| Install fails with a certificate error | Certificate expired, or this TV's DUID isn't in it: recreate the `couch` profile |
| App opens but every row says "Couldn't load" | `js/secrets.js` missing from the package, or no internet |
| Titles say "Can't reach the stream server" | The provider isn't running, or its address changed; see [Stream provider](streaming-provider.md) |
| Media keys do nothing outside the player | `tv.inputdevice` privilege missing from `config.xml`, or key registration failed |

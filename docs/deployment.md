# Deploying to the TV

First-time setup (tools, Developer Mode, certificate, `secrets.js`) is in [INSTALL.md](../INSTALL.md). This page
covers what the install does, and commands for developing and debugging on the TV.

## Build, install and launch

```sh
TV=<TV IP> ./build.sh install            # or: TV=<TV IP> PROFILE=<profile> ./build.sh install
```

This runs the tests and the compatibility check, then:

1. Copies `web/` to `build/wgt/` and removes the desktop harnesses (`dev.html`, `player-dev.html`).
2. Packages and signs it with your certificate profile.
3. Renames the package to `couchtv.wgt`. Tizen names it after the app ("Couch TV.wgt"), and the
   TV's installer fails on the space with no explanation.
4. Connects with `sdb`, installs, and launches `CouchTV001.CouchTV`.

Success ends with `Tizen application is successfully launched.` Installing over the existing
app is an update, so its `localStorage` (watch history, My List, settings) should survive.
Uninstalling erases it.

Bump `version` in `web/config.xml` and in `screens/settings.js` (About) for a release.

## Useful commands

```sh
SDB=~/tizen-studio/tools/sdb; S=<TV IP>:26101
$SDB connect <TV IP>                           # then: $SDB devices
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
  Also check that the TV's Developer Mode host IP is this computer.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `sdb connect` fails | TV off or still booting, or Developer Mode is off or points at another computer's IP |
| `sdb devices` shows `offline` | Still booting: `sdb disconnect <TV IP>`, wait, connect again |
| "Failed to install Tizen application" with no reason | Space in the `.wgt` name, or the package wasn't signed with your TV certificate profile |
| Install fails with a certificate error | Certificate expired, or this TV's DUID isn't in it: recreate the profile with the TV connected |
| App opens but every row says "Couldn't load" | `js/secrets.js` missing from the package, or no internet |
| App disappeared | Developer Mode was turned off or the TV was reset: turn it on again and reinstall |
| Titles say "No sources set up" | Add `addons` or a `provider` to `web/js/secrets.js` and install again; see [Sources](streaming-provider.md) |
| Titles say "Can't reach the stream server" | Your stream server isn't running, or its address changed |
| Media keys do nothing outside the player | `tv.inputdevice` privilege missing from `config.xml`, or key registration failed |

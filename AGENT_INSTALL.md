# Installing Couch TV: instructions for an AI agent

You are helping a person install Couch TV on their Samsung TV from this repository. Do every step you can
yourself in the terminal. Three steps need the person, and are marked **👤 Ask the person**. Explain those in
plain words, one at a time, and wait until they say it's done. Don't show them this file; just guide them.

Work from the repository root. The computer must be Linux or macOS (Windows only through WSL, untested) and on
the same network as the TV. Keep the person posted with one short line per step.

Never print, copy or commit `~/tizen-studio-data/profile/profiles.xml` or anything in `~/SamsungCertificate`:
they hold the person's certificate passwords and private keys.

## 0. Already set up?

```sh
~/tizen-studio/tools/ide/bin/tizen security-profiles list
```

If this lists a profile, the person has installed before: skip to step 5 (and pass `PROFILE=<name>` if the
profile isn't called `couch`). If the command isn't found, start at step 1.

## 1. Install the tools

Check what's there with `node -v`, `python3 --version`, `java -version`, `zip -v`. Install what's missing with
the system's package manager (`apt`, `dnf`, `brew`); ask before using `sudo`.

- **Node.js 22 or newer**, **Python 3** and **zip**: the build runs the tests with them.
- **Tizen Studio (command-line version)**, into `~/tizen-studio`. On Linux:
  ```sh
  curl -fLO https://download.tizen.org/sdk/Installer/tizen-studio_6.1/web-cli_Tizen_Studio_6.1_ubuntu-64.bin
  chmod +x web-cli_Tizen_Studio_6.1_ubuntu-64.bin
  ./web-cli_Tizen_Studio_6.1_ubuntu-64.bin --accept-license "$HOME/tizen-studio"
  rm web-cli_Tizen_Studio_6.1_ubuntu-64.bin
  ```
  On macOS use `web-cli_Tizen_Studio_6.1_macos-64.bin` from the same folder. If 6.1 is gone, list
  `https://download.tizen.org/sdk/Installer/` and take the newest version. If the installer complains about
  Java, install OpenJDK 17 and run it again.
- **Samsung TV extensions and the Samsung certificate extension**:
  ```sh
  ~/tizen-studio/package-manager/package-manager-cli.bin install --accept-license \
    TV-SAMSUNG-Public,TV-SAMSUNG-Extension-Tools,cert-add-on
  ```
  Check with `package-manager-cli.bin show-pkgs | grep -E '^i .*(TV-SAMSUNG|cert-add-on)'`.
- **.NET 8 SDK** (for torrents; Couch TV installs without them if this is missing):
  ```sh
  curl -sSL https://dot.net/v1/dotnet-install.sh | bash -s -- --channel 8.0
  ```
  It goes to `~/.dotnet`, which is where `build.sh` looks.

Then run `./build.sh` (no arguments). It runs the tests and must end without errors.

## 2. 👤 Ask the person: turn on Developer Mode on the TV

Find this computer's IP on the home network (the `src` address in `ip -4 route get 1.1.1.1` on Linux, `ipconfig getifaddr en0` on
macOS) and give it to them. Then ask them to:

1. Open **Apps** on the TV and type `1 2 3 4 5` with the remote's number keys (or the on-screen keypad).
2. Turn **Developer mode** On, enter **Host PC IP** = the IP you gave them, and press OK.
3. Restart the TV: hold the remote's Power button until it turns off and on again.
4. Read the TV's IP from **Settings → General → Network → Network Status → IP Settings**, and tell you.

If they can't find the TV's IP, look for it yourself. Samsung TVs answer on port 8001:

```sh
for i in $(seq 1 254); do curl -s -m 1 http://192.168.1.$i:8001/api/v2/ | grep -q 'Samsung SmartTV' && echo 192.168.1.$i; done
```

(Use the computer's own subnet in place of `192.168.1`.)

Check it worked:

```sh
curl -s http://<TV IP>:8001/api/v2/ | python3 -c "import json,sys; d=json.load(sys.stdin)['device']; print(d['modelName'], 'developerMode', d.get('developerMode'), 'host', d.get('developerIP'))"
```

You want `developerMode 1` and `host` = this computer's IP. If not, ask them to repeat steps 1–3. No reply at
all means the TV is off or still starting: wait a minute and try again.

## 3. Connect

```sh
~/tizen-studio/tools/sdb connect <TV IP>
~/tizen-studio/tools/sdb devices
```

The TV must show as `device`. If it shows `offline`, run `sdb disconnect <TV IP>`, wait a minute and connect
again. Keep it connected for step 4: that is how the TV's ID gets into the certificate.

## 4. 👤 Ask the person: make their Samsung certificate

Samsung only runs a developer app signed with a certificate that names this TV. Making one needs the person's
Samsung account, in a window you can't drive. Open it for them:

```sh
~/tizen-studio/tools/certificate-manager/certificate-manager &
```

(On Linux, if it hangs, start it with `GDK_BACKEND=x11` in front.) Then walk them through it:

1. Click **+**, choose **Samsung**, then **TV**.
2. Profile name: `couch`.
3. **Author certificate**: *Create a new author certificate*. Any name, and a password they'll remember.
4. **Samsung account**: sign in when the browser opens (a free account from account.samsung.com). If OK on
   the login page does nothing, press Enter.
5. **Distributor certificate**: *Create a new distributor certificate*, privilege **Public**. The TV's ID
   should already be in the device list. Click Finish.

Check: `tizen security-profiles list` shows `couch`.

## 5. 👤 Ask the person: the TMDB key

Couch TV gets its film and series pages from TMDB, which needs a free API key. Ask them to sign up at
themoviedb.org, open **Settings → API**, request a developer key, and paste you the **API Key** (32 letters and
digits, not the long "Read Access Token").

```sh
[ -f web/js/secrets.js ] || cp web/js/secrets.example.js web/js/secrets.js
```

Put the key in `tmdbKey: '…'` in `web/js/secrets.js`. Check it with
`curl -s -o /dev/null -w '%{http_code}' "https://api.themoviedb.org/3/configuration?api_key=<key>"` (200 is
good, 401 is a wrong key). The file is ignored by git; never commit it.

If they'd rather not paste it to you, leave it empty: the app opens on a screen where they type it with the
remote.

Couch TV plays without any sources set: built-in web sources and the Torrentio add-on for films and series,
PPV and iptv-org for sports. Their own sources (`addons`, `provider`, `playlists` in the same file) are optional
and are the person's choice. Ask if
they have Stremio add-on links or an IPTV playlist; add only what they give you. Never pick or suggest sources
for them. [docs/streaming-provider.md](docs/streaming-provider.md) explains each setting.

## 6. Install

```sh
TV=<TV IP> ./build.sh install
```

Add `PROFILE=<name>` if the certificate profile isn't `couch`. It takes a few minutes the first time. It ends
by opening Couch TV on the TV. Ask the person if they see it.

## If it fails

| Output | Fix |
|---|---|
| `sdb connect` fails | Developer Mode is off, the Host PC IP is wrong, or the TV wasn't restarted: back to step 2 |
| A certificate or signature error | The certificate doesn't include this TV: with `sdb` connected, make the profile again (step 4) |
| "Failed to install" with no reason | The profile name doesn't match: pass `PROFILE=<name>` |
| "Skipping TV torrent service" | The .NET SDK isn't in `~/.dotnet`. Fine without torrents, or install it (step 1) |
| Every row on the TV says "Couldn't load" | Wrong or missing TMDB key, or the TV is offline |

[INSTALL.md](INSTALL.md) has the same steps for a person, with more detail. If you're still stuck, help them
open an issue at https://github.com/aabhiojha/couch-tv/issues with the TV model and the command output.

## Updating later

```sh
git pull
TV=<TV IP> ./build.sh install
```

History, My List and settings are kept. If the app vanished, Developer Mode was turned off: redo step 2, then
install.

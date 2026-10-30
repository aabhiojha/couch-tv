# Installing Couch TV on your Samsung TV

Couch TV isn't in Samsung's app store. You install it yourself, once, using your TV's **Developer Mode**: you
build the app on your computer, sign it with your own free Samsung certificate, and send it to the TV over
your home network. Plan on 30–60 minutes the first time; after that an update is one command.

**You need**

- A Samsung smart TV from 2019 or later (Tizen 5+). Only a 2021 AU7700 (Tizen 6.0) has been tested, so please
  [open an issue](https://github.com/aabhiojha/couch-tv/issues) to say how it went on yours.
- A computer on the same network as the TV, running Linux or macOS. (Windows may work through WSL; untested.)
- A free [Samsung account](https://account.samsung.com) and a free [TMDB account](https://www.themoviedb.org/signup).
- Your own sources: Stremio add-ons, a stream server, or M3U playlists. Couch TV ships none.
  See [Sources](docs/streaming-provider.md).

**Why your own certificate?** Samsung only lets a TV run a developer app signed with a certificate that
lists that TV's unique ID (its DUID). Nobody else's certificate will work on your TV, and you should never
share yours: it contains your private keys.

## 1. Install the tools on your computer

1. **Tizen Studio**: download the installer from
   [developer.tizen.org](https://developer.tizen.org/development/tizen-studio/download) (the CLI version is
   enough) and install it to the default folder, `~/tizen-studio`.
2. **Samsung TV extensions**: open the Package Manager (`~/tizen-studio/package-manager/package-manager.bin`),
   go to the **Extension SDK** tab, and install **TV Extensions** and **Samsung Certificate Extension**.
3. **Node.js 22 or newer** and **Python 3**, from [nodejs.org](https://nodejs.org) and your system's package
   manager. The build runs the app's tests with them.
4. **.NET 8 SDK** (optional, for torrents), installed to `~/.dotnet`:
   ```sh
   curl -sSL https://dot.net/v1/dotnet-install.sh | bash -s -- --channel 8.0
   ```
   This builds the torrent engine that runs on the TV. Without it, Couch TV installs without torrents.
5. **Get Couch TV**:
   ```sh
   git clone https://github.com/aabhiojha/couch-tv.git
   cd couch-tv
   ```

## 2. Turn on Developer Mode on the TV

1. Find your computer's IP address on the home network (for example `ip addr` on Linux, or System Settings →
   Network on macOS). It looks like `192.168.1.20`.
2. On the TV, open **Apps**. Using the remote's number keys (or the on-screen keypad), type `12345`.
3. Switch **Developer mode** to **On**, enter your computer's IP as **Host PC IP**, and press OK.
4. Restart the TV: hold the remote's Power button until the TV turns off and back on.
5. Find the TV's IP: **Settings → General → Network → Network Status → IP Settings**.

## 3. Connect to the TV

```sh
~/tizen-studio/tools/sdb connect <TV IP>
~/tizen-studio/tools/sdb devices
```

The second command should list your TV as `device`. If it says `offline`, wait a minute (the TV is still
starting) and connect again.

## 4. Make your certificate

Keep `sdb` connected while you do this, so your TV's ID is added automatically.

1. Open the Certificate Manager: `~/tizen-studio/tools/certificate-manager/certificate-manager`.
   On Linux, if it hangs, start it with `GDK_BACKEND=x11` in front.
2. Click **+**, choose **Samsung**, then **TV**.
3. Name the profile `couch`. (Any name works; then add `PROFILE=<name>` to the install command below.)
4. **Author certificate**: choose *Create a new author certificate*, enter a name and a password, and continue.
5. **Samsung account**: sign in when the browser opens. If pressing OK on the login does nothing, press Enter.
6. **Distributor certificate**: choose *Create a new distributor certificate* with privilege **Public**.
   Check that your TV's DUID is in the list of devices, then finish.

## 5. Set up your keys and sources

```sh
cp web/js/secrets.example.js web/js/secrets.js
```

Open `web/js/secrets.js` in a text editor:

- `tmdbKey`: your TMDB API key, from [themoviedb.org/settings/api](https://www.themoviedb.org/settings/api)
  (request a free developer key; the "API Key" is the short one). Without it, every row says "Couldn't load".
- `addons`, `provider`, `playlists`, `sportsRelay`: your sources. Each one is explained in the file and in
  [Sources](docs/streaming-provider.md). Without `addons` or a `provider`, playing a title says
  "No sources set up".

This file stays on your computer: git ignores it. It's copied into the app when you install.

## 6. Install

```sh
TV=<TV IP> ./build.sh install
```

This runs the tests, builds and signs the app, installs it with the torrent engine, and opens it on the TV.
It ends with `Tizen application is successfully launched.` Couch TV is now in the TV's Apps list.

## Updating

```sh
git pull
TV=<TV IP> ./build.sh install
```

Installing over the old version keeps your watch history, My List and settings. To change your sources,
edit `web/js/secrets.js` and run the install command again.

## If something goes wrong

| What you see | What to do |
|---|---|
| `sdb connect` fails | Check the TV is on, Developer Mode is On, and **Host PC IP** is this computer's current IP. Restart the TV after changing it |
| `sdb devices` shows `offline` | The TV is still starting: `sdb disconnect <TV IP>`, wait a minute, connect again |
| "set TV to the IP of the TV" | Put `TV=<TV IP>` in front of the command |
| Install fails with a certificate error | Your TV's DUID isn't in the certificate, or it expired: make the profile again with `sdb` connected |
| "Failed to install Tizen application" with no reason | The certificate profile name doesn't match: use `couch` or pass `PROFILE=<name>` |
| "Skipping TV torrent service" | The .NET 8 SDK isn't at `~/.dotnet`: see step 1.4, or ignore it if you don't want torrents |
| Every row says "Couldn't load" | `tmdbKey` is missing or wrong in `web/js/secrets.js`, or the TV has no internet |
| Titles say "No sources set up" | Add `addons` or a `provider` to `web/js/secrets.js` and install again |
| The app disappeared | Developer Mode was turned off or the TV was reset: turn it on again and install again |

Still stuck? [Open an issue](https://github.com/aabhiojha/couch-tv/issues) with your TV model, its year, and
the command's output.

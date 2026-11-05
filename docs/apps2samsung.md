# Installing with Apps2Samsung (in progress)

[Apps2Samsung](https://github.com/Apps2Samsung/Apps2Samsung) is a free installer for Samsung TVs. It creates the
Samsung certificate after one sign-in, signs a package for that TV and installs it, so nobody needs Tizen Studio.
Vetro is installed this way. These are the maintainer's steps to get Couch TV into its community catalog.

## 1. A release with one unsigned package

Tag a version that matches `web/config.xml` (`git tag v0.4.0 && git push origin v0.4.0`).
`.github/workflows/release.yml` builds `CouchTV.wgt` and attaches it to the release as its only asset.

The package contains:
- the TV service at its root and the web app under `res/wgt` (the hybrid layout `build.sh` installs);
- the template `secrets.js`, whose TMDB key is empty, never anyone's own key.

`./build.sh package` builds the same file locally.

## 2. Test it on a TV before submitting

Apps2Samsung reads a package with a `tizen-manifest.xml` as native, so it should sign this one as a tpk. What
hasn't been tried is whether its installer handles the web app under `res/wgt`. `tizen install` can't, which is
why `build.sh` installs with `vd_appinstall`. Install the release file with its command line and open the app:

```sh
apps2samsung-cli install ./CouchTV.wgt --tv TV_IP
```

If the key is empty, Couch TV opens on its setup screen. Type a TMDB key there, or check that the
`user_settings` entry below filled it in.

## 3. The catalog entry

A pull request to [tizen-community-packages](https://github.com/Apps2Samsung/tizen-community-packages) adding
`packages/aabhiojha__couch-tv.json`:

```json
{
  "name": "Couch TV",
  "description": "Films, series and live sports for Samsung TVs, with TMDB catalogs, an Apple TV style interface and a torrent engine on the TV.",
  "category": "streaming",
  "repo": "aabhiojha/couch-tv",
  "source": "release",
  "branch": "main",
  "output_name": "CouchTV.wgt",
  "user_settings": {
    "help_url": "https://github.com/aabhiojha/couch-tv/blob/main/INSTALL.md",
    "file": "res/wgt/js/secrets.js",
    "fields": [
      {
        "key": "tmdb_key",
        "label": "TMDB API key (free at themoviedb.org; leave empty to type it on the TV)",
        "type": "text",
        "required": false,
        "default": "",
        "pattern": "^([0-9a-f]{32})?$",
        "find": "  tmdbKey: '',",
        "replace": "  tmdbKey: '{value}',"
      }
    ]
  }
}
```

The `find` text must stay exactly as it is in `web/js/secrets.example.js`, or the install fails.

Two things to decide before opening the pull request:
- The built-in stream sources pull from unlicensed sites. A catalog listing reaches far more people than the repository does.
- Whether the catalog's rules accept it ("open-source and freely distributable").

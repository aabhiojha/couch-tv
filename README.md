# Couch TV

A streaming app for Samsung smart TVs (Tizen 6, Chromium 76): browse TMDB films and series with
the remote, and play them from the sources you set up: Stremio add-ons (torrents play on the TV), your own
stream server, M3U playlists and a sports relay. Couch TV ships no sources of its own; see
[Sources](docs/streaming-provider.md).

```sh
cp web/js/secrets.example.js web/js/secrets.js   # add your TMDB key and sources
```

```sh
./build.sh           # tests + Chromium 76 compatibility check
./build.sh install   # package, install and launch on the TV
```

Documentation is in [`docs/`](docs/README.md): [user guide](docs/user-guide.md),
[architecture](docs/architecture.md), [development](docs/development.md),
[deploying to the TV](docs/deployment.md) and [sources](docs/streaming-provider.md).

## Contributing

Issues and pull requests are welcome. Run `./build.sh` and
`dotnet test tv-service/CouchTor.Tests/CouchTor.Tests.csproj` first; CI runs both. Say which TV model you
tested on, if any. Never commit `web/js/secrets.js`, signing profiles or certificates.

## License

[MIT](LICENSE). The vendored MonoTorrent is MIT too ([its license](tv-service/vendor/monotorrent/LICENSE)).

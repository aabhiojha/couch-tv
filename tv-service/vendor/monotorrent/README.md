# Vendored MonoTorrent 3.0.2

Source of [MonoTorrent](https://github.com/alanmcgovern/monotorrent) tag `release-v3.0.2`
(commit `e78faebd0aec117146cffccaaea987ab0629eec0`), MIT licence (`LICENSE`). The library
projects under upstream `src/` are compiled here as one `MonoTorrent.dll` (netstandard2.1).

Build-only changes against upstream:
- `src/GitInfoHelper.cs`: the GitInfo package's `ThisAssembly` replaced by a fixed `3.0.2`.
- `src/MonoTorrent.Dht/MonoTorrent.Dht/NullDhtListener.cs` removed: identical internal copy of
  `MonoTorrent.Connections.Dht.NullDhtListener`, which collides when both are in one assembly.

Behaviour changes for the TV are listed in `../../docs` → `docs/tv-torrent-service.md`, and each
is a separate commit touching this directory (`git log -- tv-service/vendor`).

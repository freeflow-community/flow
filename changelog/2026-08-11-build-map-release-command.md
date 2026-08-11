# Docs point at release-macos.sh as the macOS release command

- `[macos]` BUILD.md's artifact table and DEPLOYMENT.md's download section
  still named `publish-dmg.sh --build` after #217 made `release-macos.sh` the
  normal path. Both now name the wrapper, and say what the raw script is still
  for.

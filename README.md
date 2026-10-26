# webos-repo

WebOS Repo to be added to the [webOS Homebrew Channel](https://github.com/webosbrew/webos-homebrew-channel) with my apps.

## Add it to your TV

In the Homebrew Channel, open **Settings → Add repository** and enter:

```
https://pustal.github.io/webos-repo/api/apps.json
```

The apps then appear in the Homebrew Channel's list next to the official ones, and updates show up there as they are released.

For a TV the whole family uses, add this address instead; it lists the same apps without the ones for adults (Stash and Malagueta):

```
https://pustal.github.io/webos-repo/sfw/api/apps.json
```

| App | Description |
| --- | --- |
| [Stash](https://github.com/pustal/StashWebOS) | Client for Stash, the self-hosted media organizer |
| [Malagueta](https://github.com/pustal/Malagueta) | Adult website viewer with ad and pop-up blocking, made for the remote |
| [Prosper LG TV](https://github.com/pustal/ProsperLGTV) | IPTV player for your own M3U playlists, made for the remote |
| [SonicWebMania](https://github.com/pustal/SonicWebMania) | Sonic Mania (decompilation) as a native app; bring your own game data |
| [Animal Crossing](https://github.com/pustal/Animal-Crossing-WebOS) | Animal Crossing (GameCube decompilation) as a native app; bring your own disc image |

## How it works

Each app has one file in [`packages/`](packages), named after the app id (`<id>.yml`), in the same format as the official [apps-repo](https://github.com/webosbrew/apps-repo). An app can be listed here and in the official repository with the same file.

[`scripts/build.mjs`](scripts/build.mjs) turns them into the files the Homebrew Channel reads, in the same layout as `https://repo.webosbrew.org/api/`:

```
public/api/apps.json                          every app (the address added on the TV)
public/api/apps/<id>/full_description.html    each app's description
public/api/apps/<id>/releases/latest.json     each app on its own (used by webOS Dev Manager)
public/index.html                             a page with the address and the apps
public/sfw/...                                the same files for the listing without adult apps
```

An entry with `nsfw: true` is left out of the `sfw/` listing. The field is this repository's own and is never copied into the listings; remove it before submitting an entry to the official repository.

The [Publish workflow](.github/workflows/publish.yml) builds them on every push to `main` and publishes them to GitHub Pages. One-time setup: **Settings → Pages → Source: GitHub Actions**.

Each entry points at its app's **latest** release manifest (`.../releases/latest/download/<id>.manifest.json`), which holds the version, the `.ipk` link and its SHA-256. A new app release therefore reaches TVs without changing anything here: just attach the `.ipk` and the manifest to the app's GitHub release.

## Add an app

1. Make the app's release carry a Homebrew Channel manifest next to the `.ipk`. In StashWebOS this is [`scripts/manifest.mjs`](https://github.com/pustal/StashWebOS/blob/main/scripts/manifest.mjs), run by `npm run package`; copy it for a new app and change the URLs and description. The manifest's fields:

   ```json
   {
     "id": "org.example.app",
     "version": "1.0.0",
     "type": "web",
     "title": "Example",
     "appDescription": "One line shown in the list",
     "iconUri": "https://raw.githubusercontent.com/<user>/<repo>/main/icon.png",
     "sourceUrl": "https://github.com/<user>/<repo>",
     "rootRequired": false,
     "ipkUrl": "org.example.app_1.0.0_all.ipk",
     "ipkHash": { "sha256": "<sha-256 of the .ipk>" }
   }
   ```

   `ipkUrl` is relative to the manifest, so it always points at the `.ipk` of the same release.

2. Add `packages/<app id>.yml`:

   ```yaml
   # Display name
   title: Example
   # Direct link to the icon image (raw.githubusercontent.com, not a github.com/.../blob/ page)
   iconUri: https://raw.githubusercontent.com/<user>/<repo>/main/icon.png
   # The manifest of the latest release
   manifestUrl: https://github.com/<user>/<repo>/releases/latest/download/org.example.app.manifest.json
   # multimedia, game, amblight, screensaver, launcher, utility or system
   category: utility
   # main for open source, non-free otherwise
   pool: main
   # Optional: the oldest webOS version it runs on
   requirements:
     webosRelease: '>=4.0'
   # Long description, in Markdown
   description: |
     What the app does.
   # Optional: screenshots shown above the description
   screenshots:
     - https://example.com/main.png
     - url: https://example.com/player.png
       caption: Playback
   # Optional: sponsor links, like .github/FUNDING.yml
   funding:
     ko_fi: pustal
   # Optional (this repository only): true for apps for adults, which are then
   # left out of the listing without adult apps (sfw/api/apps.json)
   nsfw: false
   ```

3. Run `npm run build` to check it (it downloads the manifest and fails on mistakes such as a missing field, a `.../blob/...` icon link or a manifest for another app id), then push to `main`. Also add the app to the table above.

   An app whose manifest isn't released yet (HTTP 404) is left out with a warning rather than failing the build, so the other apps still get published. It shows up after its first release: re-run the Publish workflow (**Actions → Publish → Run workflow**) or push again.

## Build locally

Requires Node.js 22 (see `.nvmrc`).

```sh
npm install
npm run build            # checks every entry and its manifest, writes public/
npm run build:offline    # the same without downloading manifests
npm run serve            # builds and serves public/ on http://localhost:8000 (the listing without adult apps is under /sfw/)
```

To try the local build on a TV on the same network, add `http://<computer's IP>:8000/api/apps.json` as a repository in the Homebrew Channel.

## Support

If you find these apps useful, please consider [buying me a Ko-fi](https://ko-fi.com/pustal).

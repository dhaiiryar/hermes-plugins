# Local Excalidraw for Hermes Desktop

A standalone Hermes Desktop plugin with Excalidraw 0.18.1, local drawings and embedded raster images. No Excalidraw account, paid subscription or production license key is required. Excalidraw is MIT licensed.

## Open and use

After installation, click **Excalidraw** in the Desktop status bar, or run **Open Excalidraw** from the command palette. The plugin opens one reusable workspace tab.

- **New drawing** creates a separate local document. The Drawing selector switches between documents.
- Draw with Excalidraw's tools. Drop or paste a local PNG, JPEG, WebP or GIF to insert an image.
- **Import** reads a version 2 `.excalidraw` file and creates a new drawing. It never replaces an existing drawing.
- **Export scene** writes an editable `.excalidraw` backup. **PNG** and **SVG** export images.
- **About** explains local storage, limits and font availability.

Wait for **Saved locally** before closing the workspace or quitting Desktop. It means the IndexedDB transaction committed, not just that a save timer fired. A crash, forced quit or closing during unsaved changes can lose the latest edit. There is no shutdown-blocking save hook.

On a save conflict or storage failure, the plugin reports **Not saved** instead of overwriting another window's revision. Use **Export recovery** before reopening. Free disk space if storage is full. A document that cannot initialize does not block selecting another document, and its saved contents remain intact.

If an image fails or takes too long, **Export recovery** downloads the complete scene from before that image started. **Cancel image and restore previous scene** opens that scene in a fresh editor, discarding the unfinished image and any subsequent edits. Export recovery before cancelling if you need a backup. Image cancellation never clears an existing save conflict. A new editor also prevents late image-processing callbacks from changing the restored drawing.

There are no rename or delete controls in this version. To name a drawing, export it, rename the `.excalidraw` file and import it as a new document. Export backups for important work.

## Storage and privacy

The parent Desktop renderer stores drawings in IndexedDB database `hermes-excalidraw-local-v1`, object store `documents`. Each record contains a document ID, title, scene, embedded image data, revision and modification time. The plugin's scoped preference `lastDocument` stores only the selected document ID.

Data lives in the Electron user-data directory for that Desktop installation. It is not saved as one file per drawing in the plugin directory. It is local, unencrypted and shared by windows that use the same renderer origin and Desktop user-data directory. It is not a per-gateway cloud service or a per-Hermes-profile document store. Clearing Desktop app data or changing the user-data directory can make drawings unavailable. Export backups first.

The plugin does not read, migrate, delete or overwrite the earlier `hermes-whiteboard` plugin, its source or its tldraw database. The two plugins have different IDs and database names. Removing a plugin directory is not a drawing backup.

The editor runs in a `SandboxedFrame` with `sandbox="allow-scripts"`, without same-origin access or Electron preload APIs. A tiny data-URL bootstrap receives only the plugin's compiled HTML and opens an opaque blob document. HTTP, HTTPS and WebSocket access is blocked by the editor CSP and runtime guards. Parent messages require the frame source, a per-frame token and the active document ID. The parent validates scenes before committing them. No canvas data is sent to a gateway or remote service.

These restrictions concern this plugin. They do not disable Hermes Desktop's unrelated gateway connections, updates or other plugins.

## Limits and fonts

- Scene import limit is 12 MiB of file data. Serialized scenes and bridge messages also have a 12 MiB length cap. There can be at most 20,000 elements and 100 image files in a scene. Browser storage quotas still apply.
- Only embedded PNG, JPEG, WebP and GIF media is accepted. SVG insertion, remote media and embedded websites are disabled. Element links remain inactive in the editor, are preserved in editable scene exports, and are omitted from image exports so exported SVGs cannot activate them. SVG image export remains available.
- Collaboration, cloud libraries, AI and Mermaid conversion are disabled. This is the embedded drawing editor, not the Excalidraw website.
- The bundle includes 25 upstream font files from Assistant, Cascadia, Comic Shanns, Excalifont, Liberation, Lilita, Nunito and Virgil. Font binaries are not modified by this project.
- The 209 Xiaolai CJK subsets are omitted to keep the plugin small. CJK and other missing glyphs depend on system font fallback. They may not render if a suitable font is unavailable. This project does not claim full CJK coverage.
- SVG exports intentionally do not embed fonts. Text may look different on another computer. PNG preserves the appearance rendered on this machine. Editable scene exports preserve text and font selections.

Full npm and font copyright/license text is in `dist/THIRD_PARTY_NOTICES.md` and installed alongside `plugin.js`. The normal build is offline after dependencies are present. `scripts/vendor-licenses.mjs` is an explicit maintainer-only network operation to populate missing upstream license files. It preserves existing vendored files.

## Build and verify

Requirements: Node with npm, the pinned dependencies in `package-lock.json`, Playwright's Chromium, and a working packaged Hermes Desktop for the native smoke. The recorded development versions are Node 26.12.1 and npm 12.2.1. Dependency lifecycle scripts are not needed.

```sh
cd hermes-excalidraw
npm ci --ignore-scripts
npm run verify
```

`npm run verify` runs these commands in order and stops on failure:

```sh
npm run build
npm test
npm run test:e2e
npm audit --json
npm audit signatures
npm run test:desktop
```

The build bundles the editor, fonts and parent plugin, then generates notices from the actual esbuild dependency graph. The audit uses npm's advisory service and signature checks use registry metadata, so verification requires network access. Drawing at runtime does not.

The native smoke defaults to this existing packaged executable, not a development server:

```text
$HOME/.hermes/hermes-agent/apps/desktop/release/linux-unpacked/Hermes
```

It launches a separate instance with an isolated HOME, HERMES_HOME and Electron user-data directory beneath `$TMPDIR`, using explicit Wayland. A cold isolated backend install can take longer than a minute; the smoke waits up to three minutes for the Desktop connecting overlay to clear. It does not automate the user's main Desktop instance. Override the paths if necessary:

```sh
EXCALIDRAW_HERMES_ROOT=/path/to/hermes-agent \
EXCALIDRAW_DESKTOP=/path/to/packaged/Hermes \
TMPDIR="$HOME/.hermes/cache/scratch" npm run test:desktop
```

The smoke checks the actual SDK plugin root, visible workspace, opaque sandbox, drawing, raster image insertion, committed persistence after a renderer reload, JSON/PNG/SVG generation, visible notices and absence of guest HTTP requests or JavaScript errors. Image exports are exercised through the authenticated bridge. The operating system's native Save dialog is not automated, and this smoke is a renderer reload rather than a complete Desktop process restart. Unit tests separately close and reopen the database.

Evidence:

- `dist/build.json`: bundle bytes, embedded font counts, bundle SHA-256 and source fingerprint.
- `dist/THIRD_PARTY_NOTICES.md`, `dist/notices-manifest.json`: full license text and package inventory.
- `test-results/unit.log`, `e2e.log`, `audit.json`, `signatures.log`, `desktop.log`: command output from full verification.
- `test-results/browser-results.json`, `test-results/browser-smoke.png`: Chromium results and screenshot.
- `dist/desktop-smoke.json`, `dist/desktop-smoke.png`: packaged-shell results and screenshot. The JSON names the retained isolated data directory.
- `dist/verification.json`: successful verification tied to the exact plugin, source and notices hashes.


## Install without replacing existing plugins

Only install after full verification succeeds:

```sh
npm run install:plugin
```

The default target is `~/.hermes/desktop-plugins/hermes-excalidraw`. The installer refuses if that directory already exists, if verification is stale, or if the verified hashes differ. `EXCALIDRAW_PLUGIN_ROOT` can select another app-level Desktop plugin root. Do not point it at another Hermes profile.

The installer copies `plugin.js`, `build.json`, `verification.json` and `THIRD_PARTY_NOTICES.md`, then reads back the installed plugin to check its hash. `dist/install-receipt.json` records the installed location and hash. Desktop normally notices a new plugin automatically. If it does not, run **Reload desktop plugins** from the command palette. If the user previously disabled the plugin, enable it in Settings → Plugins.

Keep source, license files and the lockfile when redistributing or developing. `LICENSE` covers this plugin's source; vendor licenses continue to cover their respective code and fonts.

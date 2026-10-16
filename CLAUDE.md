# Working on EDEX

A maintained fork of [eDEX-UI](https://github.com/GitSquared/edex-ui), targeting macOS on Apple
Silicon. Electron 43, `nodeIntegration: true`, no build step for the app code.

## Layout

| Path | What lives there |
|---|---|
| `src/_boot.js` | Main process: config seeding, window creation, the terminal websockets, IPC |
| `src/_renderer.js` | Renderer: UI assembly, settings editor, keyboard shortcuts, window helpers |
| `src/_multithread.js` | systeminformation calls spread over worker processes, answered over IPC |
| `src/ui.html` | The page: stylesheets, then every class as a plain `<script>`, then `_renderer.js` |
| `src/classes/` | One file per UI module — clock, netstat, filesystem, terminal, … |
| `src/utils/` | Plain functions with the logic worth testing; everything here is covered by `test/` |
| `src/assets/` | Themes, keyboard layouts, fonts, sounds and CSS, copied or loaded as they are |
| `build/` | electron-builder hooks (`afterPack`, `afterSign`), the dev bundle script, and `lib/` with their testable parts |
| `extras/service-helper/` | Swift agent that publishes the "Open in EDEX" Finder service |
| `test/` | `node:test` unit tests, one file per `src/utils/` module plus `build.test.js`; `fixtures/` holds recorded output |
| `prebuild-minify.js` | Minifies `prebuild-src/` in place before packaging |
| `eslint.config.js` | Tuned for defects, not style; `npm run lint` is expected to stay at zero warnings |

## Commands

```sh
npm run install-darwin   # deps + node-pty rebuilt against Electron's ABI
npm start                # fast launch with --nointro; macOS calls it "Electron", see README
npm run start-app        # launches as EDEX through the dev bundle
npm run lint             # ESLint, tuned for defects rather than style
npm test                 # unit tests
npm run build-darwin     # signed .dmg into dist/; notarised when the identity is a Developer ID
```

`SMOKE.md` is the manual checklist for anything that needs a running app. Run it after a build.

## Conventions

- **Comments explain why, not what.** The codebase is full of workarounds for macOS and Electron
  behaviour that look arbitrary without the reason written down. Match that: if a line exists
  because of a platform quirk, say which quirk.
- **New logic worth testing goes in `src/utils/`** as a plain function, with tests beside the
  existing ones. Everything there is free of side effects except `net.js`, which binds and releases
  loopback ports. Look before writing something similar:
  - `sanitize.js` — `escapeHtml`, `purifyCSS`, `quoteForShell`, `escapePathForPaste`, `encodePathURI`
  - `system.js` — `extractDirFromArgv`, `isAllowedOrigin`, `parseProcessName`, `parseCwdOutput`,
    `pickNextDisplay`, `pickStartDisplay`, `resolveSpawnCwd`, `firstFreeSlot`, `finderServiceHelper`
  - `config.js` — `mergeMissingSettings`, `mergeMissingShortcuts`, `buildShellEnv`,
    `formatEnvSetting` / `parseEnvSetting`, `preferredPort`, `parseShellArgs`
  - `keyboard.js` — `codeForKeySlot`, `applyDeadKey`, `CTRLSEQ`, `KEY_SEQUENCES`, `parseShortcutTrigger`
  - `format.js` — `pad`, `splitDuration`, `formatRuntime`, `formatMediaTime`, `formatBytes`
  - `paths.js` — `shortenPath`, `resolveNamedFile`; `processes.js` — `mergeThreadsByName`, `compareByLoad`;
    `net.js` — `findFreePort`
- **The classes reach utils through `window`.** They are loaded by `<script>` tags, so a `require`
  inside one resolves against `src/`, the page's directory, not against the class file — and
  `terminal.class.js` also runs in the main process, where it resolves the other way. Rather than
  have classes guess, `_renderer.js` requires each helper once and hands it over as
  `window._escapeHtml`, `window._applyDeadKey` and so on. A new helper a class needs gets a line
  there.
- **Build tooling is tested too, but lives in `build/lib/`**: `src/` is packed into the app, and
  build helpers have no business in `app.asar`.
- **The renderer has full Node access**, so anything that reaches the DOM from outside — file names,
  process names, error text, values from `settings.json` — goes through the helpers in
  `src/utils/sanitize.js`, and anything typed into a shell goes through `quoteForShell` or
  `escapePathForPaste`. See `AUDIT.md` for what happens otherwise.
- **Adding a setting touches four places**: the defaults in `_boot.js`, the table row and the
  read-back in `_renderer.js`'s settings editor, and wherever it is consumed. Settings that
  `createWindow` reads need a full restart, not a UI reload.
- **Behaviour changes and refactors go in separate commits**, so a refactor can be reviewed as one
  that changes nothing. Commit subjects are lowercase, `type: what changed and why it mattered` —
  `fix:`, `feat:`, `docs:`, `build:`, `security:`, `refactor:`, `test:`, `chore:` (version bumps).
- **Branches are named after the theme** (`signing`, `encoding`, `hardening`, `refactor`), pushed
  to `origin` and merged through a pull request with a merge commit — the same shape `--no-ff`
  gave when they were merged locally.

## Things that will bite

- **Builds must land outside the project.** macOS hangs an empty `com.apple.FinderInfo` on bundle
  directories in watched locations like the Desktop, and `codesign` refuses to sign anything
  carrying it. Output goes to `~/Library/Caches/edex-build/`. Removing the attribute needs
  `xattr -r -d com.apple.FinderInfo` (`build/lib/xattr.js`); `xattr -cr` gives up before reaching it.
- **Signing is what keeps granted permissions.** macOS binds TCC grants to the code signing
  requirement. With a certificate that requirement names the bundle id and the certificate and
  survives rebuilds; ad-hoc it falls back to the build's hash and every rebuild re-asks for
  everything. The identity is in `build/signing.env`, git-ignored.
- **A Developer ID build is a different build.** `build/build-darwin.js` checks the keychain, and
  for a Developer ID it adds the hardened runtime, trusted timestamps and
  `build/entitlements.mac.plist` on top of `package.json`, whose fast local settings stay as they
  are (`build/lib/signing.js`). Under the hardened runtime whatever a program in the terminal asks
  macOS for is charged to EDEX and refused without a prompt unless the entitlements grant it:
  Apple events, the microphone and the camera are there, and anything else a shell turns out to
  need goes there too. Notarisation runs whenever `APPLE_KEYCHAIN_PROFILE` is set. `.pak` files
  are not signed one by one there (`signIgnore`): with them every build made ~260 timestamp
  requests and Apple's server gave up partway. Even thirty in a row hit its pauses now and then,
  so those builds put `build/bin/codesign` first on PATH: it retries the one file that got no
  timestamp, where electron-builder's own retry would start the whole pass over.
- **`build/build-darwin.js` must keep its exit-code workaround.** electron-builder's temp-dir
  cleanup calls `process.exit(0)`, so a failed build otherwise exits 0 and `postbuild-darwin`
  copies a stale `.dmg` from the cache into `dist/` as if it were new.
- **`prebuild-src/` is a build artifact.** `prebuild-darwin` deletes it, rsyncs `src/` into it and
  minifies; the minifier never sees `node_modules`.
- **`npm install` inside `src/` rebuilds `node-pty` for Node, not for Electron**, and the terminal
  then fails to load. Run `npm run install-darwin` afterwards, or pass `--ignore-scripts` when only
  removing a package.
- **Inline `onclick` strings see the renderer's globals by name** — `fsDisp`, `electron`,
  `electronWin`, `settingsFile`. Renaming or moving one of those breaks handlers the linter cannot
  see. And never splice data into such a string: HTML escaping is undone before the code runs.
  Pass an index into something the handler can look up (`fsDisp._shown[3]`), or give `Modal` a
  function as the button action.
- **The settings editor rebuilds the settings object from its fields.** A key without a row in the
  editor is dropped from `settings.json` on "Save to Disk" — which is why a new setting needs its row.
- **The renderer's scripts are not in strict mode; class bodies are.** Inside a class a plain
  `function` callback has `this === undefined`; use arrow functions. And `"\033"`-style octal
  escapes in `_renderer.js` would stop parsing the day it gains a `"use strict"`.
- **The layout assumes 16:9.** Sizes are in `vh`/`vw`, and other ratios are patched by exact
  `@media (aspect-ratio: …)` rules in `src/assets/css/extra_ratios.css`, which do not match
  arbitrary window sizes. `keepGeometry` pulls the window back to 16:9 after a resize.
- **Settings live in `~/Library/Application Support/EDEX`** and are migrated once from the old
  `eDEX-UI` folder. Defaults are merged into an existing config on launch, so a new key reaches
  people who already have one — but values already in the file are never overwritten.
- **Running from source shares that folder and the single-instance lock with the installed app.**
  With `/Applications/EDEX.app` open, `npm start` hands its arguments to it and exits.
- **`app.setName()` does not rename the app** as far as macOS is concerned; the name comes from the
  running bundle's `Info.plist`. That is what `build/dev-app.js` exists for.
- **The Finder service only finds the installed app** (`com.edex.ui`). The dev bundle has its own
  bundle id on purpose, so the service does nothing for `npm start` or `npm run start-app`.
- **LaunchServices does not register the Finder helper along with the app.** `lsregister` on
  `EDEX.app` covers `Contents/Frameworks`, not `Contents/Library/Services`, and an unregistered
  helper means no menu entry. EDEX runs the helper with `--register` on every launch from an
  Applications folder, so after an install the entry appears once the app has been started.

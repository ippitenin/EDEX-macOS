# Contributing to EDEX

How to run, test and build EDEX from source. The conventions and the macOS and Electron quirks
worth knowing before changing anything are collected in [CLAUDE.md](CLAUDE.md); anything that
needs a running app is in the manual checklist, [SMOKE.md](SMOKE.md).

You need macOS 12 or later on Apple Silicon, the Xcode command line tools, Node.js and npm.

## Running from source

```sh
npm run install-darwin   # installs deps and rebuilds node-pty against Electron's ABI
npm start
```

`npm start` runs `electron src --nointro` — the boot log is skipped — which launches the Electron
bundle from `node_modules` and loads the project inside it — so macOS calls the app "Electron" in the menu bar, the Dock and the process
list, and shows Electron's icon. That name comes from that bundle's `Info.plist`; `app.setName()`
is documented as not affecting it.

```sh
npm run start-app        # same code, but running as EDEX
```

`start-app` builds an `EDEX.app` around the same Electron binary with our own `Info.plist` and icon,
and symlinks its app directory to `src/` — so it is EDEX everywhere macOS shows a name, while edits
still take effect on the next launch with no rebuild. The bundle lives in
`~/Library/Caches/edex-build/dev/` and is rebuilt only when the Electron version changes. See
[build/dev-app.js](build/dev-app.js).

Both share the config folder and the single-instance lock with an installed EDEX: with
`/Applications/EDEX.app` running, they hand their arguments to it and exit. The Finder service only
ever talks to the installed app.

## Checks

```sh
npm run lint   # ESLint, tuned for real defects rather than style; expected to stay at zero warnings
npm test       # unit tests on node:test
```

The tests cover everything in `src/utils/` and `build/lib/`: escaping and shell quoting, config
seeding and the shell environment, argv, origin and port handling, the keyboard's slot map, dead
keys and control sequences (held to output recorded from the code they replaced), path fitting,
number formatting, and the names the build and the Finder helper must agree on.

Anything that needs a running app is in [SMOKE.md](SMOKE.md); run through it after a build.
[CLAUDE.md](CLAUDE.md) collects the conventions and the platform quirks worth knowing before
changing anything here.

## Building a distributable

```sh
npm run build-darwin
```

That is the whole thing — npm runs `prebuild-darwin` and `postbuild-darwin` around it. The app is
built and signed under `~/Library/Caches/edex-build/`, and the finished `.dmg` is copied into
`dist/`.

The output lives outside the project on purpose. macOS asynchronously puts an empty
`com.apple.FinderInfo` on bundle directories in watched locations like the Desktop, and `codesign`
refuses to sign anything carrying it — so a build inside such a folder fails partway through
signing the nested bundles, unpredictably.

## Signing, and why it matters here

macOS binds granted permissions — Desktop, Documents, Downloads, Photos, Apple Music — to the
app's code signing requirement. Signed with a certificate that requirement names the bundle id and
the certificate, so it survives rebuilds and the permissions stay granted. Signed ad-hoc there is
no certificate to name and macOS falls back to the hash of the build itself, which changes every
time you rebuild: every rebuild looks like a brand new app and re-asks for everything.

The build signs ad-hoc unless you point it at a certificate, which is fine for a one-off build and
tiresome if you rebuild often. To set one up, create a self-signed code signing certificate:

```sh
openssl req -x509 -newkey rsa:2048 -sha256 -days 7300 -nodes \
  -keyout key.pem -out cert.pem -subj "/CN=EDEX Local Signing" \
  -addext "basicConstraints=critical,CA:false" \
  -addext "keyUsage=critical,digitalSignature" \
  -addext "extendedKeyUsage=critical,codeSigning"

openssl pkcs12 -export -legacy -out cert.p12 -inkey key.pem -in cert.pem \
  -name "EDEX Local Signing" -passout pass:changeit
security import cert.p12 -k ~/Library/Keychains/login.keychain-db -P changeit -T /usr/bin/codesign
security add-trusted-cert -r trustRoot -p codeSign -k ~/Library/Keychains/login.keychain-db cert.pem
```

The last command asks for your password and is what makes electron-builder able to find the
certificate — it only looks at identities that are trusted for code signing. Confirm with
`security find-identity -v -p codesigning`, delete `key.pem` and `cert.p12` (the private key now
lives in the keychain), then name the certificate in `build/signing.env`, which is git-ignored:

```sh
export CSC_NAME="EDEX Local Signing"
```

A self-signed certificate solves the rebuild problem on your own machine and nothing else. It
means nothing to anyone else's Mac: Gatekeeper will still refuse a downloaded build until the user
allows it by hand. Distributing without that warning needs an Apple Developer ID and notarisation.

## Developer ID and notarisation

A build for other people's Macs is signed with a **Developer ID Application** certificate from the
Apple Developer Program and notarised by Apple. Name the certificate in `build/signing.env` the
way electron-builder expects it, without the `Developer ID Application:` prefix, and add the
`notarytool` profile:

```sh
export CSC_NAME="Example Ltd (TEAM123456)"
export APPLE_KEYCHAIN_PROFILE="apps-notary"
```

The profile is created once with
`xcrun notarytool store-credentials apps-notary --apple-id <Apple ID> --team-id <Team ID>`, which
asks for an app-specific password. When the identity is a Developer ID, `build/build-darwin.js`
adds what notarisation demands on top of `package.json`: the hardened runtime, trusted timestamps
and the entitlements in `build/entitlements.mac.plist`. electron-builder then notarises the app
and staples the ticket to it, and the `.dmg` opens on any Mac without a warning.

`mac.timestamp` stays `none` in `package.json` deliberately. A trusted timestamp keeps a
signature valid past the certificate's expiry, which is pointless for a local certificate good
until 2046, and it costs a network round-trip to Apple for each of the ~230 nested objects being
signed — the difference between a build that takes ten minutes and one that takes eighty seconds.
Only Developer ID builds pay that, because notarisation refuses a signature without one. They also
leave Chromium's `.pak` resource packs, 223 of the files, to Electron Framework's own signature
instead of signing each one: hundreds of timestamp requests in a row made Apple's server stop
answering, and about thirty remain.

Switching between identities is a new app as far as macOS is concerned: the folder permissions
are asked for once more after the first build with the other certificate.


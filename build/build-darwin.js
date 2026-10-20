// Runs electron-builder for macOS: package.json's config, plus what a Developer ID build needs
// to be notarised (build/lib/signing.js), and then notarises the disk image electron-builder
// leaves unsigned (build/lib/notarize.js). `npm run build-darwin` sources build/signing.env first.

"use strict";

const {execFileSync} = require("child_process");
const os = require("os");
const path = require("path");
const {build, Platform} = require("electron-builder");
const {isDeveloperId, developerIdIdentity, distributionOverrides} = require("./lib/signing.js");
const {notariseDiskImage} = require("./lib/notarize.js");

const config = {
    // Outside the project on purpose: macOS hangs an empty com.apple.FinderInfo on bundle
    // directories in watched locations like the Desktop, and codesign refuses to sign anything
    // carrying it. See "Building a distributable" in CONTRIBUTING.md.
    directories: {output: path.join(os.homedir(), "Library", "Caches", "edex-build")}
};

const identities = execFileSync("security", ["find-identity", "-v", "-p", "codesigning"], {encoding: "utf8"});
const developerId = isDeveloperId(process.env.CSC_NAME, identities);
const notaryProfile = process.env.APPLE_KEYCHAIN_PROFILE;
if (developerId) {
    Object.assign(config, distributionOverrides());
    // codesign with a per-file retry for the timestamp server, see build/bin/codesign.
    process.env.PATH = `${path.join(__dirname, "bin")}${path.delimiter}${process.env.PATH}`;
    console.log("  • Developer ID: hardened runtime, trusted timestamps, notarisation");
    if (!notaryProfile) {
        console.warn("  • APPLE_KEYCHAIN_PROFILE is not set: the app will be signed but not notarised");
    }
}

build({targets: Platform.MAC.createTarget(), config})
    .then(artifacts => {
        if (!developerId || !notaryProfile) return;
        // Synchronous on purpose: nothing may run between here and electron-builder's exit hook.
        for (const dmg of artifacts.filter(file => file.endsWith(".dmg"))) {
            notariseDiskImage(dmg, developerIdIdentity(process.env.CSC_NAME), notaryProfile);
        }
    })
    .catch(error => {
        console.error(error);
        // Setting exitCode alone is not enough: once electron-builder has made a temporary directory,
        // its cleanup hook calls process.exit(0) on the way out, the build "succeeds" and npm goes on
        // to copy whatever stale .dmg is in the cache into dist/. electron-builder's own CLI works
        // around it the same way (electron-userland/electron-builder#2940).
        process.exitCode = 1;
        process.on("exit", () => (process.exitCode = 1));
    });

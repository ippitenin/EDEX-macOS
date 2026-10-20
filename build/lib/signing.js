// Whether a build is one for other people's Macs, and what such a build needs on top of
// package.json.
//
// A Developer ID is the only identity Gatekeeper accepts on somebody else's Mac, and only once
// Apple has notarised the app. Notarisation in turn demands the hardened runtime and a trusted
// timestamp on every signature. A local build signed with a self-signed certificate needs none of
// that, and the timestamps alone would take it from eighty seconds to ten minutes — see "Signing,
// and why it matters here" in CONTRIBUTING.md — so package.json keeps the fast local settings and these
// overrides apply only when the identity is a Developer ID.

"use strict";

const DEVELOPER_ID_PREFIX = "Developer ID Application: ";

// What codesign uses for a bare --timestamp. Spelled out because package.json sets "none", and an
// override has to put something in its place.
const APPLE_TIMESTAMP_SERVER = "http://timestamp.apple.com/ts01";

const ENTITLEMENTS = "build/entitlements.mac.plist";

/**
 * Takes CSC_NAME and the output of `security find-identity -v -p codesigning` and says whether
 * electron-builder is going to sign with a Developer ID.
 *
 * electron-builder wants the name without the "Developer ID Application: " prefix and picks the
 * certificate kind itself, so the same CSC_NAME could also match a development certificate. Only
 * an identity the keychain lists with the Developer ID prefix counts.
 */
function isDeveloperId(cscName, identities) {
    if (!cscName) return false;
    const name = cscName.startsWith(DEVELOPER_ID_PREFIX) ? cscName.slice(DEVELOPER_ID_PREFIX.length) : cscName;
    return identities.split("\n").some(line => line.includes(`"${DEVELOPER_ID_PREFIX}${name}"`));
}

/**
 * The full identity codesign wants for CSC_NAME, which may come with or without the prefix.
 * electron-builder finds the certificate itself; the disk image is signed by codesign directly.
 */
function developerIdIdentity(cscName) {
    return cscName.startsWith(DEVELOPER_ID_PREFIX) ? cscName : `${DEVELOPER_ID_PREFIX}${cscName}`;
}

/**
 * The electron-builder config overrides for a Developer ID build. Notarisation of the app needs no
 * switch: electron-builder notarises it whenever APPLE_KEYCHAIN_PROFILE names a notarytool profile.
 * The disk image is another matter, see build/lib/notarize.js.
 */
function distributionOverrides() {
    return {
        mac: {
            hardenedRuntime: true,
            timestamp: APPLE_TIMESTAMP_SERVER,
            entitlements: ENTITLEMENTS,
            // The Electron helpers run V8 too, and the Finder service helper is signed with them.
            entitlementsInherit: ENTITLEMENTS,
            // @electron/osx-sign signs every file that looks binary, and 223 of the 260 it finds are
            // Chromium's .pak resource packs: data, already sealed by Electron Framework's own
            // signature. Each one cost a timestamp request, and that many in a row got Apple's
            // timestamp server to stop answering, failing the build. Without them some thirty
            // signatures are left, all of them actual code.
            signIgnore: ["\\.pak$"]
        }
    };
}

module.exports = {isDeveloperId, developerIdIdentity, distributionOverrides, ENTITLEMENTS};

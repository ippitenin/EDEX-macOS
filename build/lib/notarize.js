// The disk image half of notarisation.
//
// electron-builder notarises the app and staples the ticket to it, then wraps the app in a .dmg
// that it neither signs nor notarises. The app inside still opens on any Mac, but the image
// itself carries no signature for Gatekeeper to check before it is mounted, and
// `codesign -dv EDEX-macOS-arm64.dmg` says "code object is not signed at all" — which is how 2.4.4
// shipped. So a Developer ID build signs the image with a trusted timestamp, sends it to the
// notary service and staples that ticket too (build/build-darwin.js).

"use strict";

const {execFileSync} = require("child_process");
const path = require("path");

/**
 * Reads what `notarytool submit --wait --output-format json` printed. A rejected submission
 * exits 0 just like an accepted one, so the status in the JSON is the answer; no status at all
 * means the request never reached Apple (no network, or no such keychain profile).
 */
function notaryOutcome(stdout) {
    let result;
    try {
        result = JSON.parse(stdout);
    } catch {
        return {status: null, id: null};
    }
    const field = name => (result && typeof result[name] === "string" ? result[name] : null);
    return {status: field("status"), id: field("id")};
}

/**
 * Signs, notarises and staples the disk image. Throws with Apple's log when it is not accepted.
 * codesign comes from PATH, so a Developer ID build gets the timestamp retry in build/bin.
 */
function notariseDiskImage(dmg, identity, profile) {
    const name = path.basename(dmg);
    console.log(`  • signing ${name}`);
    execFileSync("codesign", ["--force", "--timestamp", "--sign", identity, dmg], {stdio: "inherit"});

    console.log(`  • notarising ${name}, usually a few minutes`);
    let stdout;
    try {
        stdout = execFileSync("xcrun", ["notarytool", "submit", dmg, "--keychain-profile", profile,
            "--wait", "--output-format", "json"], {encoding: "utf8", stdio: ["ignore", "pipe", "inherit"]});
    } catch (error) {
        stdout = error.stdout || "";
    }
    const {status, id} = notaryOutcome(stdout);
    if (!status) {
        throw new Error(`could not submit ${name} for notarisation: no network, or no notarytool profile "${profile}"`);
    }
    if (status !== "Accepted") {
        let log = "";
        try {
            log = execFileSync("xcrun", ["notarytool", "log", id, "--keychain-profile", profile], {encoding: "utf8"});
        } catch {
            // The status alone still says what happened.
        }
        throw new Error(`Apple did not accept ${name} (status ${status})\n${log}`);
    }

    // The ticket inside the image lets Gatekeeper check it without a network connection.
    execFileSync("xcrun", ["stapler", "staple", "-q", dmg], {stdio: "inherit"});
    execFileSync("xcrun", ["stapler", "validate", "-q", dmg], {stdio: "inherit"});
    console.log(`  • ${name} notarised and stapled`);
}

module.exports = {notaryOutcome, notariseDiskImage};

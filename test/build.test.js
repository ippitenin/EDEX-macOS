"use strict";

// Build tooling, and the names the build relies on staying in step across files that know nothing
// of each other. None of this breaks loudly: a mismatch ships an app whose Finder service cannot
// find it, or a version that says one thing in Finder and another in the About box.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const {Arch} = require("builder-util");
const {swiftTargetForArch} = require("../build/lib/arch.js");
const {HELPER_NAME} = require("../build/afterPack.js");
const {finderServiceHelper} = require("../src/utils/system.js");
const {isDeveloperId, developerIdIdentity, distributionOverrides, ENTITLEMENTS} = require("../build/lib/signing.js");
const {notaryOutcome} = require("../build/lib/notarize.js");

const root = path.join(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf-8");

// The one-line <key>…</key><string>…</string> pairs are all this needs from a plist.
function plistString(xml, key) {
    const match = xml.match(new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`));
    return match && match[1];
}

test("the service helper is compiled for the architecture being packaged", () => {
    assert.strictEqual(swiftTargetForArch("arm64"), "arm64-apple-macos11.0");
    assert.strictEqual(swiftTargetForArch("x64"), "x86_64-apple-macos11.0");
});

test("the architecture names come from electron-builder's own enum", () => {
    // afterPack receives context.arch as a number and maps it through Arch.
    assert.strictEqual(swiftTargetForArch(Arch[Arch.arm64]), "arm64-apple-macos11.0");
    assert.strictEqual(swiftTargetForArch(Arch[Arch.x64]), "x86_64-apple-macos11.0");
});

test("architectures the helper cannot be built for are refused", () => {
    // Universal would need both slices joined with lipo; the others are not Macs.
    for (const arch of ["universal", "ia32", "armv7l", undefined, "constructor"]) {
        assert.throws(() => swiftTargetForArch(arch), /cannot be built/, String(arch));
    }
});

test("the helper's minimum macOS matches the target it is compiled for", () => {
    const plist = read("extras/service-helper/Info.plist");
    assert.strictEqual(`arm64-apple-macos${plistString(plist, "LSMinimumSystemVersion")}`, swiftTargetForArch("arm64"));
});

test("the app and src/ declare the same version", () => {
    // Finder shows the root one, app.getVersion() — and so the About box and TERM_PROGRAM_VERSION —
    // reads the one in src/.
    assert.strictEqual(JSON.parse(read("src/package.json")).version, JSON.parse(read("package.json")).version);
});

test("the service helper looks for the bundle id and executable the app is built with", () => {
    const pkg = JSON.parse(read("package.json"));
    const swift = read("extras/service-helper/main.swift");
    assert.ok(swift.includes(`let edexBundleID = "${pkg.build.appId}"`), "bundle id");
    assert.ok(swift.includes(`"Contents/MacOS/${pkg.build.productName}"`), "executable");
});

test("the helper bundle is named the way its Info.plist says", () => {
    const plist = read("extras/service-helper/Info.plist");
    assert.strictEqual(plistString(plist, "CFBundleName"), HELPER_NAME);
    assert.strictEqual(plistString(plist, "CFBundleExecutable"), HELPER_NAME);
    assert.strictEqual(plistString(plist, "NSPortName"), HELPER_NAME);
});

test("the app registers the helper afterPack embeds", () => {
    // The helper is not registered by macOS together with the app; EDEX runs it with --register on
    // every launch. A renamed bundle or a dropped flag would quietly bring the missing menu entry back.
    const helper = finderServiceHelper("/Applications/EDEX.app/Contents/MacOS/EDEX", "/Users/me");
    assert.ok(helper.endsWith(`/Contents/Library/Services/${HELPER_NAME}.app/Contents/MacOS/${HELPER_NAME}`), helper);
    assert.ok(read("src/_boot.js").includes(`["--register"]`), "_boot.js passes the flag");
    assert.ok(read("extras/service-helper/main.swift").includes(`"--register"`), "main.swift reads the flag");
});

// What `security find-identity -v -p codesigning` prints, trimmed to the shapes that matter.
const IDENTITIES = [
    '  1) 33F6EA11F107A464E5E6DED5351C0899B3E860C5 "EDEX Local Signing"',
    '  2) 65A33C5140CDD6E1FAB2A6BB16049EAAB29865FF "Apple Development: Jane Doe (ABCDE12345)"',
    '  3) 4611211DDBE60AA366171141EC3DA1D783B507C6 "Developer ID Application: Example Ltd (TEAM123456)"',
    "     3 valid identities found"
].join("\n");

test("only a Developer ID in the keychain makes a distribution build", () => {
    assert.strictEqual(isDeveloperId("Example Ltd (TEAM123456)", IDENTITIES), true);
    // electron-builder strips the prefix with a warning; it means the same certificate.
    assert.strictEqual(isDeveloperId("Developer ID Application: Example Ltd (TEAM123456)", IDENTITIES), true);
    assert.strictEqual(isDeveloperId("EDEX Local Signing", IDENTITIES), false, "self-signed");
    assert.strictEqual(isDeveloperId("Jane Doe (ABCDE12345)", IDENTITIES), false, "development certificate");
    assert.strictEqual(isDeveloperId("Example Ltd", IDENTITIES), false, "a partial name is not the identity");
    assert.strictEqual(isDeveloperId("Other Ltd (OTHER12345)", IDENTITIES), false, "not in the keychain");
    assert.strictEqual(isDeveloperId(undefined, IDENTITIES), false, "no CSC_NAME, ad-hoc");
});

test("the disk image is signed with the full Developer ID name", () => {
    // electron-builder takes CSC_NAME without the prefix; codesign needs the whole identity.
    assert.strictEqual(developerIdIdentity("Example Ltd (TEAM123456)"), "Developer ID Application: Example Ltd (TEAM123456)");
    assert.strictEqual(developerIdIdentity("Developer ID Application: Example Ltd (TEAM123456)"),
        "Developer ID Application: Example Ltd (TEAM123456)", "the prefix is not doubled");
});

test("a notarisation is judged by its status, not by the exit code", () => {
    // notarytool exits 0 for a rejected submission too.
    assert.deepStrictEqual(notaryOutcome('{"id":"9368928b","status":"Accepted","message":"Processing complete"}'),
        {status: "Accepted", id: "9368928b"});
    assert.deepStrictEqual(notaryOutcome('{"id":"dfb01d24","status":"Invalid","message":"Processing complete"}'),
        {status: "Invalid", id: "dfb01d24"});
    // Nothing usable means the request never reached Apple.
    assert.deepStrictEqual(notaryOutcome(""), {status: null, id: null});
    assert.deepStrictEqual(notaryOutcome("Error: No Keychain password item found for profile: apps-notary"), {status: null, id: null});
    assert.deepStrictEqual(notaryOutcome("null"), {status: null, id: null});
    assert.deepStrictEqual(notaryOutcome('{"status":42}'), {status: null, id: null});
});

test("a distribution build gets what notarisation demands", () => {
    // package.json keeps the fast local settings; notarytool rejects an app without these.
    const pkg = JSON.parse(read("package.json"));
    assert.strictEqual(pkg.build.mac.hardenedRuntime, false);
    assert.strictEqual(pkg.build.mac.timestamp, "none");
    const {mac} = distributionOverrides();
    assert.strictEqual(mac.hardenedRuntime, true);
    assert.ok(mac.timestamp && mac.timestamp !== "none", mac.timestamp);
    assert.strictEqual(mac.entitlements, ENTITLEMENTS);
    assert.strictEqual(mac.entitlementsInherit, ENTITLEMENTS);
});

test("a distribution build leaves Chromium's resource packs to the framework signature", () => {
    // electron-builder turns each entry into a RegExp and tests it against the full path.
    const ignore = distributionOverrides().mac.signIgnore.map(it => new RegExp(it));
    const skipped = file => ignore.some(re => re.test(file));
    const framework = "/x/EDEX.app/Contents/Frameworks/Electron Framework.framework/Versions/A";
    assert.ok(skipped(`${framework}/Resources/ca.lproj/locale.pak`));
    assert.ok(skipped(`${framework}/Resources/resources.pak`));
    // Code is never skipped: notarisation rejects an app with an unsigned Mach-O inside.
    assert.ok(!skipped(`${framework}/Electron Framework`));
    assert.ok(!skipped("/x/EDEX.app/Contents/Resources/app.asar.unpacked/node_modules/node-pty/build/Release/pty.node"));
    assert.ok(!skipped("/x/EDEX.app/Contents/Resources/app.asar.unpacked/node_modules/node-pty/build/Release/spawn-helper"));
});

test("the entitlements let V8 run under the hardened runtime", () => {
    // Without allow-jit the app dies at launch, which neither the build nor notarytool notices.
    const plist = read(ENTITLEMENTS);
    for (const key of ["com.apple.security.cs.allow-jit", "com.apple.security.automation.apple-events"]) {
        assert.match(plist, new RegExp(`<key>${key.replace(/\./g, "\\.")}</key>\\s*<true/>`), key);
    }
    // macOS shows this text when a program run in EDEX first sends Apple events.
    assert.ok(JSON.parse(read("package.json")).build.mac.extendInfo.NSAppleEventsUsageDescription);
});

test("the codesign retry wrapper hands over to the real codesign", () => {
    // It is found through PATH under the name "codesign": calling codesign by name from inside
    // would find itself and never stop.
    const file = path.join(root, "build", "bin", "codesign");
    assert.ok(fs.statSync(file).mode & 0o111, "executable");
    const script = fs.readFileSync(file, "utf-8");
    assert.ok(script.includes("/usr/bin/codesign \"$@\""), "calls the real one by its full path");
    assert.ok(!/^\s*codesign\b/m.test(script), "never codesign by name");
});

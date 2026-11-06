"use strict";

const test = require("node:test");
const assert = require("node:assert");
const {
    extractDirFromArgv,
    isAllowedOrigin,
    parseProcessName,
    parseCwdOutput,
    pickNextDisplay,
    pickStartDisplay,
    resolveSpawnCwd,
    firstFreeSlot,
    finderServiceHelper,
    finderServiceLink,
    serviceLinkAction
} = require("../src/utils/system.js");

// A stand-in filesystem: only the listed paths exist, and only as directories.
function fakeFs(directories) {
    return {
        statSync(target) {
            if (!directories.includes(target)) {
                const err = new Error(`ENOENT: ${target}`);
                err.code = "ENOENT";
                throw err;
            }
            return {isDirectory: () => true};
        }
    };
}

test("extractDirFromArgv finds the folder the Finder service appends", () => {
    const argv = ["/Applications/EDEX.app/Contents/MacOS/EDEX", "/Users/me/Projects"];
    assert.strictEqual(extractDirFromArgv(argv, fakeFs(["/Users/me/Projects"])), "/Users/me/Projects");
});

test("extractDirFromArgv prefers the last directory on the line", () => {
    const argv = ["EDEX", "/Users/me/A", "/Users/me/B"];
    assert.strictEqual(extractDirFromArgv(argv, fakeFs(["/Users/me/A", "/Users/me/B"])), "/Users/me/B");
});

test("extractDirFromArgv ignores flags and relative paths", () => {
    const argv = ["EDEX", "--nointro", "relative/path"];
    assert.strictEqual(extractDirFromArgv(argv, fakeFs(["relative/path"])), null);
});

test("extractDirFromArgv skips paths that do not exist", () => {
    const argv = ["EDEX", "/Users/me/gone"];
    assert.strictEqual(extractDirFromArgv(argv, fakeFs([])), null);
});

test("extractDirFromArgv never returns argv[0]", () => {
    // The executable's own path is a real path, but it is not a folder the user picked.
    const argv = ["/Applications/EDEX.app"];
    assert.strictEqual(extractDirFromArgv(argv, fakeFs(["/Applications/EDEX.app"])), null);
});

test("extractDirFromArgv tolerates junk input", () => {
    assert.strictEqual(extractDirFromArgv(undefined, fakeFs([])), null);
    assert.strictEqual(extractDirFromArgv([], fakeFs([])), null);
});

test("isAllowedOrigin accepts the local renderer", () => {
    assert.ok(isAllowedOrigin("file://"));
    assert.ok(isAllowedOrigin("null"));
    assert.ok(isAllowedOrigin(undefined), "a missing Origin header is the local client");
});

test("isAllowedOrigin refuses web pages", () => {
    // This is the check that stops a site in the user's browser from driving the terminal.
    assert.ok(!isAllowedOrigin("http://evil.example"));
    assert.ok(!isAllowedOrigin("https://evil.example"));
    assert.ok(!isAllowedOrigin("http://localhost:3000"));
    assert.ok(!isAllowedOrigin("file://evil.example"));
});

test("parseProcessName reads the macOS ps output", () => {
    assert.strictEqual(parseProcessName("74600 /bin/zsh"), "zsh");
});

test("parseProcessName handles a bare name", () => {
    assert.strictEqual(parseProcessName("1234 node"), "node");
});

test("parseProcessName copes with a failed command", () => {
    assert.strictEqual(parseProcessName(""), "");
    assert.strictEqual(parseProcessName(undefined), "");
});

test("parseCwdOutput keeps paths with spaces intact", () => {
    // awk joins fields with spaces and leaves a trailing one; the path itself must survive.
    assert.strictEqual(parseCwdOutput("/Users/me/My Design Files \n"), "/Users/me/My Design Files");
});

test("parseCwdOutput handles non-ASCII paths", () => {
    assert.strictEqual(parseCwdOutput("/Users/me/Desktop/Дизайн "), "/Users/me/Desktop/Дизайн");
});

// Only the id matters to the picker; the real objects carry bounds and scale factors too.
const displays = [{id: 1}, {id: 2}, {id: 3}];

test("pickNextDisplay moves to the next display", () => {
    assert.deepStrictEqual(pickNextDisplay(displays, 1), {id: 2});
    assert.deepStrictEqual(pickNextDisplay(displays, 2), {id: 3});
});

test("pickNextDisplay wraps around at the end of the list", () => {
    assert.deepStrictEqual(pickNextDisplay(displays, 3), {id: 1});
    assert.deepStrictEqual(pickNextDisplay([{id: 7}, {id: 9}], 9), {id: 7});
});

test("pickNextDisplay has nowhere to go with a single display", () => {
    assert.strictEqual(pickNextDisplay([{id: 1}], 1), null);
    assert.strictEqual(pickNextDisplay([], 1), null);
});

test("pickNextDisplay gives up when the current display is gone", () => {
    // A monitor unplugged between the lookup and the call leaves an id that no longer matches.
    assert.strictEqual(pickNextDisplay(displays, 42), null);
    assert.strictEqual(pickNextDisplay(undefined, 1), null);
});

const primary = {id: 1};
const attached = [{id: 2}, primary, {id: 3}];

test("pickStartDisplay opens on the monitor the settings name", () => {
    assert.strictEqual(pickStartDisplay(attached, primary, 2), attached[2]);
    // People edit settings.json by hand, and a quoted index has always worked.
    assert.strictEqual(pickStartDisplay(attached, primary, "2"), attached[2]);
});

test("pickStartDisplay treats 0 as the first display, not as the primary one", () => {
    assert.strictEqual(pickStartDisplay(attached, primary, 0), attached[0]);
});

test("pickStartDisplay falls back to the primary display", () => {
    // Unset, junk, or a monitor that has been unplugged since.
    for (const monitor of [undefined, null, NaN, "abc", -1, 5]) {
        assert.strictEqual(pickStartDisplay(attached, primary, monitor), primary, String(monitor));
    }
});

// Only the listed paths exist.
function existing(paths) {
    return {existsSync: target => paths.includes(target)};
}

test("resolveSpawnCwd opens a tab where it was asked to", () => {
    assert.strictEqual(resolveSpawnCwd("/Users/me/Projects", "/Users/me", "/start", existing(["/Users/me/Projects"])), "/Users/me/Projects");
});

test("resolveSpawnCwd follows the main shell when no directory is asked for", () => {
    // The renderer sends the string "true" for a plain new tab.
    for (const requested of ["true", undefined, true, ""]) {
        assert.strictEqual(resolveSpawnCwd(requested, "/Users/me", "/start", existing(["true"])), "/Users/me", String(requested));
    }
});

test("resolveSpawnCwd falls back when the directory has gone", () => {
    assert.strictEqual(resolveSpawnCwd("/Users/me/gone", "/Users/me", "/start", existing([])), "/Users/me");
});

test("resolveSpawnCwd uses the start directory before the main shell has reported one", () => {
    assert.strictEqual(resolveSpawnCwd("true", undefined, "/start", existing([])), "/start");
});

test("firstFreeSlot takes the lowest free port", () => {
    assert.strictEqual(firstFreeSlot({3002: null, 3003: null}), "3002");
    assert.strictEqual(firstFreeSlot({3002: {}, 3003: null, 3004: null}), "3003");
});

test("firstFreeSlot reports when every slot is taken", () => {
    assert.strictEqual(firstFreeSlot({3002: {}, 3003: {}}), null);
    assert.strictEqual(firstFreeSlot({}), null);
    assert.strictEqual(firstFreeSlot(null), null);
});

test("finderServiceHelper finds the helper inside an installed app", () => {
    const helper = "Contents/Library/Services/EDEX Service.app/Contents/MacOS/EDEX Service";
    assert.strictEqual(
        finderServiceHelper("/Applications/EDEX.app/Contents/MacOS/EDEX", "/Users/me"),
        `/Applications/EDEX.app/${helper}`
    );
    assert.strictEqual(
        finderServiceHelper("/Users/me/Applications/EDEX.app/Contents/MacOS/EDEX", "/Users/me"),
        `/Users/me/Applications/EDEX.app/${helper}`
    );
});

test("finderServiceHelper leaves copies outside an Applications folder alone", () => {
    // Registering any of these would give macOS a second provider with the same bundle id: a
    // duplicate menu entry, or one pointing into a disk image about to be ejected.
    for (const exe of [
        "/Users/me/Library/Caches/edex-build/mac-arm64/EDEX.app/Contents/MacOS/EDEX",
        "/Users/me/Library/Caches/edex-build/dev/EDEX.app/Contents/MacOS/EDEX",
        "/Volumes/EDEX 2.4.2/EDEX.app/Contents/MacOS/EDEX",
        "/Users/me/Desktop/VibeCode/EDEX/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron",
        "/Applications/Tools/EDEX.app/Contents/MacOS/EDEX"
    ]) {
        assert.strictEqual(finderServiceHelper(exe, "/Users/me"), null, exe);
    }
});

test("finderServiceHelper needs an executable inside an app bundle", () => {
    for (const exe of ["/Applications/edex", "/Applications/EDEX.app", "", undefined, null]) {
        assert.strictEqual(finderServiceHelper(exe, "/Users/me"), null, String(exe));
    }
});

test("finderServiceLink links the helper bundle into ~/Library/Services", () => {
    assert.deepStrictEqual(finderServiceLink("/Applications/EDEX.app/Contents/MacOS/EDEX", "/Users/me"), {
        target: "/Applications/EDEX.app/Contents/Library/Services/EDEX Service.app",
        link: "/Users/me/Library/Services/EDEX Service.app"
    });
    assert.deepStrictEqual(finderServiceLink("/Users/me/Applications/EDEX.app/Contents/MacOS/EDEX", "/Users/me"), {
        target: "/Users/me/Applications/EDEX.app/Contents/Library/Services/EDEX Service.app",
        link: "/Users/me/Library/Services/EDEX Service.app"
    });
});

test("finderServiceLink follows finderServiceHelper on which copies count", () => {
    // A link into the build cache or a disk image would outlive the copy it points at.
    for (const exe of [
        "/Users/me/Library/Caches/edex-build/mac-arm64/EDEX.app/Contents/MacOS/EDEX",
        "/Volumes/EDEX 2.4.2/EDEX.app/Contents/MacOS/EDEX",
        "/Applications/EDEX.app",
        "relative/EDEX.app/Contents/MacOS/EDEX"
    ]) {
        assert.strictEqual(finderServiceLink(exe, "/Users/me"), null, exe);
    }
});

test("finderServiceLink needs a home folder to link into", () => {
    for (const home of ["", undefined, null]) {
        assert.strictEqual(finderServiceLink("/Applications/EDEX.app/Contents/MacOS/EDEX", home), null, String(home));
    }
});

test("serviceLinkAction creates, keeps or replaces the link", () => {
    const target = "/Applications/EDEX.app/Contents/Library/Services/EDEX Service.app";
    assert.strictEqual(serviceLinkAction(null, target), "create");
    assert.strictEqual(serviceLinkAction(target, target), "keep");
    assert.strictEqual(
        serviceLinkAction("/Users/me/Applications/EDEX.app/Contents/Library/Services/EDEX Service.app", target),
        "replace"
    );
});

test("serviceLinkAction leaves anything that is not a symlink alone", () => {
    // A real bundle or file at that path is someone's own; EDEX only manages its own link.
    assert.strictEqual(serviceLinkAction(false, "/Applications/EDEX.app/Contents/Library/Services/EDEX Service.app"), "keep");
});

// Helpers for the main process: command-line parsing, websocket origin checks, the parsers for the
// platform tools the terminal shells out to, the choices made when a window or a tab opens, and where
// the Finder service helper lives.
//
// These are the pieces where a silent mistake is expensive — a broken origin check exposes the
// terminal socket, a broken parser makes the process readout go blank — so they live here,
// free of side effects and covered by tests.

"use strict";

const fs = require("fs");
const path = require("path");

/**
 * Picks a usable directory out of a command line, scanning from the end so the most recent
 * argument wins. Used by the Finder "Open in EDEX" service, which appends a folder path.
 *
 * Returns null when no argument names an existing directory.
 */
function extractDirFromArgv(argv, fsImpl = fs) {
    if (!Array.isArray(argv)) return null;
    for (let i = argv.length - 1; i > 0; i--) {
        const arg = argv[i];
        if (typeof arg !== "string" || arg.startsWith("-") || !path.isAbsolute(arg)) continue;
        try {
            if (fsImpl.statSync(arg).isDirectory()) return arg;
        } catch {
            // Not a directory, or gone — keep looking.
        }
    }
    return null;
}

/**
 * Decides whether a websocket client may attach to the terminal.
 *
 * Only the local renderer may, and it loads from file://, which browsers report as either
 * "file://" or the opaque "null". A page open in a browser sends its own http(s) origin and is
 * refused — without this check any site could reach the loopback port and drive the shell.
 */
function isAllowedOrigin(origin) {
    if (!origin) return true;
    return origin === "file://" || origin === "null";
}

/**
 * Reads a foreground process name out of `ps -o pid=,comm= -g <pgid> | sort -n | tail -1`.
 *
 * macOS reports comm as an absolute path, so the basename is taken. Linux uses a different
 * invocation whose output is already just the name.
 */
function parseProcessName(psOutput) {
    if (typeof psOutput !== "string") return "";
    const line = psOutput.trim();
    if (!line) return "";
    const separator = line.indexOf(" ");
    const name = (separator === -1 ? line : line.slice(separator + 1)).trim();
    return name.split("/").pop();
}

/**
 * Reads a working directory out of the awk-trimmed tail of `lsof -a -d cwd -p <pid>`.
 *
 * The awk step joins fields with spaces, so a trailing space is expected — and paths containing
 * spaces must survive intact.
 */
function parseCwdOutput(lsofOutput) {
    if (typeof lsofOutput !== "string") return "";
    return lsofOutput.trim();
}

/**
 * Picks the display that follows the current one, wrapping around at the end of the list.
 *
 * Returns null when there is nowhere to go — a single display, an empty list, or a current display
 * that is not in it (which happens when a monitor is unplugged between the lookup and the call).
 */
function pickNextDisplay(displays, currentId) {
    if (!Array.isArray(displays) || displays.length < 2) return null;
    const index = displays.findIndex(display => display && display.id === currentId);
    if (index === -1) return null;
    return displays[(index + 1) % displays.length];
}

/**
 * Picks the display the window opens on: the one settings.monitor names, if it is still attached,
 * and the primary one otherwise.
 *
 * A string index works too — people edit settings.json by hand, and "1" has always been accepted.
 * Index 0 is simply the first display in the list, which is not necessarily the primary one.
 */
function pickStartDisplay(displays, primary, monitor) {
    if (!Array.isArray(displays) || isNaN(monitor)) return primary;
    return displays[monitor] || primary;
}

/**
 * Picks the working directory for a new tab.
 *
 * The renderer asks either for a specific directory (a folder opened from Finder) or with "true",
 * meaning "wherever the main shell is now". A directory that has gone away falls back the same way,
 * and before the main shell has reported anything its start directory stands in.
 */
function resolveSpawnCwd(requested, current, fallback, fsImpl = fs) {
    if (typeof requested === "string" && requested !== "true" && fsImpl.existsSync(requested)) return requested;
    return current || fallback;
}

/**
 * Finds the first unclaimed tab slot. Slots are keyed by port number, so the keys come back in
 * ascending order; a slot is free when it holds null.
 */
function firstFreeSlot(slots) {
    if (!slots) return null;
    return Object.keys(slots).find(key => slots[key] === null) ?? null;
}

// Must match HELPER_NAME in build/afterPack.js, which names the bundle it embeds.
const SERVICE_HELPER_NAME = "EDEX Service";

/**
 * Finds the "Open in EDEX" helper inside the running app, given app.getPath("exe").
 *
 * Returns null unless the app sits directly in /Applications or ~/Applications. Any other copy —
 * the build output under ~/Library/Caches, a mounted disk image — shares the helper's bundle id,
 * and registering it would give Finder a second entry, or one that points into a volume about to
 * be ejected.
 */
function finderServiceHelper(exePath, home) {
    if (typeof exePath !== "string" || !path.isAbsolute(exePath)) return null;
    const macosDir = path.dirname(exePath);
    const contentsDir = path.dirname(macosDir);
    const bundle = path.dirname(contentsDir);
    if (path.basename(macosDir) !== "MacOS" || path.basename(contentsDir) !== "Contents" || !bundle.endsWith(".app")) {
        return null;
    }

    const parent = path.dirname(bundle);
    const installed = [path.join(path.sep, "Applications")];
    if (typeof home === "string" && home) installed.push(path.join(home, "Applications"));
    if (!installed.includes(parent)) return null;

    return path.join(bundle, "Contents", "Library", "Services", `${SERVICE_HELPER_NAME}.app`, "Contents", "MacOS", SERVICE_HELPER_NAME);
}

/**
 * Where the helper bundle should be linked into ~/Library/Services, under the same rules as
 * finderServiceHelper: {target, link}, or null when the running copy is not an installed one.
 *
 * pbs scans ~/Library/Services by itself, symlinks included, whatever the LaunchServices database
 * says. A macOS update rebuilds that database and drops the helper nested in the app, so a
 * registration that lives only there was gone until EDEX was next started; the link is not.
 */
function finderServiceLink(exePath, home) {
    const helper = finderServiceHelper(exePath, home);
    if (!helper || typeof home !== "string" || !home) return null;
    // .../EDEX Service.app/Contents/MacOS/EDEX Service → .../EDEX Service.app
    const target = path.dirname(path.dirname(path.dirname(helper)));
    return {target, link: path.join(home, "Library", "Services", path.basename(target))};
}

/**
 * Decides what to do at the link's path, given what is there: null for nothing, the target of a
 * symlink, or false for anything that is not a symlink.
 *
 * A symlink pointing elsewhere is EDEX's own from an earlier install location and is replaced, so
 * the copy started last wins. Anything else was put there by someone else and is left alone.
 */
function serviceLinkAction(existing, target) {
    if (existing === null) return "create";
    if (existing === false || existing === target) return "keep";
    return "replace";
}

module.exports = {
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
};

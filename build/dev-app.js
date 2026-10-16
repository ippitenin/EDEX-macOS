// Builds an EDEX.app around the Electron binary from node_modules, so running from source looks
// like EDEX everywhere macOS shows an application name.
//
// `npm start` runs `electron src`, which launches node_modules/electron/dist/Electron.app and loads
// the project inside it. macOS reads the name, the icon and the process name from that bundle's
// Info.plist, so it says "Electron" no matter what the code does — app.setName() is explicitly
// documented as not affecting the name the OS uses. The only fix is to launch from a bundle whose
// Info.plist is ours.
//
// This is what electron-builder does, minus the packaging: the app directory is a symlink to src/,
// so edits land on the next launch instead of needing a rebuild.

"use strict";

const {execFileSync} = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {stripFinderInfo} = require("./lib/xattr.js");

const projectDir = path.join(__dirname, "..");
const electronApp = path.join(projectDir, "node_modules", "electron", "dist", "Electron.app");

// Outside the project on purpose, next to the release builds: macOS hangs an empty
// com.apple.FinderInfo on bundle directories in watched locations like the Desktop, and codesign
// refuses to sign anything carrying it. See "Building a distributable" in CONTRIBUTING.md.
const devDir = path.join(os.homedir(), "Library", "Caches", "edex-build", "dev");
const bundle = path.join(devDir, "EDEX.app");
const stampFile = path.join(devDir, ".electron-version");

const APP_NAME = "EDEX";
// Deliberately not com.edex.ui: two bundles claiming the same id leave LaunchServices to guess which
// one to open. The cost is that the dev build asks for its own permissions.
const BUNDLE_ID = "com.edex.ui.dev";

function electronVersion() {
    return require(path.join(projectDir, "node_modules", "electron", "package.json")).version;
}

function appVersion() {
    return require(path.join(projectDir, "package.json")).version;
}

// The bundle only depends on the Electron release it wraps — src/ is read through a symlink, so
// code changes never require a rebuild.
function isUpToDate(version) {
    try {
        return fs.readFileSync(stampFile, "utf-8").trim() === version
            && fs.existsSync(path.join(bundle, "Contents", "MacOS", APP_NAME));
    } catch {
        return false;
    }
}

function build(version) {
    fs.rmSync(bundle, {recursive: true, force: true});
    fs.mkdirSync(devDir, {recursive: true});

    // ditto rather than cp: it preserves the code signatures and extended attributes of the ~230
    // nested binaries, which a plain copy quietly drops.
    execFileSync("ditto", [electronApp, bundle]);

    const contents = path.join(bundle, "Contents");
    fs.renameSync(path.join(contents, "MacOS", "Electron"), path.join(contents, "MacOS", APP_NAME));
    fs.copyFileSync(path.join(projectDir, "media", "icon.icns"), path.join(contents, "Resources", "icon.icns"));

    // Editing the keys we care about beats writing a fresh Info.plist: Electron's own carries
    // entries — protocol handlers, the helper layout — that are easy to drop and hard to notice.
    const plist = path.join(contents, "Info.plist");
    const keys = {
        CFBundleName: APP_NAME,
        CFBundleDisplayName: APP_NAME,
        CFBundleExecutable: APP_NAME,
        CFBundleIconFile: "icon.icns",
        CFBundleIdentifier: BUNDLE_ID,
        CFBundleShortVersionString: appVersion(),
        CFBundleVersion: appVersion()
    };
    Object.entries(keys).forEach(([key, value]) => {
        execFileSync("plutil", ["-replace", key, "-string", value, plist]);
    });

    // Electron looks for Resources/app.asar first and Resources/app second, so this shadows the
    // default_app.asar sitting beside it. src/node_modules comes along for free.
    fs.symlinkSync(path.join(projectDir, "src"), path.join(contents, "Resources", "app"));

    // ditto carries over the empty com.apple.FinderInfo from node_modules, which sits inside the
    // project, and the codesign below would refuse the bundle over it.
    stripFinderInfo(bundle);

    // Rewriting Info.plist invalidates the signature ditto just preserved, and an unsigned bundle
    // will not launch on Apple Silicon. Ad-hoc is enough here and --deep is not needed: every nested
    // binary still carries the signature it shipped with.
    execFileSync("codesign", ["--force", "--sign", "-", bundle], {stdio: "ignore"});

    fs.writeFileSync(stampFile, version);
}

const version = electronVersion();
if (isUpToDate(version)) {
    console.log(`dev bundle is current  electron=${version}  ${bundle}`);
} else {
    console.log(`building the dev bundle for electron ${version}, this takes a moment...`);
    build(version);
    console.log(`dev bundle ready  ${bundle}`);
}

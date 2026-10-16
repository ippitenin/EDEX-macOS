// Reports what the app's signature is actually bound to, and fails the build when a signing
// identity was configured but did not take effect.
//
// macOS ties granted TCC permissions (Desktop, Documents, Downloads, Photos, Apple Music...) to the
// code signing requirement of the app that asked for them. Signed with a certificate, that
// requirement names the bundle id and the certificate — neither changes across rebuilds, so the
// permissions stick. Signed ad-hoc there is no certificate to name, so macOS falls back to
// `cdhash H"..."`, the hash of the build itself: every rebuild is a stranger and every permission
// dialog comes back.
//
// Ad-hoc is a legitimate outcome for anyone building without a certificate, so it is only a warning.
// It becomes an error when CSC_NAME asked for a real identity and electron-builder quietly fell back
// to ad-hoc anyway, which it does whenever it cannot find that identity in the keychain.

const {execFileSync} = require("child_process");
const path = require("path");

exports.default = async function(context) {
    if (context.electronPlatformName !== "darwin") return;

    const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);

    let requirement;
    try {
        requirement = execFileSync("codesign", ["-d", "-r-", appPath], {
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"]
        }).trim();
    } catch {
        throw new Error(`could not read the code signature of ${appPath}`);
    }

    if (!requirement.includes("cdhash")) {
        console.log(`  • signature bound to a certificate  ${requirement.replace(/^designated =>\s*/, "")}`);
        return;
    }

    if (process.env.CSC_NAME) {
        throw new Error([
            `CSC_NAME asked for "${process.env.CSC_NAME}" but the app was signed ad-hoc.`,
            "Check that the certificate exists and is trusted for code signing:",
            "    security find-identity -v -p codesigning"
        ].join("\n"));
    }

    console.warn("  • signed ad-hoc: macOS will ask for every permission again after each rebuild, see CONTRIBUTING.md");
};

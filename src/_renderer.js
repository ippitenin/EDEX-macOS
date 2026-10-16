// Disable eval()
window.eval = global.eval = function () {
    throw new Error("eval() is disabled for security reasons.");
};
// Security helpers — implementations and their tests live in utils/sanitize.js
const {escapeHtml, purifyCSS, quoteForShell, escapePathForPaste, encodePathURI} = require("./utils/sanitize.js");
// Window helpers — same story, see utils/system.js
const {pickNextDisplay} = require("./utils/system.js");
// Which physical key each slot of the on-screen keyboard stands for, what its dead keys do and the
// control sequences it sends, see utils/keyboard.js
const {codeForKeySlot, applyDeadKey, CTRLSEQ, KEY_SEQUENCES, parseShortcutTrigger} = require("./utils/keyboard.js");
// Numbers into the text the panels show, and the process list they share, see utils/format.js
// and utils/processes.js
const {pad, splitDuration, formatRuntime, formatMediaTime, formatBytes} = require("./utils/format.js");
const {mergeThreadsByName, compareByLoad} = require("./utils/processes.js");
// Shows settings.env as JSON in the settings editor and reads it back, see utils/config.js
const {formatEnvSetting, parseEnvSetting} = require("./utils/config.js");
// Fits the working directory into the filesystem panel's title bar and keeps theme and layout
// names inside their folders, see utils/paths.js
const {shortenPath, resolveNamedFile} = require("./utils/paths.js");
window._escapeHtml = escapeHtml;
window._purifyCSS = purifyCSS;
window._quoteForShell = quoteForShell;
window._codeForKeySlot = codeForKeySlot;
window._applyDeadKey = applyDeadKey;
window._ctrlseq = CTRLSEQ;
window._keySequences = KEY_SEQUENCES;
window._parseShortcutTrigger = parseShortcutTrigger;
window._pad = pad;
window._splitDuration = splitDuration;
window._formatRuntime = formatRuntime;
window._formatMediaTime = formatMediaTime;
window._formatBytes = formatBytes;
window._mergeThreadsByName = mergeThreadsByName;
window._compareByLoad = compareByLoad;
window._shortenPath = shortenPath;
window._encodePathURI = encodePathURI;
window._delay = ms => {
    return new Promise((resolve, reject) => {
        setTimeout(resolve, ms);
    });
};

// Initiate basic error handling
window.onerror = (msg, path, line, col, error) => {
    // Error text routinely quotes file names, so it is untrusted input like any other.
    document.getElementById("boot_screen").innerHTML += `${escapeHtml(error)} :  ${escapeHtml(msg)}<br/>==> at ${escapeHtml(path)}  ${escapeHtml(line)}:${escapeHtml(col)}`;
};

const path = require("path");
const fs = require("fs");
const electron = require("electron");
const remote = require("@electron/remote");
const ipc = electron.ipcRenderer;

const settingsDir = remote.app.getPath("userData");
const themesDir = path.join(settingsDir, "themes");
const keyboardsDir = path.join(settingsDir, "keyboards");
const fontsDir = path.join(settingsDir, "fonts");
const settingsFile = path.join(settingsDir, "settings.json");
const shortcutsFile = path.join(settingsDir, "shortcuts.json");
const lastWindowStateFile = path.join(settingsDir, "lastWindowState.json");

// Theme and layout names reach require() from settings.json and from the hotswitch message. See
// resolveNamedFile for why they are held to their own folder.
function configFile(dir, name, kind) {
    const file = resolveNamedFile(dir, name, ".json");
    if (file === null) throw new Error(`Not a valid ${kind} name: ${name}`);
    return file;
}

// Load config
window.settings = require(settingsFile);
window.shortcuts = require(shortcutsFile);
window.lastWindowState = require(lastWindowStateFile);

// Load CLI parameters
window.settings.nointroOverride = remote.process.argv.includes("--nointro");
window.settings.nocursorOverride = remote.process.argv.includes("--nocursor");

// Retrieve theme override (hotswitch)
ipc.once("getThemeOverride", (e, theme) => {
    if (theme !== null) {
        window.settings.theme = theme;
        window.settings.nointroOverride = true;
    }
    _loadTheme(require(configFile(themesDir, window.settings.theme, "theme")));
});
ipc.send("getThemeOverride");
// Same for keyboard override/hotswitch
ipc.once("getKbOverride", (e, layout) => {
    if (layout !== null) {
        window.settings.keyboard = layout;
        window.settings.nointroOverride = true;
    }
});
ipc.send("getKbOverride");

// Cyrillic for the UI font: Play (SIL OFL, see assets/fonts/play_OFL.txt), split the way Google
// Fonts ships it. The first file covers Russian, Ukrainian, Belarusian, Bulgarian and Serbian;
// the second the rest of the script.
const cyrillicCompanion = {
    "play_cyrillic.woff2": "U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116",
    "play_cyrillic_ext.woff2": "U+0460-052F, U+1C80-1C8A, U+20B4, U+2DE0-2DFF, U+A640-A69F, U+FE2E-FE2F"
};

// Load UI theme
window._loadTheme = theme => {

    if (document.querySelector("style.theming")) {
        document.querySelector("style.theming").remove();
    }

    // Load fonts
    let mainFont = new FontFace(theme.cssvars.font_main, `url("${path.join(fontsDir, theme.cssvars.font_main.toLowerCase().replace(/ /g, '_')+'.woff2').replace(/\\/g, '/')}")`);
    let lightFont = new FontFace(theme.cssvars.font_main_light, `url("${path.join(fontsDir, theme.cssvars.font_main_light.toLowerCase().replace(/ /g, '_')+'.woff2').replace(/\\/g, '/')}")`);
    let termFont = new FontFace(theme.terminal.fontFamily, `url("${path.join(fontsDir, theme.terminal.fontFamily.toLowerCase().replace(/ /g, '_')+'.woff2').replace(/\\/g, '/')}")`);

    // United Sans, which every bundled theme uses, has no Cyrillic. Russian file names fell
    // through to the system sans-serif — Helvetica, wider and heavier, visibly another font.
    // Play's Cyrillic is registered under the theme's own family names instead, so everything
    // already styled with --font_main or --font_main_light picks it up without a CSS change;
    // the unicode-range keeps it away from Latin text.
    //
    // These go in before the theme's faces on purpose. When faces of one family overlap,
    // Chromium asks the one added last first — so a theme whose font has Cyrillic of its own
    // keeps it, and Play only fills what is missing.
    [theme.cssvars.font_main, theme.cssvars.font_main_light].forEach(family => {
        Object.keys(cyrillicCompanion).forEach(file => {
            let face = new FontFace(family, `url("${path.join(fontsDir, file).replace(/\\/g, '/')}")`, {unicodeRange: cyrillicCompanion[file]});
            document.fonts.add(face);
            // Loaded up front rather than on first use, or the first Russian name to appear
            // would flash in the system font. A missing file only means that fallback stays.
            face.load().catch(() => {});
        });
    });

    document.fonts.add(mainFont);
    document.fonts.load("12px "+theme.cssvars.font_main);
    document.fonts.add(lightFont);
    document.fonts.load("12px "+theme.cssvars.font_main_light);
    document.fonts.add(termFont);
    document.fonts.load("12px "+theme.terminal.fontFamily);

    document.querySelector("head").innerHTML += `<style class="theming">
    :root {
        --font_main: "${window._purifyCSS(theme.cssvars.font_main)}";
        --font_main_light: "${window._purifyCSS(theme.cssvars.font_main_light)}";
        --font_mono: "${window._purifyCSS(theme.terminal.fontFamily)}";
        --color_r: ${window._purifyCSS(theme.colors.r)};
        --color_g: ${window._purifyCSS(theme.colors.g)};
        --color_b: ${window._purifyCSS(theme.colors.b)};
        --color_black: ${window._purifyCSS(theme.colors.black)};
        --color_light_black: ${window._purifyCSS(theme.colors.light_black)};
        --color_grey: ${window._purifyCSS(theme.colors.grey)};
        --color_terminal_bg: ${window._purifyCSS(theme.terminal.background) || "var(--color_light_black)"};

        /* Used for error and warning modals */
        --color_red: ${window._purifyCSS(theme.colors.red) || "red"};
        --color_yellow: ${window._purifyCSS(theme.colors.yellow) || "yellow"};
    }

    body {
        font-family: var(--font_main), sans-serif;
        cursor: ${(window.settings.nocursorOverride || window.settings.nocursor) ? "none" : "default"} !important;
    }

    * {
   	   ${(window.settings.nocursorOverride || window.settings.nocursor) ? "cursor: none !important;" : ""}
	}

    ${window._purifyCSS(theme.injectCSS || "")}
    </style>`;

    window.theme = theme;
    window.theme.r = theme.colors.r;
    window.theme.g = theme.colors.g;
    window.theme.b = theme.colors.b;
};

function initGraphicalErrorHandling() {
    window.onerror = (msg, path, line, col, error) => {
        // Error text quotes file names, so escape before it reaches the modal's markup.
        new Modal({
            type: "error",
            title: escapeHtml(error),
            message: `${escapeHtml(msg)}<br/>        at ${escapeHtml(path)}  ${escapeHtml(line)}:${escapeHtml(col)}`
        });

        ipc.send("log", "error", `${error}: ${msg}`);
        ipc.send("log", "debug", `at ${path} ${line}:${col}`);
    };
}

function waitForFonts() {
    return new Promise(resolve => {
        if (document.readyState !== "complete" || document.fonts.status !== "loaded") {
            document.addEventListener("readystatechange", () => {
                if (document.readyState === "complete") {
                    if (document.fonts.status === "loaded") {
                        resolve();
                    } else {
                        document.fonts.onloadingdone = () => {
                            if (document.fonts.status === "loaded") resolve();
                        };
                    }
                }
            });
        } else {
            resolve();
        }
    });
}

// A proxy function used to add multithreading to systeminformation calls - see backend process manager @ _multithread.js
function initSystemInformationProxy() {
    const { nanoid } = require("nanoid/non-secure");

    // A call never rejects. _multithread.js sends no reply when systeminformation fails, so a failed
    // call just never settles — a .catch() on one of these does nothing.
    window.si = new Proxy({}, {
        set: () => {throw new Error("Cannot set a property on the sysinfo proxy")},
        get: (target, prop) => {
            return (...args) => new Promise(resolve => {
                let id = nanoid();
                ipc.once("systeminformation-reply-"+id, (e, res) => resolve(res));
                ipc.send("systeminformation-call", prop, id, ...args);
            });
        }
    });
}

// Init audio
window.audioManager = new AudioManager();

// See #223
remote.app.focus();

let i = 0;
if (window.settings.nointro || window.settings.nointroOverride) {
    initGraphicalErrorHandling();
    initSystemInformationProxy();
    document.getElementById("boot_screen").remove();
    document.body.setAttribute("class", "");
    waitForFonts().then(initUI);
} else {
    displayLine();
}

// Startup boot log
function displayLine() {
    let bootScreen = document.getElementById("boot_screen");
    let log = fs.readFileSync(path.join(__dirname, "assets", "misc", "boot_log.txt")).toString().split('\n');

    function isArchUser() {
        return require("os").platform() === "linux"
                && fs.existsSync("/etc/os-release")
                && fs.readFileSync("/etc/os-release").toString().includes("arch");
    }

    if (typeof log[i] === "undefined") {
        setTimeout(bootScreenDone, 300);
        return;
    }

    if (log[i] === "Boot Complete") {
        window.audioManager.granted.play();
    } else {
        window.audioManager.stdout.play();
    }
    bootScreen.innerHTML += log[i]+"<br/>";
    i++;

    switch(true) {
        case i === 2:
            bootScreen.innerHTML += `EDEX Kernel version ${remote.app.getVersion()} boot at ${Date().toString()}; root:xnu-1699.22.73~1/RELEASE_X86_64`;
            // falls through: the kernel line gets the same pause as line 4
        case i === 4:
            setTimeout(displayLine, 500);
            break;
        case i > 4 && i < 25:
            setTimeout(displayLine, 30);
            break;
        case i === 25:
            setTimeout(displayLine, 400);
            break;
        case i === 42:
            setTimeout(displayLine, 300);
            break;
        case i > 42 && i < 82:
            setTimeout(displayLine, 25);
            break;
        case i === 83:
            if (isArchUser())
                bootScreen.innerHTML += "btw i use arch<br/>";
            setTimeout(displayLine, 25);
            break;
        case i >= log.length-2 && i < log.length:
            setTimeout(displayLine, 300);
            break;
        default:
            setTimeout(displayLine, Math.pow(1 - (i/1000), 3)*25);
    }
}

// Clean transition from the boot log straight to the UI, skipping the glitch title screen
async function bootScreenDone() {
    window.audioManager.theme.play();
    await _delay(400);
    document.getElementById("boot_screen").remove();
    document.body.setAttribute("class", "");
    initGraphicalErrorHandling();
    initSystemInformationProxy();
    waitForFonts().then(initUI);
}

// Returns the user's desired display name
async function getDisplayName() {
    let user = settings.username || null;
    if (user)
        return user;

    try {
        user = await require("username")();
    } catch {}

    return user;
}

// Create the UI's html structure and initialize the terminal client and the keyboard
async function initUI() {
    // The terminal frame unfolds from a line into a box, and it has to do so in the spot where
    // it will stay. It used to unfold alone on the page, propped up by a bottom margin standing
    // in for the row below; when the filesystem panel and the keyboard were then added, the
    // layout settled differently and the frame jumped — 24px up and a few sideways, behind a
    // blink that was meant to hide it.
    //
    // Now the bottom row is in the page from the first frame, invisible, so nothing is added
    // later and nothing reflows. While folded, the frame carries vertical margins of half its
    // final height (60.3%, see main_shell.css) that shrink as it grows: the space it occupies
    // stays constant, and it opens evenly from its middle. The margins at the sides are there
    // for the line break: flex wrapping is greedy, and a frame that is still narrow would share
    // its line with the filesystem panel and sit off-centre until it grew too wide for that.
    // None of it survives into the final state, so the resting position does not depend on
    // these numbers being exact.
    const shellFolded = "height:0%;margin:30.15vh 30%;";

    document.body.innerHTML += `<section class="mod_column" id="mod_column_left">
        <h3 class="title"><p>PANEL</p><p>SYSTEM</p></h3>
    </section>
    <section id="main_shell" style="${shellFolded}width:0%;opacity:0;" augmented-ui="bl-clip tr-clip exe">
        <h3 class="title" style="opacity:0;"><p>TERMINAL</p><p>MAIN SHELL</p></h3>
        <h1 id="main_shell_greeting"></h1>
    </section>
    <section class="mod_column" id="mod_column_right">
        <h3 class="title"><p>PANEL</p><p>NETWORK</p></h3>
    </section>
    <section id="filesystem" class="${window.settings.hideDotfiles ? "hideDotfiles" : ""} ${window.settings.fsListView ? "list-view" : ""}">
    </section>
    <section id="keyboard" style="opacity:0;">
    </section>`;
    // Built now rather than when it is revealed: the bottom row needs its real height from the
    // first frame, or the frame above would move when the keys arrive.
    window.keyboard = new Keyboard({
        layout: configFile(keyboardsDir, settings.keyboard, "keyboard layout"),
        container: "keyboard"
    });

    await _delay(10);

    window.audioManager.expand.play();
    document.getElementById("main_shell").setAttribute("style", shellFolded);

    await _delay(500);

    document.getElementById("main_shell").setAttribute("style", "");
    document.querySelector("#main_shell > h3.title").setAttribute("style", "");

    // The frame is in place; hold it for a moment before the greeting and the keyboard.
    await _delay(980);

    let greeter = document.getElementById("main_shell_greeting");

    getDisplayName().then(user => {
        if (user) {
            greeter.innerHTML += `Welcome back, <em>${escapeHtml(user)}</em>`;
        } else {
            greeter.innerHTML += "Welcome back";
        }
    });

    greeter.setAttribute("style", "opacity: 1;");

    // The filesystem panel comes up with the greeting and the keyboard rather than two seconds
    // later with the side columns. There is no terminal to follow yet, so it is pointed at the
    // directory the shell starts in, and it stays deaf to clicks until there is a terminal for
    // them to type into.
    window.fsDisp = new FilesystemDisplay({
        parentId: "filesystem"
    });
    window.fsDisp.showDir(ipc.sendSync("tty-cwd"));
    document.getElementById("filesystem").setAttribute("style", "opacity: 1; pointer-events: none;");

    document.getElementById("keyboard").setAttribute("style", "");
    document.getElementById("keyboard").setAttribute("class", "animation_state_1");
    window.audioManager.keyboard.play();

    await _delay(100);

    document.getElementById("keyboard").setAttribute("class", "animation_state_1 animation_state_2");

    await _delay(1000);

    greeter.setAttribute("style", "opacity: 0;");

    await _delay(100);

    document.getElementById("keyboard").setAttribute("class", "");

    await _delay(400);

    greeter.remove();

    // Initialize modules
    window.mods = {};

    // Modules add their markup with insertAdjacentHTML. Six of them used innerHTML +=, which rebuilt
    // everything already in the column; only this order and the delays before the globe and the
    // charts draw kept earlier modules' live elements from being thrown away.

    // Left column
    window.mods.clock = new Clock("mod_column_left");
    window.mods.sysinfo = new Sysinfo("mod_column_left");
    window.mods.hardwareInspector = new HardwareInspector("mod_column_left");
    window.mods.cpuinfo = new Cpuinfo("mod_column_left");
    window.mods.ramwatcher = new RAMwatcher("mod_column_left");
    window.mods.toplist = new Toplist("mod_column_left");

    // Right column
    window.mods.netstat = new Netstat("mod_column_right");
    window.mods.globe = new LocationGlobe("mod_column_right");
    window.mods.conninfo = new Conninfo("mod_column_right");

    // Fade-in animations
    document.querySelectorAll(".mod_column").forEach(e => {
        e.setAttribute("class", "mod_column activated");
    });
    let i = 0;
    let left = document.querySelectorAll("#mod_column_left > div");
    let right = document.querySelectorAll("#mod_column_right > div");
    let x = setInterval(() => {
        if (!left[i] && !right[i]) {
            clearInterval(x);
        } else {
            window.audioManager.panels.play();
            if (left[i]) {
                left[i].setAttribute("style", "animation-play-state: running;");
            }
            if (right[i]) {
                right[i].setAttribute("style", "animation-play-state: running;");
            }
            i++;
        }
    }, 500);

    await _delay(100);

    // Initialize the terminal
    let shellContainer = document.getElementById("main_shell");
    shellContainer.innerHTML += `
        <ul id="main_shell_tabs">
            <li id="shell_tab0" onclick="window.focusShellTab(0);" class="active"><p>MAIN SHELL</p></li>
            <li id="shell_tab1" onclick="window.focusShellTab(1);"><p>EMPTY</p></li>
            <li id="shell_tab2" onclick="window.focusShellTab(2);"><p>EMPTY</p></li>
            <li id="shell_tab3" onclick="window.focusShellTab(3);"><p>EMPTY</p></li>
            <li id="shell_tab4" onclick="window.focusShellTab(4);"><p>EMPTY</p></li>
        </ul>
        <div id="main_shell_innercontainer">
            <pre id="terminal0" class="active"></pre>
            <pre id="terminal1"></pre>
            <pre id="terminal2"></pre>
            <pre id="terminal3"></pre>
            <pre id="terminal4"></pre>
        </div>`;
    window.term = {
        0: new Terminal({
            role: "client",
            parentId: "terminal0",
            // Not settings.port: the main process moves off it when another program holds it.
            port: ipc.sendSync("tty-port")
        })
    };
    window.currentTerm = 0;
    window.term[0].onprocesschange = p => {
        // Process names come from the OS and can contain anything, markup included.
        document.getElementById("shell_tab0").innerHTML = `<p>MAIN - ${escapeHtml(p)}</p>`;
    };
    // Prevent losing hardware keyboard focus on the terminal when using touch keyboard
    window.onmouseup = e => {
        if (window.keyboard.linkedToTerm) window.term[window.currentTerm].term.focus();
    };
    // Dropping files anywhere on the window types their paths into the active tab, as
    // Terminal.app does. Without a dragover handler that calls preventDefault the page is not a
    // drop target at all, and macOS animates the file flying back to where it came from.
    window.addEventListener("dragover", e => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
    });
    window.addEventListener("drop", e => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        // A modal owns the keyboard while it is open; typing into the shell behind it would
        // go unnoticed until the modal is closed.
        if (!window.keyboard.linkedToTerm) return;

        // File.path is gone from Electron; webUtils is the supported way to the real path. It
        // comes back empty for files that exist only in memory, such as an image dragged out
        // of a browser.
        let paths = Array.from(e.dataTransfer.files)
            .map(file => electron.webUtils.getPathForFile(file))
            .filter(filePath => filePath.length > 0);
        if (paths.length === 0) return;

        let term = window.term[window.currentTerm];
        // The trailing space lets the next drop, or whatever is typed next, start a new word.
        term.paste(paths.map(escapePathForPaste).join(" ")+" ");
        term.term.focus();
    });
    window.term[0].term.writeln("\033[1m"+`Welcome to EDEX v${remote.app.getVersion()} - Electron v${process.versions.electron}`+"\033[0m");

    await _delay(100);

    // The panel has been on screen since the greeting; now it has a terminal to follow.
    window.fsDisp.followTab();

    await _delay(200);

    document.getElementById("filesystem").setAttribute("style", "opacity: 1;");

    // Resend terminal CWD to fsDisp if we're hot reloading
    if (window.performance.navigation.type === 1) {
        window.term[window.currentTerm].resendCWD();
    }

    await _delay(200);
}

window.themeChanger = theme => {
    ipc.send("setThemeOverride", theme);
    setTimeout(() => {
        window.location.reload(true);
    }, 100);
};

window.remakeKeyboard = layout => {
    document.getElementById("keyboard").innerHTML = "";
    window.keyboard = new Keyboard({
        layout: configFile(keyboardsDir, layout, "keyboard layout"),
        container: "keyboard"
    });
    ipc.send("setKbOverride", layout);
};

window.focusShellTab = (number, spawnDir) => {
    if (number !== window.currentTerm && window.term[number]) {
        window.currentTerm = number;

        document.querySelectorAll(`ul#main_shell_tabs > li:not(:nth-child(${number+1}))`).forEach(e => {
            e.setAttribute("class", "");
        });
        document.getElementById("shell_tab"+number).setAttribute("class", "active");

        document.querySelectorAll(`div#main_shell_innercontainer > pre:not(:nth-child(${number+1}))`).forEach(e => {
            e.setAttribute("class", "");
        });
        document.getElementById("terminal"+number).setAttribute("class", "active");

        window.term[number].fit();
        window.term[number].term.focus();
        window.term[number].resendCWD();

        window.fsDisp.followTab();
    } else if (number > 0 && number <= 4 && window.term[number] !== null && typeof window.term[number] !== "object") {
        window.term[number] = null;

        document.getElementById("shell_tab"+number).innerHTML = "<p>LOADING...</p>";
        // A handler that throws rejects the invoke; that is a failed tab like any other.
        ipc.invoke("ttyspawn", spawnDir || "true").catch(err => "ERROR: "+err.message).then(r => {
            if (r.startsWith("ERROR")) {
                // Release the slot, otherwise the tab stays wedged on ERROR forever: the guard
                // above only opens a tab whose entry is undefined, and this one would stay null.
                document.getElementById("shell_tab"+number).innerHTML = "<p>ERROR</p>";
                setTimeout(() => {
                    delete window.term[number];
                    document.getElementById("shell_tab"+number).innerHTML = "<p>EMPTY</p>";
                }, 2000);
            } else if (r.startsWith("SUCCESS")) {
                let port = Number(r.substr(9));

                window.term[number] = new Terminal({
                    role: "client",
                    parentId: "terminal"+number,
                    port
                });

                window.term[number].onclose = e => {
                    delete window.term[number].onprocesschange;
                    document.getElementById("shell_tab"+number).innerHTML = "<p>EMPTY</p>";
                    document.getElementById("terminal"+number).innerHTML = "";
                    window.term[number].term.dispose();
                    delete window.term[number];
                    window.useAppShortcut("PREVIOUS_TAB");
                };

                window.term[number].onprocesschange = p => {
                    document.getElementById("shell_tab"+number).innerHTML = `<p>#${number+1} - ${escapeHtml(p)}</p>`;
                };

                document.getElementById("shell_tab"+number).innerHTML = `<p>::${port}</p>`;
                setTimeout(() => {
                    window.focusShellTab(number);
                }, 500);
            }
        });
    }
};

// Open a folder from the Finder "Open in EDEX" quick action in a free tab
ipc.on("open-dir-tab", (e, dir) => {
    if (!window.term) return;
    for (let i = 1; i <= 4; i++) {
        if (window.term[i] !== null && typeof window.term[i] !== "object") {
            window.focusShellTab(i, dir);
            return;
        }
    }
    new Modal({
        type: "info",
        title: "No free tabs",
        message: `All terminal tabs are in use.<br/>Close one to open:<br/>${window._escapeHtml(dir)}`
    });
});

// Settings editor
window.openSettings = async () => {
    if (document.getElementById("settingsEditor")) return;

    // Every value below comes from a file or the system — settings.json is edited by hand, theme
    // and layout names are file names — and a quote in one used to end the attribute it sat in.
    // The explicit value attribute keeps what is read back identical to what was written: without
    // it an option's value is its text with the whitespace collapsed.
    const option = value => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`;

    // Build lists of available keyboards, themes, monitors
    let keyboards = "", themes = "", monitors = "", ifaces = "";
    fs.readdirSync(keyboardsDir).forEach(kb => {
        if (!kb.endsWith(".json")) return;
        kb = kb.replace(".json", "");
        if (kb === window.settings.keyboard) return;
        keyboards += option(kb);
    });
    fs.readdirSync(themesDir).forEach(th => {
        if (!th.endsWith(".json")) return;
        th = th.replace(".json", "");
        if (th === window.settings.theme) return;
        themes += option(th);
    });
    for (let i = 0; i < remote.screen.getAllDisplays().length; i++) {
        if (i !== window.settings.monitor) monitors += option(i);
    }
    let nets = await window.si.networkInterfaces();
    nets.forEach(net => {
        if (net.iface !== window.mods.netstat.iface) ifaces += option(net.iface);
    });

    // Unlink the tactile keyboard from the terminal emulator to allow filling in the settings fields
    window.keyboard.detach();

    new Modal({
        type: "custom",
        title: `Settings <i>(v${remote.app.getVersion()})</i>`,
        html: `<table id="settingsEditor">
                    <tr>
                        <th>Key</th>
                        <th>Description</th>
                        <th>Value</th>
                    </tr>
                    <tr>
                        <td>shell</td>
                        <td>The program to run as a terminal emulator</td>
                        <td><input type="text" id="settingsEditor-shell" value="${escapeHtml(window.settings.shell)}"></td>
                    </tr>
                    <tr>
                        <td>shellArgs</td>
                        <td>Arguments to pass to the shell</td>
                        <td><input type="text" id="settingsEditor-shellArgs" value="${escapeHtml(window.settings.shellArgs || '')}"></td>
                    </tr>
                    <tr>
                        <td>cwd</td>
                        <td>Working Directory to start in</td>
                        <td><input type="text" id="settingsEditor-cwd" value="${escapeHtml(window.settings.cwd)}"></td>
                    </tr>
                    <tr>
                        <td>env</td>
                        <td>Custom shell environment override, as a JSON object</td>
                        <td><input type="text" id="settingsEditor-env" value="${escapeHtml(formatEnvSetting(window.settings.env))}"></td>
                    </tr>
                    <tr>
                        <td>username</td>
                        <td>Custom username to display at boot</td>
                        <td><input type="text" id="settingsEditor-username" value="${escapeHtml(window.settings.username)}"></td>
                    </tr>
                    <tr>
                        <td>keyboard</td>
                        <td>On-screen keyboard layout code</td>
                        <td><select id="settingsEditor-keyboard">
                            ${option(window.settings.keyboard)}
                            ${keyboards}
                        </select></td>
                    </tr>
                    <tr>
                        <td>theme</td>
                        <td>Name of the theme to load</td>
                        <td><select id="settingsEditor-theme">
                            ${option(window.settings.theme)}
                            ${themes}
                        </select></td>
                    </tr>
                    <tr>
                        <td>termFontSize</td>
                        <td>Size of the terminal text in pixels</td>
                        <td><input type="number" id="settingsEditor-termFontSize" value="${escapeHtml(window.settings.termFontSize)}"></td>
                    </tr>
                    <tr>
                        <td>audio</td>
                        <td>Activate audio sound effects</td>
                        <td><select id="settingsEditor-audio">
                            <option>${escapeHtml(window.settings.audio)}</option>
                            <option>${!window.settings.audio}</option>
                        </select></td>
                    </tr>
                    <tr>
                        <td>audioVolume</td>
                        <td>Set default volume for sound effects (0.0 - 1.0)</td>
                        <td><input type="number" id="settingsEditor-audioVolume" value="${escapeHtml(window.settings.audioVolume || '1.0')}"></td>
                    </tr>
                    <tr>
                        <td>disableFeedbackAudio</td>
                        <td>Disable recurring feedback sound FX (input/output, mostly)</td>
                        <td><select id="settingsEditor-disableFeedbackAudio">
                            <option>${escapeHtml(window.settings.disableFeedbackAudio)}</option>
                            <option>${!window.settings.disableFeedbackAudio}</option>
                        </select></td>
                    </tr>
                    <tr>
                        <td>port</td>
                        <td>Preferred local port for the UI-shell connection; a free one is used if it is taken</td>
                        <td><input type="number" id="settingsEditor-port" value="${escapeHtml(window.settings.port)}"></td>
                    </tr>
                    <tr>
                        <td>pingAddr</td>
                        <td>IPv4 address to test Internet connectivity</td>
                        <td><input type="text" id="settingsEditor-pingAddr" value="${escapeHtml(window.settings.pingAddr || "1.1.1.1")}"></td>
                    </tr>
                    <tr>
                        <td>clockHours</td>
                        <td>Clock format (12/24 hours)</td>
                        <td><select id="settingsEditor-clockHours">
                            <option>${(window.settings.clockHours === 12) ? "12" : "24"}</option>
                            <option>${(window.settings.clockHours === 12) ? "24" : "12"}</option>
                        </select></td>
                    </tr>
                    <tr>
                        <td>monitor</td>
                        <td>Which monitor to spawn the UI in (defaults to primary display)</td>
                        <td><select id="settingsEditor-monitor">
                            ${(typeof window.settings.monitor !== "undefined") ? option(window.settings.monitor) : ""}
                            ${monitors}
                        </select></td>
                    </tr>
                    <tr>
                        <td>nointro</td>
                        <td>Skip the intro boot log${(window.settings.nointroOverride) ? " (Currently overridden by CLI flag)" : ""}</td>
                        <td><select id="settingsEditor-nointro">
                            <option>${escapeHtml(window.settings.nointro)}</option>
                            <option>${!window.settings.nointro}</option>
                        </select></td>
                    </tr>
                    <tr>
                        <td>nocursor</td>
                        <td>Hide the mouse cursor${(window.settings.nocursorOverride) ? " (Currently overridden by CLI flag)" : ""}</td>
                        <td><select id="settingsEditor-nocursor">
                            <option>${escapeHtml(window.settings.nocursor)}</option>
                            <option>${!window.settings.nocursor}</option>
                        </select></td>
                    </tr>
                    <tr>
                        <td>iface</td>
                        <td>Override the interface used for network monitoring</td>
                        <td><select id="settingsEditor-iface">
                            ${option(window.mods.netstat.iface)}
                            ${ifaces}
                        </select></td>
                    </tr>
                    <tr>
                        <td>forceFullscreen</td>
                        <td>Start in native fullscreen instead of a window filling the work area</td>
                        <td><select id="settingsEditor-forceFullscreen">
                            <option>${escapeHtml(window.settings.forceFullscreen)}</option>
                            <option>${!window.settings.forceFullscreen}</option>
                        </select></td>
                    </tr>
                    <tr>
                        <td>allowWindowed</td>
                        <td>Allow F11 to take the window out of fullscreen</td>
                        <td><select id="settingsEditor-allowWindowed">
                            <option>${escapeHtml(window.settings.allowWindowed)}</option>
                            <option>${!window.settings.allowWindowed}</option>
                        </select></td>
                    </tr>
                    <tr>
                        <td>keepGeometry</td>
                        <td>Try to keep a 16:9 aspect ratio in windowed mode</td>
                        <td><select id="settingsEditor-keepGeometry">
                            <option>${(window.settings.keepGeometry === false) ? 'false' : 'true'}</option>
                            <option>${(window.settings.keepGeometry === false) ? 'true' : 'false'}</option>
                        </select></td>
                    </tr>
                    <tr>
                        <td>excludeThreadsFromToplist</td>
                        <td>Hide threads from the top processes list</td>
                        <td><select id="settingsEditor-excludeThreadsFromToplist">
                            <option>${escapeHtml(window.settings.excludeThreadsFromToplist)}</option>
                            <option>${!window.settings.excludeThreadsFromToplist}</option>
                        </select></td>
                    </tr>
                    <tr>
                        <td>hideDotfiles</td>
                        <td>Hide files and directories starting with a dot in file display</td>
                        <td><select id="settingsEditor-hideDotfiles">
                            <option>${escapeHtml(window.settings.hideDotfiles)}</option>
                            <option>${!window.settings.hideDotfiles}</option>
                        </select></td>
                    </tr>
                    <tr>
                        <td>fsListView</td>
                        <td>Show files in a more detailed list instead of an icon grid</td>
                        <td><select id="settingsEditor-fsListView">
                            <option>${escapeHtml(window.settings.fsListView)}</option>
                            <option>${!window.settings.fsListView}</option>
                        </select></td>
                    </tr>
                    <tr>
                        <td>experimentalGlobeFeatures</td>
                        <td>Toggle experimental features for the network globe</td>
                        <td><select id="settingsEditor-experimentalGlobeFeatures">
                            <option>${escapeHtml(window.settings.experimentalGlobeFeatures)}</option>
                            <option>${!window.settings.experimentalGlobeFeatures}</option>
                        </select></td>
                    </tr>
                    <tr>
                        <td>experimentalFeatures</td>
                        <td>Toggle Chrome's experimental web features (DANGEROUS)</td>
                        <td><select id="settingsEditor-experimentalFeatures">
                            <option>${escapeHtml(window.settings.experimentalFeatures)}</option>
                            <option>${!window.settings.experimentalFeatures}</option>
                        </select></td>
                    </tr>
                </table>
                <h6 id="settingsEditorStatus">Loaded values from memory</h6>
                <br>`,
        buttons: [
            {label: "Open in External Editor", action: "electron.shell.openPath(settingsFile);electronWin.minimize();"},
            {label: "Save to Disk", action: "window.writeSettingsFile()"},
            {label: "Reload UI", action: "window.location.reload(true);"},
            {label: "Restart EDEX", action: "remote.app.relaunch();remote.app.quit();"}
        ]
    }, () => {
        // Link the keyboard back to the terminal
        window.keyboard.attach();

        // Focus back on the term
        window.term[window.currentTerm].term.focus();
    });
};

window.writeSettingsFile = () => {
    // env is an object in the file and JSON in the editor. It used to be shown as "[object Object]"
    // and saved as that string, which then reached the shell as a pile of numbered variables.
    const env = parseEnvSetting(document.getElementById("settingsEditor-env").value);
    if (env.error) {
        document.getElementById("settingsEditorStatus").innerText = `Not saved: ${env.error}`;
        return;
    }

    window.settings = {
        shell: document.getElementById("settingsEditor-shell").value,
        shellArgs: document.getElementById("settingsEditor-shellArgs").value,
        cwd: document.getElementById("settingsEditor-cwd").value,
        env: env.env,
        username: document.getElementById("settingsEditor-username").value,
        keyboard: document.getElementById("settingsEditor-keyboard").value,
        theme: document.getElementById("settingsEditor-theme").value,
        termFontSize: Number(document.getElementById("settingsEditor-termFontSize").value),
        audio: (document.getElementById("settingsEditor-audio").value === "true"),
        audioVolume: Number(document.getElementById("settingsEditor-audioVolume").value),
        disableFeedbackAudio: (document.getElementById("settingsEditor-disableFeedbackAudio").value === "true"),
        pingAddr: document.getElementById("settingsEditor-pingAddr").value,
        clockHours: Number(document.getElementById("settingsEditor-clockHours").value),
        port: Number(document.getElementById("settingsEditor-port").value),
        monitor: Number(document.getElementById("settingsEditor-monitor").value),
        nointro: (document.getElementById("settingsEditor-nointro").value === "true"),
        nocursor: (document.getElementById("settingsEditor-nocursor").value === "true"),
        iface: document.getElementById("settingsEditor-iface").value,
        allowWindowed: (document.getElementById("settingsEditor-allowWindowed").value === "true"),
        forceFullscreen: (document.getElementById("settingsEditor-forceFullscreen").value === "true"),
        keepGeometry: (document.getElementById("settingsEditor-keepGeometry").value === "true"),
        excludeThreadsFromToplist: (document.getElementById("settingsEditor-excludeThreadsFromToplist").value === "true"),
        hideDotfiles: (document.getElementById("settingsEditor-hideDotfiles").value === "true"),
        fsListView: (document.getElementById("settingsEditor-fsListView").value === "true"),
        experimentalGlobeFeatures: (document.getElementById("settingsEditor-experimentalGlobeFeatures").value === "true"),
        experimentalFeatures: (document.getElementById("settingsEditor-experimentalFeatures").value === "true")
    };

    Object.keys(window.settings).forEach(key => {
        if (window.settings[key] === "undefined") {
            delete window.settings[key];
        }
    });

    fs.writeFileSync(settingsFile, JSON.stringify(window.settings, "", 4));
    document.getElementById("settingsEditorStatus").innerText = "New values written to settings.json file at "+new Date().toTimeString();
};

window.toggleFullScreen = () => {
    let useFullscreen = (electronWin.isFullScreen() ? false : true);
    electronWin.setFullScreen(useFullscreen);

    //Update settings
    window.lastWindowState["useFullscreen"] = useFullscreen;

    fs.writeFileSync(lastWindowStateFile, JSON.stringify(window.lastWindowState, "", 4));
};

// Sends the window to the next display, wrapping around. Dragging a window this size by hand is
// awkward, and a window in native fullscreen cannot be dragged between displays at all.
window.moveToNextMonitor = () => {
    const win = remote.getCurrentWindow();
    const current = remote.screen.getDisplayMatching(win.getBounds());
    const next = pickNextDisplay(remote.screen.getAllDisplays(), current.id);
    if (!next) return;

    // A window in native fullscreen owns a Space and cannot be moved, so it has to step out first.
    // The catch is that "leave-full-screen" fires before macOS has actually released the window:
    // setBounds sent at that moment gets clamped back into the display it came from, and the window
    // never leaves. The short wait is what makes the move stick.
    if (win.isFullScreen()) {
        win.once("leave-full-screen", async () => {
            await window._delay(350);
            win.setBounds(next.workArea);
            win.setFullScreen(true);
        });
        win.setFullScreen(false);
    } else {
        win.setBounds(next.workArea);
    }
};

// Display available keyboard shortcuts and custom shortcuts helper
window.openShortcutsHelp = () => {
    if (document.getElementById("settingsEditor")) return;

    const shortcutsDefinition = {
        "COPY": "Copy selected buffer from the terminal.",
        "PASTE": "Paste system clipboard to the terminal.",
        "NEXT_TAB": "Switch to the next opened terminal tab (left to right order).",
        "PREVIOUS_TAB": "Switch to the previous opened terminal tab (right to left order).",
        "TAB_X": "Switch to terminal tab <strong>X</strong>, or create it if it hasn't been opened yet.",
        "SETTINGS": "Open the settings editor.",
        "SHORTCUTS": "List and edit available keyboard shortcuts.",
        "FUZZY_SEARCH": "Search for entries in the current working directory.",
        "FS_LIST_VIEW": "Toggle between list and grid view in the file browser.",
        "FS_DOTFILES": "Toggle hidden files and directories in the file browser.",
        "NEXT_MONITOR": "Send the window to the next display, wrapping around.",
        "KB_PASSMODE": "Toggle the on-screen keyboard's \"Password Mode\", which allows you to safely<br>type sensitive information even if your screen might be recorded (disable visual input feedback).",
        "DEV_DEBUG": "Open Chromium Dev Tools, for debugging purposes.",
        "DEV_RELOAD": "Trigger front-end hot reload."
    };

    let appList = "";
    window.shortcuts.filter(e => e.type === "app").forEach(cut => {
        let action = (cut.action.startsWith("TAB_")) ? "TAB_X" : cut.action;

        appList += `<tr>
                        <td>${(cut.enabled) ? 'YES' : 'NO'}</td>
                        <td><input disabled type="text" maxlength=25 value="${escapeHtml(cut.trigger)}"></td>
                        <td>${shortcutsDefinition[action]}</td>
                    </tr>`;
    });

    let customList = "";
    window.shortcuts.filter(e => e.type === "shell").forEach(cut => {
        customList += `<tr>
                            <td>${(cut.enabled) ? 'YES' : 'NO'}</td>
                            <td><input disabled type="text" maxlength=25 value="${escapeHtml(cut.trigger)}"></td>
                            <td>
                                <input disabled type="text" placeholder="Run terminal command..." value="${escapeHtml(cut.action)}">
                                <input disabled type="checkbox" name="shortcutsHelpNew_Enter" ${(cut.linebreak) ? 'checked' : ''}>
                                <label for="shortcutsHelpNew_Enter">Enter</label>
                            </td>
                        </tr>`;
    });

    window.keyboard.detach();
    new Modal({
        type: "custom",
        title: `Available Keyboard Shortcuts <i>(v${remote.app.getVersion()})</i>`,
        html: `<h5>Using either the on-screen or a physical keyboard, you can use the following shortcuts:</h5>
                <details open id="shortcutsHelpAccordeon1">
                    <summary>Emulator shortcuts</summary>
                    <table class="shortcutsHelp">
                        <tr>
                            <th>Enabled</th>
                            <th>Trigger</th>
                            <th>Action</th>
                        </tr>
                        ${appList}
                    </table>
                </details>
                <br>
                <details id="shortcutsHelpAccordeon2">
                    <summary>Custom command shortcuts</summary>
                    <table class="shortcutsHelp">
                        <tr>
                            <th>Enabled</th>
                            <th>Trigger</th>
                            <th>Command</th>
                        </tr>
                       ${customList}
                    </table>
                </details>
                <br>`,
        buttons: [
            {label: "Open Shortcuts File", action: "electron.shell.openPath(shortcutsFile);electronWin.minimize();"},
            {label: "Reload UI", action: "window.location.reload(true);"},
        ]
    }, () => {
        window.keyboard.attach();
        window.term[window.currentTerm].term.focus();
    });

    let wrap1 = document.getElementById('shortcutsHelpAccordeon1');
    let wrap2 = document.getElementById('shortcutsHelpAccordeon2');

    wrap1.addEventListener('toggle', e => {
        wrap2.open = !wrap1.open;
    });

    wrap2.addEventListener('toggle', e => {
        wrap1.open = !wrap2.open;
    });
};

window.useAppShortcut = action => {
    switch(action) {
        case "COPY":
            window.term[window.currentTerm].clipboard.copy();
            return true;
        case "PASTE":
            window.term[window.currentTerm].clipboard.paste();
            return true;
        case "NEXT_TAB":
                if (window.term[window.currentTerm+1]) {
                    window.focusShellTab(window.currentTerm+1);
                } else if (window.term[window.currentTerm+2]) {
                    window.focusShellTab(window.currentTerm+2);
                } else if (window.term[window.currentTerm+3]) {
                    window.focusShellTab(window.currentTerm+3);
                } else if (window.term[window.currentTerm+4]) {
                    window.focusShellTab(window.currentTerm+4);
                } else {
                    window.focusShellTab(0);
                }
            return true;
        case "PREVIOUS_TAB":
                let i = window.currentTerm || 4;
                if (window.term[i] && i !== window.currentTerm) {
                    window.focusShellTab(i);
                } else if (window.term[i-1]) {
                    window.focusShellTab(i-1);
                } else if (window.term[i-2]) {
                    window.focusShellTab(i-2);
                } else if (window.term[i-3]) {
                    window.focusShellTab(i-3);
                } else if (window.term[i-4]) {
                    window.focusShellTab(i-4);
                }
            return true;
        case "TAB_1":
            window.focusShellTab(0);
            return true;
        case "TAB_2":
            window.focusShellTab(1);
            return true;
        case "TAB_3":
            window.focusShellTab(2);
            return true;
        case "TAB_4":
            window.focusShellTab(3);
            return true;
        case "TAB_5":
            window.focusShellTab(4);
            return true;
        case "SETTINGS":
            window.openSettings();
            return true;
        case "SHORTCUTS":
            window.openShortcutsHelp();
            return true;
        case "FUZZY_SEARCH":
            // One at a time, and not over the settings editor. The check lived in the constructor,
            // whose "return false" JavaScript ignores: a second press replaced the open finder
            // here with an instance that had no window, and Select then threw.
            if (!document.getElementById("fuzzyFinder") && !document.getElementById("settingsEditor")) {
                window.activeFuzzyFinder = new FuzzyFinder();
            }
            return true;
        case "FS_LIST_VIEW":
            window.fsDisp.toggleListview();
            return true;
        case "FS_DOTFILES":
            window.fsDisp.toggleHidedotfiles();
            return true;
        case "KB_PASSMODE":
            window.keyboard.togglePasswordMode();
            return true;
        case "NEXT_MONITOR":
            window.moveToNextMonitor();
            return true;
        case "DEV_DEBUG":
            remote.getCurrentWindow().webContents.toggleDevTools();
            return true;
        case "DEV_RELOAD":
            window.location.reload(true);
            return true;
        default:
            console.warn(`Unknown "${action}" app shortcut action`);
            return false;
    }
};

// Global keyboard shortcuts
const globalShortcut = remote.globalShortcut;
globalShortcut.unregisterAll();

window.registerKeyboardShortcuts = () => {
    window.shortcuts.forEach(cut => {
        if (!cut.enabled) return;

        if (cut.type === "app") {
            if (cut.action === "TAB_X") {
                for (let i = 1; i <= 5; i++) {
                    let trigger = cut.trigger.replace("X", i);
                    let dfn = () => { window.useAppShortcut(`TAB_${i}`) };
                    globalShortcut.register(trigger, dfn);
                }
            } else {
                globalShortcut.register(cut.trigger, () => {
                    window.useAppShortcut(cut.action);
                });
            }
        } else if (cut.type === "shell") {
            globalShortcut.register(cut.trigger, () => {
                let fn = (cut.linebreak) ? "writelr" : "write";
                window.term[window.currentTerm][fn](cut.action);
            });
        } else {
            console.warn(`${cut.trigger} has unknown type`);
        }
    });
};
window.registerKeyboardShortcuts();

// See #361
window.addEventListener("focus", () => {
    window.registerKeyboardShortcuts();
});

window.addEventListener("blur", () => {
    globalShortcut.unregisterAll();
});

// Prevent showing menu, exiting fullscreen or app with keyboard shortcuts
document.addEventListener("keydown", e => {
    if (e.key === "Alt") {
        e.preventDefault();
    }
    if (e.code.startsWith("Alt") && e.ctrlKey && e.shiftKey) {
        e.preventDefault();
    }
    if (e.key === "F11" && !settings.allowWindowed) {
        e.preventDefault();
    }
    if (e.code === "KeyD" && e.ctrlKey) {
        e.preventDefault();
    }
    if (e.code === "KeyA" && e.ctrlKey) {
        e.preventDefault();
    }
});

// Fix #265
window.addEventListener("keyup", e => {
    if (require("os").platform() === "win32" && e.key === "F4" && e.altKey === true) {
        remote.app.quit();
    }
});

// Fix double-tap zoom on touchscreens
electron.webFrame.setVisualZoomLevelLimits(1, 1);

// Resize terminal with window
window.onresize = () => {
    if (typeof window.currentTerm !== "undefined") {
        if (typeof window.term[window.currentTerm] !== "undefined") {
            window.term[window.currentTerm].fit();
        }
    }
};

// See #413
window.resizeTimeout = null;
let electronWin = remote.getCurrentWindow();
electronWin.on("resize", () => {
    if (settings.keepGeometry === false) return;
    clearTimeout(window.resizeTimeout);
    window.resizeTimeout = setTimeout(() => {
        let win = remote.getCurrentWindow();
        if (win.isFullScreen()) return false;

        // Upstream turned every zoom into fullscreen here, because the green button could not enter
        // fullscreen on its own back then. It can now, so zoom is left to mean zoom — otherwise
        // option-clicking the button, the one way to ask for it, would be impossible to honour.
        let size = win.getSize();

        if (size[0] >= size[1]) {
            win.setSize(size[0], parseInt(size[0] * 9 / 16));
        } else {
            win.setSize(size[1], parseInt(size[1] * 9 / 16));
        }
    }, 100);
});

// Upstream forced the window to 960x540 on leaving fullscreen, back when it was frameless and
// screen-sized with nowhere sensible to land. With a real title bar macOS restores the pre-fullscreen
// geometry by itself, and the forced resize only shrank the window to a stamp — including on the way
// through moveToNextMonitor.

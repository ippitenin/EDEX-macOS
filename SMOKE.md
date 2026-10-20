# Smoke checklist

Run this after every build that changes the renderer, the terminal backend or the packaging.
The automated checks (`npm run lint`, `npm test`) cover the pieces that can be tested in
isolation; everything below needs a running app and a pair of eyes.

Build and install first, with EDEX closed:

```sh
npm run build-darwin
ditto ~/Library/Caches/edex-build/mac-arm64/EDEX.app /Applications/EDEX.app
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f /Applications/EDEX.app
codesign -dvv /Applications/EDEX.app 2>&1 | grep Authority   # your certificate, not ad-hoc
```

Replace the old copy rather than installing beside it (`rm -rf /Applications/EDEX.app` first if in
doubt). Then launch from Finder or the Dock — not from a terminal session, or the shell inherits
that session's environment.

## Start-up

- [ ] Boot log scrolls, then the interface appears without the glitch title screen
- [ ] No error dialog on launch
- [ ] The terminal frame grows from a line into a box around its own middle and then stays put —
      no blink, no step sideways or upwards when the greeting and the keyboard appear
- [ ] The keyboard fades in where it stands, row after row; the keys do not travel across the
      screen and nothing snaps into place at the end
- [ ] The filesystem panel fades in together with the greeting and the keyboard, already listing
      the starting directory; the side columns follow afterwards, and the listing is not redrawn
      when the terminal comes up
- [ ] Same on a UI reload (`Ctrl+Shift+F5`) from another directory — the panel opens on that one
- [ ] Window fills the work area with a title bar; close, minimise and zoom buttons are there
- [ ] Keyboard rows, Enter and spacebar line up, nothing overflows
- [ ] Window drags by its title bar and resizes; leaving fullscreen does not shrink it to a stamp
- [ ] `Ctrl+Shift+M` sends the window to the next display and back — in a window and in fullscreen
- [ ] Clock, uptime, CPU graphs, memory grid and network panel all show live values

## Terminal

- [ ] Prompt appears in the main tab, in the shell and the starting directory from your settings
- [ ] Typing works, including Cyrillic — characters appear as letters, not digit sequences
- [ ] Keystrokes are silent; Enter plays its confirmation sound
- [ ] `ls`, `cd ..`, `cd ~` — output renders, no sound on output
- [ ] Tab title shows the running process (run `top`, then quit it)
- [ ] Copy and paste through the app shortcuts
- [ ] Set `shellArgs` to `-l` in the settings editor, save, restart — the terminal still starts
- [ ] Developer ID build: `osascript -e 'tell application "Finder" to get name'` asks once to
      control Finder and then prints `Finder` — not "Not authorized to send Apple events"
- [ ] Developer ID build: `xcrun stapler validate /Applications/EDEX.app` reports the ticket
- [ ] Developer ID build: `xcrun stapler validate dist/EDEX-macOS-arm64.dmg` reports the ticket
      and `codesign -dv` on the image names the Developer ID — the image is signed, not just the app

## On-screen keyboard

Keys used to light up only when the character typed existed in the on-screen layout, so under a
Russian input source the letters stayed dark.

- [ ] Type with an English input source — every key lights up under its own label
- [ ] Switch macOS to Russian and type letters, digits and punctuation — the key in the same
      physical position lights up, with and without Shift
- [ ] Space, Enter, Backspace, arrows and the modifiers still light up in both
- [ ] With a French layout (`fr-BEPO`), a dead key followed by a letter types the accented letter;
      Ctrl+C on the on-screen keyboard interrupts a running `sleep 100`
- [ ] With settings open, the on-screen Backspace and arrows edit the focused field

## Dropping files

- [ ] Drag a file from Finder onto the window at a shell prompt — its path is typed in, escaped
      with backslashes and followed by a space; nothing runs
- [ ] Drop two files at once — two paths, separated by a space
- [ ] Drop a file whose name has a space, an apostrophe and Cyrillic, then press Enter after
      `ls -l ` — the shell finds it
- [ ] Inside `claude`, drop an image — it becomes `[Image #1]`; drop two — `#1` and `#2`
- [ ] Drag the thumbnail of a fresh screenshot in — same result
- [ ] Open settings and drop a file — nothing appears in the terminal behind the modal

## Tabs

- [ ] Click each of the four EMPTY tabs in turn — every one opens a working shell
- [ ] Click them rapidly one after another — no `{"isTrusted":true}`, no error dialog
- [ ] Switch between tabs; each keeps its own directory and history
- [ ] Exit a shell with `exit` — the tab returns to EMPTY and focus moves to the previous tab
- [ ] Open and close a tab ten times, then quit with tabs open — `pgrep -fl zsh` shows no shells
      left over from EDEX
- [ ] Quit (Cmd+Q) while the boot log is still running — no "EDEX crashed" dialog

## Busy ports

A dev server on port 3000 used to crash EDEX on launch with `EADDRINUSE`.

- [ ] Hold the port — `nc -l 127.0.0.1 3000` in another terminal — and launch EDEX: no error
      dialog, the main terminal works
- [ ] With `nc -l 127.0.0.1 3002` held as well, open a tab — it opens on another port (the tab
      title shows `::<port>`); close it with `exit` and open it again — the slot is reusable
- [ ] Reload the UI (`Ctrl+Shift+F5`) while the port is shifted — the terminal reconnects

## Filesystem pane

- [ ] Follows the terminal: `cd` somewhere and the listing changes with it
- [ ] Click a folder to enter it, "Go up" to go back
- [ ] Make folders named `$(say pwned)`, `a&b` and `it's` — clicking each enters it, nothing is
      said, and the command in the terminal shows the name in single quotes
- [ ] Shift-click a file — its quoted path is typed; Ctrl-click — it opens in its default app
- [ ] "Show disks" lists the volumes; clicking one enters it; Ctrl-click opens it in Finder
- [ ] Open a text file containing `</textarea><b>x</b>` — it shows as text; edit, Save to Disk,
      and the file on disk has the edit
- [ ] Save a read-only file — the editor says it could not save instead of "File saved"
- [ ] Try to open an unreadable file (`chmod 000`) — a dialog says so, and no editor opens
- [ ] `cd` into an unreadable folder (`chmod 311`) — the panel says it cannot access it; `cd ..`
      and the listing comes back
- [ ] Run `while :; do touch x; rm -f x; done` in the current folder for a few seconds — the panel
      keeps working
- [ ] `cd` into a folder with a Cyrillic name — the panel follows
- [ ] The listing is complete: count the entries of a busy folder against `ls -A | wc -l` (plus
      the two navigation tiles) — the panel used to drop one or two on most reads
- [ ] Disk usage bar shows a mount name and a percentage
- [ ] `cd` into a deeply nested folder — the path in the title bar stays inside the panel: shown
      whole while it fits between the FILESYSTEM label and the right edge, with `/…/` in place of
      the middle folders once it does not; nothing runs over the keyboard
- [ ] Resize the window with such a path showing — it is refitted
- [ ] Open a folder holding a file named `<img src=x onerror=alert(1)>` — the name is shown as
      text, no dialog, nothing executes
- [ ] Open a folder with Russian and English names side by side — both are drawn with strokes of
      the same weight, and a name mixing the two (`Доступы.md`) reads as one font
- [ ] Click an image, a video and a PDF — each opens in its viewer and plays or renders
- [ ] Page through a long PDF as fast as you can click — it ends on the right page, no dialog
- [ ] Close a media modal; playback stops

## Fuzzy finder

- [ ] `Ctrl+Shift+F`, type part of a name — matches appear; Enter types the quoted path
- [ ] Type something that matches nothing — "No results"; Enter, the arrows and Select close it
      quietly
- [ ] Press `Ctrl+Shift+F` again while it is open — nothing changes, Select still works

## Finder integration

- [ ] After installing and launching EDEX once, `/System/Library/CoreServices/pbs -dump | grep
      com.edex.ui.service` finds the service — no `lsregister` on the helper by hand
- [ ] Right-click a folder in Finder with EDEX closed → **Открыть в EDEX** → app starts in that
      folder
- [ ] Same with EDEX already running → folder opens in a free tab
- [ ] With all five tabs occupied → an explanatory dialog, no crash
- [ ] With EDEX running, send two folders one right after the other → two tabs, each in its own
      folder, no error dialog and no extra tab in the home directory
- [ ] Try it on a folder whose name contains a space and an apostrophe

## Settings and shortcuts

- [ ] Open settings, pick another theme, Save to Disk, Reload UI — the colours change and the
      terminal reconnects
- [ ] Put a `"` into `cwd` or `shellArgs` in `settings.json` by hand — the editor shows the value
      whole, and saving writes it back unchanged
- [ ] Type `{"EDITOR": "vim"}` into `env`, save, restart — `echo $EDITOR` prints `vim`; reopen the
      editor and the field shows the same JSON. Type `EDITOR=vim` — it refuses to save and says why
- [ ] Set `"theme": "../settings"` in `settings.json` — the error names an invalid theme
- [ ] Delete a key such as `"hideDotfiles"` from `settings.json` and restart — it is written back
- [ ] Switch the keyboard layout — the on-screen keyboard redraws
- [ ] Open the shortcuts help
- [ ] Trigger a shell-type shortcut from `shortcuts.json` — the command is typed into the
      terminal (this path was broken until the audit)
- [ ] Add a shortcut with the trigger `Cmd+K` — the on-screen keyboard still comes up
- [ ] "Open in External Editor" and "Open Shortcuts File" open the files

## Network behaviour

- [ ] Globe renders and rotates; connection list populates
- [ ] Turn Wi-Fi off: the network panel switches to offline **without** an error dialog
- [ ] Turn it back on: values resume

## Shutdown

- [ ] Quit with Cmd+Q — no lingering EDEX processes:
      `pgrep -fl EDEX` prints nothing afterwards

## Running from source

- [ ] With the installed EDEX closed, `npm run start-app` opens EDEX from source, named EDEX in
      the menu bar and the Dock

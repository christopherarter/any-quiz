import { spawn } from 'node:child_process'
import process from 'node:process'

// No entry here needs a shell. `start` (the usual Windows choice) is a cmd.exe builtin
// and would force `shell: true`, which puts the URL through cmd's parser; `explorer.exe`
// hands the URL to the default browser directly, so the argument is never re-parsed.
const LAUNCHER: Record<string, string> = {
  darwin: 'open',
  win32: 'explorer.exe',
  linux: 'xdg-open',
}

// Returns whether a launcher was started, not whether a browser actually appeared -- the
// child is detached and unref'd, so its exit status is deliberately not observed. A false
// return is the caller's cue to print the URL and let the user open it by hand; this
// never throws, because failing to open a browser must not take down a working server.
export function openBrowser(url: string, platform: string = process.platform): boolean {
  const cmd = LAUNCHER[platform]
  if (cmd === undefined) {
    return false
  }
  try {
    spawn(cmd, [url], { stdio: 'ignore', detached: true }).unref()
    return true
  } catch {
    return false
  }
}

/**
 * The `dsh desktop` runner: resolve the Electron container app and hand it to
 * the platform's installed Electron binary, forwarding arguments and the exit
 * code. The container app owns the web backend it spawns; this runner only
 * replaces the direct `electron .` invocation from its README with a `dsh`
 * subcommand, so every failure here is a loud diagnostic that names the fix.
 * @module @deepseek-ai/dsh/desktop-launch
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// The same relative hop as profile-boot's INSTALL_ANCHOR: src/ and lib/ sit one
// level under apps/cli, so ../.. lands at apps/ from either artifact.
/** The container app's directory beside this CLI in the repository layout. */
export const DESKTOP_APP_DIR = fileURLToPath(new URL('../../desktop/', import.meta.url))

/** Overrides for {@link runDesktop}; tests substitute the process spawn. */
export interface RunDesktopOptions {
  /** Container app directory; defaults to {@link DESKTOP_APP_DIR}. */
  appDir?: string
  /** Process spawner; defaults to Node's `spawn`. */
  spawnProcess?: SpawnProcess
}

/**
 * The subset of Node's `spawn` this runner uses: one inherited-stdio child
 * whose argv it owns completely.
 */
export type SpawnProcess = (file: string, args: readonly string[], options: { stdio: 'inherit' }) => ChildProcess

/**
 * Verify the container app is present and built.
 * @param appDir - candidate container app directory holding its package.json.
 * @returns the verified directory.
 */
export function resolveDesktopAppDir(appDir: string): string {
  if (!existsSync(join(appDir, 'package.json'))) {
    throw new Error(`dsh desktop needs the desktop container app at ${appDir}: run from a repository checkout (see apps/desktop/README.md)`)
  }
  const mainEntry = join(appDir, 'lib', 'main.js')
  if (!existsSync(mainEntry)) {
    throw new Error(`the desktop container app at ${appDir} has no built main entry (${mainEntry}): run \`pnpm run build\` from the repository root`)
  }
  return appDir
}

/**
 * The module-graph reads Electron resolution performs. The default reads the
 * real graph; tests substitute fakes because ambient resolution differs under
 * test runners.
 */
export interface ElectronModuleReader {
  /** Resolve `electron`'s entry-module path anchored at `appDir`; throws when absent. */
  resolveEntry(appDir: string): string
  /** Read the entry module's export: the documented absolute binary-path string. */
  readEntryExport(entryModule: string): unknown
}

/** Reader backed by this process's Node resolver, anchored at the container app. */
const NODE_ELECTRON_READER: ElectronModuleReader = {
  resolveEntry: (appDir) => { return createRequire(join(appDir, 'package.json')).resolve('electron') },
  readEntryExport: (entryModule): unknown => { return createRequire(entryModule)(entryModule) },
}

/**
 * Resolve the Electron binary through the container app's own dependency
 * graph: the `electron` package exports its binary path from its entry module.
 * @param appDir - container app directory anchoring module resolution.
 * @param reader - module-graph reader; defaults to real Node resolution.
 * @returns absolute path of the Electron binary on disk.
 */
export function resolveElectronBinary(appDir: string, reader: ElectronModuleReader = NODE_ELECTRON_READER): string {
  let entryModule: string
  try {
    entryModule = reader.resolveEntry(appDir)
  } catch {
    throw new Error(`electron is not installed under ${appDir}: run \`pnpm install\` from the repository root`)
  }
  const binary = reader.readEntryExport(entryModule)
  if (typeof binary !== 'string' || binary === '' || !existsSync(binary)) {
    throw new Error(`the electron package under ${appDir} does not name a binary on disk (got ${JSON.stringify(binary)}): reinstall dependencies with \`pnpm install\``)
  }
  return binary
}

/**
 * Launch the verified container app and wait for it to exit. Termination
 * signals reach the child too, so a supervisor stopping only this process
 * cannot orphan the window.
 * @param electronBinary - absolute path of the Electron binary to launch.
 * @param appDir - the container app directory handed to Electron as its app.
 * @param args - raw arguments forwarded after the app path.
 * @param spawnProcess - process spawner; defaults to Node's `spawn`.
 * @returns the child's exit code (`1` when a signal terminated it).
 */
export async function launchDesktop(
  electronBinary: string,
  appDir: string,
  args: readonly string[],
  spawnProcess: SpawnProcess = spawn,
): Promise<number> {
  const child: ChildProcess = spawnProcess(electronBinary, [appDir, ...args], { stdio: 'inherit' })
  const forwardSignal = (signal: NodeJS.Signals): void => { child.kill(signal) }
  process.on('SIGINT', forwardSignal)
  process.on('SIGTERM', forwardSignal)
  try {
    return await new Promise<number>((resolveExit, rejectSpawn) => {
      child.once('error', rejectSpawn)
      // A null close code means a signal terminated the child; report failure
      // rather than an exit status that was never observed.
      child.once('close', (code) => { resolveExit(code ?? 1) })
    })
  } finally {
    process.off('SIGINT', forwardSignal)
    process.off('SIGTERM', forwardSignal)
  }
}

/**
 * Resolve and launch the desktop container for one `dsh desktop` invocation.
 * @param args - raw arguments forwarded to the Electron binary verbatim.
 * @param options - overrides for tests.
 * @returns the container's exit code.
 */
export async function runDesktop(args: readonly string[], options: RunDesktopOptions = {}): Promise<number> {
  const appDir = resolveDesktopAppDir(options.appDir ?? DESKTOP_APP_DIR)
  const electronBinary = resolveElectronBinary(appDir)
  return launchDesktop(electronBinary, appDir, args, options.spawnProcess)
}

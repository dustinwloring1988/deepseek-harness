/**
 * Behavior tests for the `dsh desktop` runner: resolution fails loud with the
 * fix named, and the launch hands the container app to the resolved Electron
 * binary with forwarded arguments and exit code — against a fake spawn, since
 * a real launch would open an OS window.
 * @module
 */

import { EventEmitter } from 'node:events'
import type { ChildProcess } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DESKTOP_APP_DIR, launchDesktop, resolveDesktopAppDir, resolveElectronBinary } from '../src/desktop-launch.ts'

/** A minimal container-app checkout with or without built artifacts. */
function makeAppDir(built: boolean): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-desktop-'))
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'fixture-desktop', main: 'lib/main.js' }))
  if (built) {
    mkdirSync(join(dir, 'lib'), { recursive: true })
    writeFileSync(join(dir, 'lib', 'main.js'), '')
  }
  return dir
}

afterEach(() => { vi.restoreAllMocks() })

describe('resolveDesktopAppDir', () => {
  it('accepts a built container app', () => {
    const dir = makeAppDir(true)
    try {
      expect(resolveDesktopAppDir(dir)).toBe(dir)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('rejects a missing checkout by naming where the app must live', () => {
    const missing = join(tmpdir(), 'dsh-desktop-absent')
    rmSync(missing, { force: true, recursive: true })
    expect(() => resolveDesktopAppDir(missing)).toThrow(/needs the desktop container app/u)
  })

  it('rejects an unbuilt checkout by naming the build command', () => {
    const dir = makeAppDir(false)
    try {
      expect(() => resolveDesktopAppDir(dir)).toThrow(/pnpm run build/u)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('resolveElectronBinary', () => {
  const appDir = '/app'

  it('returns the binary path the electron package exports', () => {
    // The existence check stays real, so the exported "binary" is a file this
    // test created.
    const existingFile = join(makeAppDir(true), 'package.json')
    try {
      expect(resolveElectronBinary('/app', {
        resolveEntry: () => '/node_modules/electron/index.js',
        readEntryExport: (entryModule) => {
          expect(entryModule).toBe('/node_modules/electron/index.js')
          return existingFile
        },
      })).toBe(existingFile)
    } finally {
      rmSync(existingFile, { force: true })
      rmSync(dirname(existingFile), { recursive: true, force: true })
    }
  })

  it('rejects an app directory with no electron install by naming the install command', () => {
    expect(() => resolveElectronBinary(appDir, { resolveEntry: () => { throw new Error('MODULE_NOT_FOUND') }, readEntryExport: () => undefined }))
      .toThrow(/electron is not installed/u)
  })

  it('rejects an electron export that is not a binary on disk', () => {
    for (const bogus of [42, '', '/gone/electron.exe']) {
      expect(() => resolveElectronBinary(appDir, { resolveEntry: () => '/node_modules/electron/index.js', readEntryExport: () => bogus }))
        .toThrow(/does not name a binary on disk/u)
    }
  })
})

/** A spawn double that records its launch and settles like the real child. */
class FakeChild extends EventEmitter {
  kill = vi.fn()
  constructor(readonly spawnargs: readonly string[]) {
    super()
  }
}

describe('launchDesktop', () => {
  it('spawns the binary with the app directory first, forwards arguments, and returns the exit code', async () => {
    const child = new FakeChild(['/electron', '/app', '--proxy-server=x'])
    const spawned: Array<{ file: string; args: string[]; stdio: unknown }> = []
    const exitCode = await launchDesktop('/electron', '/app', ['--proxy-server=x'], (file, args, options) => {
      spawned.push({ file, args: [...args], stdio: options.stdio })
      queueMicrotask(() => { child.emit('close', 7) })
      return child as unknown as ChildProcess
    })
    expect(exitCode).toBe(7)
    expect(spawned).toEqual([{ file: '/electron', args: ['/app', '--proxy-server=x'], stdio: 'inherit' }])
  })

  it('reports failure when the child dies to a signal instead of an observed exit code', async () => {
    const child = new FakeChild([])
    await expect(launchDesktop('/electron', '/app', [], () => {
      queueMicrotask(() => { child.emit('close', null, 'SIGKILL') })
      return child as unknown as ChildProcess
    })).resolves.toBe(1)
  })

  it('rejects when the binary cannot spawn at all', async () => {
    const child = new FakeChild([])
    await expect(launchDesktop('/electron', '/app', [], () => {
      queueMicrotask(() => { child.emit('error', new Error('ENOENT')) })
      return child as unknown as ChildProcess
    })).rejects.toThrow(/ENOENT/u)
  })
})

describe('DESKTOP_APP_DIR', () => {
  it('points at the sibling container-app checkout this repository ships', () => {
    expect(DESKTOP_APP_DIR.replaceAll('\\', '/')).toMatch(/apps\/desktop\/$/u)
    expect(existsSync(join(DESKTOP_APP_DIR, 'package.json'))).toBe(true)
  })
})

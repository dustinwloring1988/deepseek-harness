// Keyless browser e2e: the official DeepSeek route behaves like every other
// configurable provider — absent until added, deletable once added, and never
// the subject of a first-run prompt. Configuring a different provider first
// proves nothing resurfaces over a user who already has somewhere to send a
// request. Zero model calls: configuration is pure settings/credentials/llm
// domain traffic.
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import {
  acknowledgeReloadConnectionLoss, assertFixtureInventory, captureStableAria, compareOrRefreshGolden,
  launchWebScaffold, watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { ZH_BROWSER_LOCALE, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('./snapshots/onboarding-usable-provider', import.meta.url))
const DELETE_CONFIRM_EXPECTED = join(SNAPSHOT_DIR, 'delete-confirm.expected.md')
const MODE = webSnapshotMode()
const CREDENTIAL_STEP = '添加一个 API Key 开始使用'
const DELETE_TITLE = '删除 DeepSeek (deepseek-official)？'

describe.skipIf(MODE === 'record')('web e2e: DeepSeek is an ordinary addable, deletable provider', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({ deepSeekMissingCredential: true })
    browser = await chromium.launch()
    // The scenario asserts the shipped Chinese copy, so the browser asks for it.
    page = await browser.newPage({ viewport: { width: 1440, height: 960 }, locale: ZH_BROWSER_LOCALE })
    tripwire = watchConsole(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('boots with no prompt and DeepSeek offered only through the add card', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-onboarding-no-prompt'))
    await expect.poll(
      async () => page.getByRole('dialog', { name: CREDENTIAL_STEP }).count(),
      { timeout: 10_000 },
    ).toBe(0)
    expect(await page.locator('#root').evaluate(root => (root as HTMLElement).inert)).toBe(false)

    await page.getByRole('button', { name: '设置', exact: true }).click()
    const settings = page.getByRole('dialog', { name: '设置' })
    await settings.waitFor({ timeout: 10_000 })
    await settings.getByRole('button', { name: '模型' }).click()
    expect(await settings.getByText('DeepSeek', { exact: true }).count()).toBe(0)
    const add = settings.getByRole('button', { name: '添加提供方' })
    await expect.poll(async () => add.isEnabled(), { timeout: 10_000 }).toBe(true)
    await add.click()
    const pick = settings.getByLabel('提供方')
    await pick.waitFor({ timeout: 10_000 })
    const options = await pick.locator('option').allTextContents()
    expect(options).toContain('DeepSeek')
    expect(options).toContain('minimax-cn')

    expect(tripwire.warnings).toEqual([])
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('configures another provider and stays unprompted across a reload', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-onboarding-other-provider'))
    const settings = page.getByRole('dialog', { name: '设置' })
    const pick = settings.getByLabel('提供方')
    await pick.selectOption('minimax-cn')
    await settings.getByRole('textbox', { name: 'API 密钥', exact: true }).fill('sk-e2e-minimax')
    await settings.getByRole('button', { name: '保存', exact: true }).click()
    await settings.getByText('已保存 minimax-cn。', { exact: true }).waitFor({ timeout: 15_000 })

    const document = await readFile(join(scaffold.harnessHome, 'settings.yaml'), 'utf8')
    expect(document).toContain('apiKeyEnv: MINIMAX_CN_API_KEY')
    const credentials = await readFile(join(scaffold.harnessHome, '.credentials.yaml'), 'utf8')
    expect(credentials).toContain('MINIMAX_CN_API_KEY: sk-e2e-minimax')
    expect(credentials).not.toContain('DEEPSEEK')

    const warningsBefore = tripwire.warnings.length
    await page.reload({ waitUntil: 'load' })
    acknowledgeReloadConnectionLoss(tripwire, warningsBefore)
    await page.waitForSelector('[class*="frame"]', { timeout: 15_000 })
    // No first-run step exists to resurface over a configured user.
    await expect.poll(
      async () => page.getByRole('dialog', { name: CREDENTIAL_STEP }).count(),
      { timeout: 10_000 },
    ).toBe(0)
    expect(await page.locator('#root').evaluate(root => (root as HTMLElement).inert)).toBe(false)
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('adds and deletes DeepSeek through the same row actions as any provider', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-onboarding-delete-deepseek'))
    // The previous test reloaded the page, so the settings surface is closed.
    await page.getByRole('button', { name: '设置', exact: true }).click()
    const settings = page.getByRole('dialog', { name: '设置' })
    await settings.waitFor({ timeout: 10_000 })
    await settings.getByRole('button', { name: '模型' }).click()

    // Add: the same add card every provider uses.
    const add = settings.getByRole('button', { name: '添加提供方' })
    await expect.poll(async () => add.isEnabled(), { timeout: 10_000 }).toBe(true)
    await add.click()
    const pick = settings.getByLabel('提供方')
    await pick.waitFor({ timeout: 10_000 })
    await pick.selectOption('deepseek-official')
    await settings.getByRole('textbox', { name: 'API 密钥', exact: true }).fill('sk-e2e-deepseek')
    await settings.getByRole('button', { name: '保存', exact: true }).click()
    await settings.getByText('已保存 DeepSeek (deepseek-official)。', { exact: true })
      .waitFor({ timeout: 15_000 })

    // The stored profile is user-layer data, so the row carries a Delete
    // button — the capability the whole-section composition pin never had.
    const deepSeekRow = settings.getByText('DeepSeek', { exact: true }).first()
    await deepSeekRow.waitFor({ timeout: 10_000 })
    const deleteButton = deepSeekRow.locator('xpath=ancestor::li')
      .getByRole('button', { name: '删除 DeepSeek (deepseek-official)' })
    await deleteButton.waitFor({ timeout: 10_000 })

    // Confirm first, then cancel: nothing is removed without the dialog.
    await deleteButton.click()
    const deleteDialog = page.getByRole('dialog', { name: DELETE_TITLE })
    await deleteDialog.waitFor({ timeout: 10_000 })
    const confirmAria = await captureStableAria(page, `[role="dialog"][aria-label="${DELETE_TITLE}"]`, scaffold.workspaceCwd)
    await compareOrRefreshGolden(DELETE_CONFIRM_EXPECTED, confirmAria, MODE)
    await deleteDialog.getByRole('button', { name: '取消', exact: true }).click()
    await deleteDialog.waitFor({ state: 'detached', timeout: 10_000 })
    expect(await readFile(join(scaffold.harnessHome, 'settings.yaml'), 'utf8'))
      .toContain('deepseek-official:')

    // Confirm for real: the profile leaves settings.yaml and the page-managed
    // key leaves the credential document with it.
    await deleteButton.click()
    await page.getByRole('dialog', { name: DELETE_TITLE })
      .getByRole('button', { name: '删除 DeepSeek (deepseek-official)', exact: true })
      .click()
    await expect.poll(
      async () => readFile(join(scaffold.harnessHome, 'settings.yaml'), 'utf8'),
      { timeout: 10_000 },
    ).not.toContain('deepseek-official:')
    await expect.poll(
      async () => readFile(join(scaffold.harnessHome, '.credentials.yaml'), 'utf8'),
      { timeout: 10_000 },
    ).not.toContain('DEEPSEEK_OFFICIAL_API_KEY')
    await expect.poll(
      async () => settings.getByText('DeepSeek', { exact: true }).count(),
      { timeout: 10_000 },
    ).toBe(0)

    // Deletion restores the addable posture.
    await settings.getByRole('button', { name: '添加提供方' }).click()
    const repick = settings.getByLabel('提供方')
    await repick.waitFor({ timeout: 10_000 })
    expect(await repick.locator('option').allTextContents()).toContain('DeepSeek')

    expect((await page.content()).includes('sk-e2e-deepseek')).toBe(false)
    expect(tripwire.warnings).toEqual([])
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('keeps the fixture inventory closed', async () => {
    await assertFixtureInventory(SNAPSHOT_DIR, ['delete-confirm.expected.md'])
  })
})

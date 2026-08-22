# Agent Note: DeepSeek route presence is user-layer data

Status: implemented

English | [中文](2026-08-22-deepseek-route-presence-user-layer.zh.md)

## Problem

The official DeepSeek route was structurally inremovable. Its settings namespace was the profile itself (`settingsPath: []`), and `installSettingsSection` always installs the composition entry as the `base` layer with schemastery defaults applied, so the profile resolved on every boot: configuration surfaces rendered it permanently configured, no delete button could ever appear, and first-run onboarding nagged every keyless user for the official credential even when they intended to use only other providers. DeepSeek was privileged relative to every pi-ai catalog route, which ships dormant, becomes a row only when a user adds it, and stays deletable.

## Decision

The `llm-deepseek` settings section is a dict of provider profiles keyed by route — the same shape as `llm-pi-ai` — and this adapter serves exactly the `deepseek-official` key; any other key is refused by the section validator where it is written, not silently ignored.

Presence follows the layers:

- A composition that pins no profile composes **dormant**: no adapter route registers, while the directory entry still offers DeepSeek to configuration surfaces.
- Adding the route through any configuration surface (the web Models page or `settings.yaml`) stores `providers.deepseek-official` in the user layer; the row is then editable and deletable like a user-added pi-ai route. Deleting it withdraws the route.
- A launch environment that answers the profile's credential reference (`DEEPSEEK_API_KEY` by default) registers the route on its own, so the documented out-of-box CLI story (`DEEPSEEK_API_KEY` exported, zero stored configuration) is unchanged.

The dict shape is load-bearing, not stylistic: schemastery materializes an addressed nested *object* with its schema defaults into every resolved section value, so an object-shaped `provider` key could never read as absent once a settings provider mounts. Only a dict whose keys are absent survives resolution distinguishably. The web Models page lost its whole-section special cases with the same stroke: the setup-card posture (a provider rendering as an always-open card), the readiness projection behind the first-run credential dialog, and that dialog itself are gone. No step asks for any provider credential at startup; the welcome notice is the sole onboarding step.

The editor records the derived `<ROUTE>_API_KEY` reference into a stored profile whenever it stores a key, for both families. For DeepSeek this makes the page-stored ref (`DEEPSEEK_OFFICIAL_API_KEY`) the one request-time resolution reads from then on, which is what lets deletion remove exactly the credential the page stored.

## Alternatives considered

- **Keep the whole section as the profile and relax `removable`/`configured` in the UI join.** Rejected: the base layer would still resolve populated on every boot, so "deleted" could never be represented; the UI would be lying about layer state.
- **A plain nested `provider` object instead of a dict.** Rejected after implementation attempt: schemastery materializes absent nested objects with their defaults into the resolved value, so dormancy became undetectable the moment a settings provider mounted. The dict's absent keys are the only absence signal that survives resolution.
- **Remove `llm-deepseek` from the default bundle entirely** so nothing DeepSeek-specific ships. Rejected: without the directory entry the Models page could not offer DeepSeek back, and the native adapter (vision Files pipeline) would vanish for everyone rather than sitting dormant.
- **Gate registration on the credentials service instead of the launch environment.** Rejected: the seam resolves asynchronously and may be absent entirely (headless compositions), while the environment snapshot is synchronous and already the documented fallback plane for the reference.

## Consequences

Fresh keyless deployments see DeepSeek only as an addable entry, and the first-run credential prompt no longer exists anywhere. Compositions that pin `providers.deepseek-official` keep today's always-on behavior, correctly non-deletable because composition owns them. A user who deletes the stored profile while their environment exports `DEEPSEEK_API_KEY` sees the row disappear but the route keep serving — the environment is still configuration, and the README says so. Existing deployments that stored a key under `DEEPSEEK_API_KEY` through the old dialog keep working until they re-enter a key in the UI, which migrates the reference to `DEEPSEEK_OFFICIAL_API_KEY`; the delete confirmation names the credential it will remove.

Verification: `dynamic-config.spec.ts` pins dormant-at-boot, register-on-add, withdraw-on-delete, and ambient-environment registration against real settings/credential providers; `loader-composition.spec.ts` boots the dict shape through the Loader; `store.client.spec.ts` joins the dormant/pinned/user-stored postures; the two rewritten browser scenarios exercise add-with-key, delete-with-confirmation, and prompt-free boots end to end.

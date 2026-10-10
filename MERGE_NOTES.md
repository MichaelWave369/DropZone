# The Drop Zone: Three-Prototype Merge Notes

## v0.3 ingredients

| Origin | Useful contribution | v0.3 handling |
| --- | --- | --- |
| AppForge 369 | React/Vite base, GitHub Pages deployment, Tauri/PyInstaller/Capacitor build kits, public GitHub ZIP imports and bounded inspection | Retained |
| Claude App Packager | Custom icons, app/version metadata, standalone JSX scaffolding, PWA target and YAML workflow preview | Retained from v0.2 |
| Grok Forgepack workspace | Project-folder drag-and-drop, multiple-entry inspection, HTML preview, sample programs, additional path/size checks | Adapted into `src/grok-bridge.js`, tests and UI |

## Deliberately deferred

* Grok's server-side TanStack framework/auth/database/PGLite dependencies: irrelevant to the static, client-only GitHub Pages application.
* Grok's instant Windows HTA / Mac shell / Linux self-extracting `.run` launchers: these are portability wrappers, not the native installer targets advertised by Tauri, and are not equivalent to signed OS packages. Could be offered later under a distinct **Portable/Launcher** mode with explicit prerequisites and user consent.
* Grok's phone output: a hosted PWA, not an APK or IPA; The Drop Zone already has a separate PWA target and Capacitor native build recipes.
* Running JavaScript in a preview iframe: unsafe for untrusted projects. The v0.3 snapshot uses an empty iframe sandbox and restrictive CSP, so it is a markup preview only.
* Full JS/Node script executable packaging: requires an independently verified adapter, not just wrapping Node.js in a shell script.

## Engineering boundary

Generated packages are **source build kits** that need manually triggered GitHub Actions or local build tooling. We have not claimed native builds work until the runners produce inspectable artifacts. CI executes imported scripts; never submit untrusted code or repository secrets to a generated build.

14 local automated tests pass; JSX/JS syntax parsed via TypeScript; a full production Vite build could not run here due to registry DNS failure (`EAI_AGAIN`).

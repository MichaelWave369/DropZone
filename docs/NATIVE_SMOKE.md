# First native packaging smoke test

This is an **end-to-end Windows test** of The Drop Zone v0.3 packaging engine.

The workflow [`native-smoke.yml`](../.github/workflows/native-smoke.yml) takes only the checked-in, trusted [sample HTML page](../examples/hello.html). The Node script [`native-smoke-kit.mjs`](../scripts/native-smoke-kit.mjs) runs `inspectFile()` and `buildKit()` from the same `src/engine.js` used by the web UI and generates a Tauri 2 Windows project.

The Windows GitHub Actions runner then installs the generated project's dependencies, generates Tauri icons, compiles native bundles, and uploads the resulting **unsigned MSI/NSIS installer** as a workflow artifact if compilation succeeds.

## Run it

After this PR merges, open **Actions → Drop Zone native Windows smoke test → Run workflow**. It also runs automatically once when the new workflow lands on `main`. Successful runs expose an artifact named `dropzone-native-windows-smoke` at the bottom of the run page.

This is not an app store distribution or code-signing pipeline. A green workflow proves a **native build artifact was produced**, not that the installed app was interactively tested, notarized, or signed. An unsigned Windows app may raise a SmartScreen prompt.

## Failure investigation

Check the exact failing step: engine fixture generation, NPM dependency resolution, Tauri icon conversion, Rust/Tauri compilation, or artifact upload. Don't interpret a green React Pages deployment as proof that the native packaging pipeline passed.

## Safety

The workflow packages **only the repository's own trusted sample**, never arbitrary external uploads, user input, or code from pull requests. It uses read-only repository permissions and does not publish a GitHub Release. Do not automatically compile untrusted projects; the generated build kit's dependencies and build scripts can execute arbitrary code.

The smoke workflow is limited to a single Windows runner. Cross-platform Tauri, Python, Android and iOS outputs still need separate verified test runs.

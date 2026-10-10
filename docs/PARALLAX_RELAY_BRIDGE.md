# Parallax Relay × Drop Zone handoff v0.1

## Two distinct systems

- The Drop Zone runs as a browser-only React GitHub Pages app. Package exporting and PhiTar archive creation happen locally. Drop Zone has no storage backend or Relay session credentials.
- Parallax Relay has a deployed Netlify project named `parallax-relay-369`. Its current `parallax-network/apps/relay` source is **v0.1.1** using authenticated chunked uploads/downloads and Netlify Blobs. The user-supplied `Parallax_Relay_v0.1_Source.zip` is an earlier **v0.1 / Cloudflare R2** implementation. Do not copy that old R2 storage adapter into Drop Zone.
- The other uploaded `Parallax_XR_Relay_v0.1.0-candidate.1.zip` is a C++ motion/VR runtime project, not the artifact-transfer product.

## Shipped in Drop Zone v0.4 (manual approval workflow)

1. Generate a build-kit ZIP from your trusted source in Drop Zone, or make a ZIP/TAR.GZ in PhiTar.
2. Scroll to **Relay handoff**. The most recently exported Drop Zone ZIP is already staged, or select a local file manually.
3. Set project/version/recipient label and click **Prepare SHA-256 receipt**. The actual file bytes are hashed locally; the resulting receipt is marked `PREPARED_LOCAL_ONLY`.
4. Copy the handoff note or save the JSON receipt. **Open Parallax Relay** takes you to its exact HTTPS origin with no credentials, filenames or file content in the URL.
5. Sign into Relay on Netlify. Select the previously downloaded ZIP, set Project, Version, Recipient and paste the handoff note, then explicitly upload. This is the only step where file bytes reach a network service.
6. Resh or another trusted collaborator receives and downloads the file in Relay. Compare SHA-256 before using the files. Drag received ZIP/TAR into PhiTar, or a compatible source ZIP into Drop Zone.

**Important:** This v0.4 step is NOT an automatic cross-site upload, a delivery confirmation, or a verified live Relay API integration. We do not import cookies, prompt for access codes, embed Relay in an iframe, or expose Netlify credentials in GitHub Pages.

## Why not direct upload yet?

GitHub Pages and Netlify are different origins. Relay's v0.1.1 client uses `same-origin` authenticated cookies and protected Netlify Functions. A direct POST from GitHub Pages would require explicitly implemented cross-origin authorization, session and CSRF protections, a trusted-origin allowlist, and clear user consent. Simply enabling wildcard CORS or placing a session token in a query string would be unsafe.

**Current access caveat:** The reviewed Relay v0.1.1 source has an authenticated shared artifact ledger and download functions without recipient-specific access enforcement. A `recipient` field is a handoff label, **not a confidential access restriction**. Do not relay secrets or sensitive client code to an account you do not trust. Server-side malware scanning is not established, either.

## Future genuine one-click handoff

Build a separate, reviewed v0.2 bridge in `MichaelWave369/parallax-network` with:

1. An authenticated, receiver-origin handoff staging page using exact origin checks, a nonce and a user-clicked transfer confirmation.
2. Session-bound transfer capability with a short expiry; no token in URL; transfer only to recipient-scoped storage after explicit approval.
3. Server-side upload authorization, size/extension limits, per-recipient permission checks for listing, downloading and status actions, CSRF protection and audit logs.
4. Actual whole-file checksum verification, not merely a client-asserted checksum or chunk metadata; browser download hash verification.
5. Failure/cancel receipts and clean rollback. No silent sending of PhiTar outputs.

Until that functionality exists and has evidence from a deployed Netlify build, use the manual authenticated Relay interface.

## Audit and tests

`src/relay-handoff.js` performs local SHA-256 and builds a `dropzone.parallax-handoff.v1` JSON record. Tests verify the hash of `abc`, site origin and receipt state, size limits, and that no API access is required. Node tests + Vite production build run in `.github/workflows/verify.yml`. The Relay backend is **not** called during CI or document creation.
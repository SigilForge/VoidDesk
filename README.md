README.md
# VoidDesk (Hybrid)

Ultra-minimal Electron client with two modes:
- **API Mode** — local streaming client for OpenAI (or any compatible API)
- **Plus Mode** — embedded WebView of ChatGPT (uses your normal login & Plus features)

## Setup
1. Install Node 18+.
2. `npm i`
3. `npm run start`

## Usage
- Toggle top-left: **🜏 API** ↔ **☁ Plus**.
- **Plus Mode** persists your login (use *Logout Plus* if needed).
- **Send → Other (Ctrl/Cmd+Shift+S)** moves selected text between modes.

## Notes
- Config/history stored via `electron-store`.
- Default start in **Plus Mode** (can change in settings by editing `mode` in store).
- WebView CSP allows only OpenAI domains.

## Packaged builds
- `npm run pack` for platform builds.
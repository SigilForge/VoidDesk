README.md
# VoidDesk (Hybrid)

Ultra-minimal Electron client with three modes:
- **API Mode** — local streaming client for OpenAI (or any compatible API)
- **Web Mode** — embedded WebView of ChatGPT (uses your normal login & Plus features)
- **Codex Mode** — embedded OpenAI Playground session for rapid code & prompt testing

## Setup
1. Install Node 18+.
2. `npm i`
3. `npm run start`

## Usage
- Toggle top-left between **🜏 API**, **☁ Web**, and **⌘ Codex**.
- **Web Mode** persists your login (use *Logout Web* if needed).
- **Codex Mode** keeps its own session and last URL (use *Logout Codex* if you need a clean login).
- **Send → Other (Ctrl/Cmd+Shift+S)** moves selected text between modes.
- Configure Codex repos in **Settings** — add manual links or enter a GitHub owner (plus optional token) to populate the Codex repo picker.

## Codex CLI

- Run Codex-style prompts from the terminal with `npm run codex -- "Explain this code"` or `node codex-cli.js`.
- The CLI reuses your saved API key, base URL, model, and system prompt when available (falls back to `OPENAI_API_KEY` / `OPENAI_BASE_URL`).
- Supports streaming by default, the Responses API via `--responses`, and file context injection with `--file path/to/file`.
- Packaged builds place the helper at `VoidDesk/resources/bin/codex-cli.js` so it can be executed with `node` alongside the desktop app.

## Notes
- Config/history stored via `electron-store`.
- Default start in **Web Mode** (can change in settings by editing `mode` in store).
- WebView CSP allows OpenAI plus other HTTPS frames so Codex repo links (e.g. GitHub) load inside the app.
- GitHub tokens are stored locally in the app config when supplied for private repo access.

## Packaged builds
- `npm run pack` for platform builds.

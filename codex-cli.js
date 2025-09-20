#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");

const DEFAULT_MODEL = "gpt-4o-mini";
const CHAT_ENDPOINT = "/v1/chat/completions";
const RESPONSES_ENDPOINT = "/v1/responses";

function printHelp() {
  const help = `VoidDesk Codex CLI\n\n` +
    `Usage: node codex-cli.js [options] [prompt...]\n\n` +
    `Options:\n` +
    `  -k, --key <key>           API key (defaults to OPENAI_API_KEY or saved VoidDesk key)\n` +
    `  -b, --base-url <url>      API base URL (defaults to saved value or https://api.openai.com)\n` +
    `  -m, --model <name>        Model to use (defaults to saved value or ${DEFAULT_MODEL})\n` +
    `  -s, --system <prompt>     System instructions / persona\n` +
    `  -f, --file <path>         Append file contents to the prompt (repeatable)\n` +
    `      --responses           Use the Responses API instead of Chat Completions\n` +
    `      --chat                Force Chat Completions even if Responses is saved\n` +
    `      --no-stream           Disable streaming and print the final response\n` +
    `  -h, --help                Show this help message\n` +
    `\n` +
    `Examples:\n` +
    `  npm run codex -- "Write a bash script to list git branches"\n` +
    `  node codex-cli.js --file src/app.js "Review this file"\n` +
    `  node codex-cli.js --responses --system "You are an analyst" "Summarise input" < notes.txt\n`;
  process.stdout.write(help);
}

function parseArgs(argv) {
  const opts = {
    key: process.env.OPENAI_API_KEY || process.env.VOIDDESK_API_KEY || "",
    baseUrl: process.env.OPENAI_BASE_URL || process.env.VOIDDESK_BASE_URL || "",
    model: "",
    system: process.env.CODEX_CLI_SYSTEM || "",
    useResponses: null,
    stream: true,
    files: [],
    promptParts: [],
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case "-h":
      case "--help":
        opts.help = true;
        break;
      case "-k":
      case "--key":
        i += 1;
        opts.key = argv[i] || "";
        break;
      case "-b":
      case "--base-url":
        i += 1;
        opts.baseUrl = argv[i] || "";
        break;
      case "-m":
      case "--model":
        i += 1;
        opts.model = argv[i] || "";
        break;
      case "-s":
      case "--system":
        i += 1;
        opts.system = argv[i] || "";
        break;
      case "-f":
      case "--file":
        i += 1;
        if (argv[i]) opts.files.push(argv[i]);
        break;
      case "--responses":
        opts.useResponses = true;
        break;
      case "--chat":
        opts.useResponses = false;
        break;
      case "--no-stream":
        opts.stream = false;
        break;
      default:
        if (arg.startsWith("-")) {
          throw new Error(`Unknown option: ${arg}`);
        }
        opts.promptParts.push(arg);
        break;
    }
  }

  return opts;
}

function resolveStorePath() {
  const home = os.homedir();
  if (!home) return null;
  if (process.platform === "darwin") {
    return path.join(home, "Library", "Application Support", "VoidDesk", "voiddesk.json");
  }
  if (process.platform === "win32") {
    const appData = process.env.APPDATA || path.join(home, "AppData", "Roaming");
    return path.join(appData, "VoidDesk", "voiddesk.json");
  }
  const configHome = process.env.XDG_CONFIG_HOME || path.join(home, ".config");
  return path.join(configHome, "VoidDesk", "voiddesk.json");
}

function loadStoreDefaults() {
  const storePath = resolveStorePath();
  if (!storePath) return {};
  try {
    const raw = fs.readFileSync(storePath, "utf8");
    if (!raw) return {};
    const data = JSON.parse(raw);
    if (data && typeof data === "object") return data;
  } catch (err) {
    if (err && err.code !== "ENOENT") {
      console.warn(`Warning: Failed to read VoidDesk store (${err.message})`);
    }
  }
  return {};
}

async function readStdin() {
  return new Promise((resolve, reject) => {
    let out = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { out += chunk; });
    process.stdin.on("error", reject);
    process.stdin.on("end", () => resolve(out));
  });
}

function buildPrompt(basePrompt, fileList) {
  let prompt = basePrompt.trim();
  for (const file of fileList) {
    const resolved = path.resolve(file);
    let content;
    try {
      content = fs.readFileSync(resolved, "utf8");
    } catch (err) {
      throw new Error(`Failed to read file ${file}: ${err.message}`);
    }
    const relative = path.relative(process.cwd(), resolved) || path.basename(resolved);
    prompt += `\n\n# File: ${relative}\n${content}`;
  }
  return prompt.trim();
}

function normaliseBaseUrl(raw) {
  if (!raw) return "";
  let url = raw.trim();
  if (!url) return "";
  url = url.replace(/\/+$/, "");
  if (!/^https?:/i.test(url)) {
    throw new Error(`Invalid base URL: ${raw}`);
  }
  return url;
}

async function streamResponse(resp, { useResponses }) {
  const reader = resp.body.getReader();
  const decoder = new TextDecoder("utf8");
  let buffer = "";
  let collected = "";
  let errorMessage = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      let event;
      try {
        event = JSON.parse(payload);
      } catch (err) {
        continue;
      }
      if (useResponses) {
        if (event.type === "response.error") {
          errorMessage = event.error?.message || "Unknown error";
          continue;
        }
        const delta = extractResponsesDelta(event);
        if (delta) {
          collected += delta;
          process.stdout.write(delta);
        }
      } else {
        const delta = extractChatDelta(event);
        if (delta) {
          collected += delta;
          process.stdout.write(delta);
        }
      }
    }
  }

  if (buffer.trim().startsWith("data:")) {
    const payload = buffer.trim().slice(5).trim();
    if (payload && payload !== "[DONE]") {
      try {
        const event = JSON.parse(payload);
        if (useResponses) {
          const delta = extractResponsesDelta(event);
          if (delta) {
            collected += delta;
            process.stdout.write(delta);
          }
          if (!errorMessage && event.type === "response.error") {
            errorMessage = event.error?.message || "Unknown error";
          }
        } else {
          const delta = extractChatDelta(event);
          if (delta) {
            collected += delta;
            process.stdout.write(delta);
          }
        }
      } catch (_) {
        // ignore
      }
    }
  }

  if (collected && !collected.endsWith("\n")) {
    process.stdout.write("\n");
  }

  if (errorMessage) {
    process.stderr.write(`Error: ${errorMessage}\n`);
    process.exitCode = 1;
  }
}

function extractChatDelta(event) {
  const choice = Array.isArray(event?.choices) ? event.choices[0] : null;
  if (!choice || !choice.delta) return "";
  const delta = choice.delta.content;
  if (!delta) return "";
  if (Array.isArray(delta)) {
    return delta.map((part) => (typeof part?.text === "string" ? part.text : "")).join("");
  }
  return typeof delta === "string" ? delta : "";
}

function extractResponsesDelta(event) {
  if (!event || typeof event !== "object") return "";
  if (event.type === "response.output_text.delta" && typeof event.delta === "string") {
    return event.delta;
  }
  if (event.type === "response.output_text.done" && Array.isArray(event.output_text)) {
    return event.output_text.join("");
  }
  if (event.type === "response.error") {
    return "";
  }
  if (event.type === "response.refusal.delta" && typeof event.delta === "string") {
    return event.delta;
  }
  return "";
}

async function handleNonStream(resp, { useResponses }) {
  const data = await resp.json();
  let text = "";
  if (useResponses) {
    const outputs = Array.isArray(data?.output) ? data.output : [];
    const pieces = [];
    for (const item of outputs) {
      if (item && typeof item === "object" && item.type === "output_text" && typeof item.text === "string") {
        pieces.push(item.text);
      }
    }
    text = pieces.join("");
    if (!text && data?.output_text && Array.isArray(data.output_text)) {
      text = data.output_text.join("");
    }
    if (!text && data?.response?.output_text && Array.isArray(data.response.output_text)) {
      text = data.response.output_text.join("");
    }
    if (!text && data?.error) {
      const message = data.error?.message || JSON.stringify(data.error);
      throw new Error(message || "Responses API error");
    }
  } else {
    const choices = Array.isArray(data?.choices) ? data.choices : [];
    const first = choices[0];
    text = first?.message?.content || first?.delta?.content || "";
    if (Array.isArray(text)) {
      text = text.map((part) => (typeof part === "string" ? part : part?.text || "")).join("");
    }
    if (!text && data?.error) {
      throw new Error(data.error?.message || "Chat Completions API error");
    }
  }
  if (text) {
    process.stdout.write(text);
    if (!text.endsWith("\n")) process.stdout.write("\n");
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const defaults = loadStoreDefaults();
  if (!args.model) {
    if (typeof defaults.model === "string" && defaults.model.trim()) {
      args.model = defaults.model.trim();
    } else {
      args.model = DEFAULT_MODEL;
    }
  }
  if (!args.baseUrl) {
    const storedBase = typeof defaults.baseUrl === "string" ? defaults.baseUrl : "";
    args.baseUrl = storedBase || "https://api.openai.com";
  }
  if (!args.key && typeof defaults.apiKey === "string" && defaults.apiKey.trim()) {
    args.key = defaults.apiKey.trim();
  }
  if (!args.system && typeof defaults.system === "string") {
    args.system = defaults.system;
  }
  if (args.useResponses === null) {
    args.useResponses = defaults.apiKind === "responses";
  }

  args.key = (args.key || "").trim();
  args.system = (args.system || "").trim();
  args.baseUrl = normaliseBaseUrl(args.baseUrl || "https://api.openai.com");
  args.model = (args.model || DEFAULT_MODEL).trim();

  if (!args.key) {
    throw new Error("Missing API key. Use --key or set OPENAI_API_KEY.");
  }

  let prompt = args.promptParts.join(" ");
  if (!prompt && !process.stdin.isTTY) {
    prompt = await readStdin();
  }

  prompt = buildPrompt(prompt || "", args.files);
  if (!prompt) {
    throw new Error("No prompt provided. Pass text or pipe input.");
  }

  const endpoint = args.useResponses ? RESPONSES_ENDPOINT : CHAT_ENDPOINT;
  const url = `${args.baseUrl}${endpoint}`;

  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${args.key}`,
  };

  const body = args.useResponses
    ? buildResponsesBody({ model: args.model, system: args.system, prompt, stream: args.stream })
    : buildChatBody({ model: args.model, system: args.system, prompt, stream: args.stream });

  const resp = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    let text = "";
    try { text = await resp.text(); } catch (_) {}
    throw new Error(`Request failed (${resp.status}): ${text || resp.statusText}`);
  }

  if (!args.stream || !resp.body) {
    await handleNonStream(resp, { useResponses: args.useResponses });
  } else {
    await streamResponse(resp, { useResponses: args.useResponses });
  }
}

function buildChatBody({ model, system, prompt, stream }) {
  const messages = [];
  if (system && system.trim()) {
    messages.push({ role: "system", content: system.trim() });
  }
  messages.push({ role: "user", content: prompt });
  return { model, stream: !!stream, messages };
}

function buildResponsesBody({ model, system, prompt, stream }) {
  const trimmedSystem = system && system.trim();
  const input = [];
  if (trimmedSystem) {
    input.push({ role: "system", content: [{ type: "text", text: trimmedSystem }] });
  }
  input.push({ role: "user", content: [{ type: "input_text", text: prompt }] });
  const body = { model, stream: !!stream, input };
  if (trimmedSystem) {
    body.instructions = trimmedSystem;
  }
  return body;
}

main().catch((err) => {
  process.stderr.write(`Error: ${err?.message || err}\n`);
  process.exitCode = 1;
});

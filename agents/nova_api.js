'use strict';
// Nova client (Requirement 1.1-1.3).
//
// Mode is decided on every call:
//   - Mock_Mode (AWS_BEARER_TOKEN_BEDROCK unset or empty): log "MOCK MODE",
//     make no network call, and return the "text" field of
//     <mockDir>/<cacheKey>.json.
//   - Live mode (token set): one Bedrock Converse request per call, see
//     liveConverse below.
//
// The Bedrock SDK is never required at module load. Live mode must require it
// lazily inside liveConverse, so Mock_Mode never loads it.
// The token is read from the environment only and is never logged.

const path = require('path');
const fs = require('fs').promises;
const { cacheKey, DEFAULT_MODEL_ID } = require('./cache_store');

const REGION = 'us-east-2';
const MODEL_ID = 'us.amazon.nova-2-lite-v1:0';
const TOKEN_ENV = 'AWS_BEARER_TOKEN_BEDROCK';
const DEFAULT_MOCK_DIR = path.join(__dirname, 'cache', 'mock');

if (DEFAULT_MODEL_ID !== MODEL_ID) {
  // cache_store duplicates MODEL_ID to avoid a require cycle; keep them equal.
  throw new Error(`cache_store DEFAULT_MODEL_ID (${DEFAULT_MODEL_ID}) differs from nova_api MODEL_ID (${MODEL_ID})`);
}

// Mock directory override for tests. Precedence: setMockDir() value, then the
// NOVA_MOCK_DIR environment variable, then agents/cache/mock.
let mockDirOverride = null;

function setMockDir(dir) {
  if (dir !== null && typeof dir !== 'string') {
    throw new TypeError('setMockDir: dir must be a string or null');
  }
  mockDirOverride = dir === null ? null : path.resolve(dir);
}

function getMockDir() {
  if (mockDirOverride) return mockDirOverride;
  if (process.env.NOVA_MOCK_DIR) return path.resolve(process.env.NOVA_MOCK_DIR);
  return DEFAULT_MOCK_DIR;
}

function isMockMode() {
  const token = process.env[TOKEN_ENV];
  return token === undefined || token === '';
}

// Absolute path of the mock file for a request.
function mockPath(prompt, pdfBytes) {
  return path.join(getMockDir(), cacheKey(MODEL_ID, prompt, pdfBytes) + '.json');
}

async function mockResponse(prompt, pdfBytes) {
  console.log('MOCK MODE');
  const file = mockPath(prompt, pdfBytes);
  let raw;
  try {
    raw = await fs.readFile(file, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') throw new Error(`Mock response missing: ${file}`);
    throw new Error(`Mock response unreadable: ${file} (${err && err.message})`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Mock response unreadable: ${file} (invalid JSON: ${err.message})`);
  }
  if (!parsed || typeof parsed.text !== 'string') {
    throw new Error(`Mock response unreadable: ${file} (missing string "text" field)`);
  }
  return parsed.text;
}

// ---------------------------------------------------------------------------
// Live mode (Requirement 1.1)
//
// Auth: the token is read from process.env[TOKEN_ENV] on every call, passed to
// the SDK as a bearer token and never logged, echoed in errors or written to
// disk.
//
// VERIFY when AWS access arrives: whether the installed SDK reads
// AWS_BEARER_TOKEN_BEDROCK by itself (aws-sdk-js-v3 issue #7204,
// https://github.com/aws/aws-sdk-js-v3/issues/7204). The installed
// @aws-sdk/client-bedrock-runtime 3.1156.0 appears to: its httpBearerAuth
// identity provider falls back to fromEnvSigningName({ signingName: "bedrock" })
// and the auth-scheme preference switches to httpBearerAuth when that variable
// exists. We still pass `token` and `authSchemePreference` explicitly so auth
// does not depend on that auto-detection. If the SDK path fails against real
// Bedrock, use liveConverseFetch below instead: a plain fetch to
// https://bedrock-runtime.us-east-1.amazonaws.com/model/<modelId>/converse with
// `Authorization: Bearer <token>`, as documented in
// https://docs.aws.amazon.com/bedrock/latest/userguide/api-keys-use.html
// ---------------------------------------------------------------------------

function readToken() {
  const token = process.env[TOKEN_ENV];
  if (typeof token !== 'string' || token === '') {
    throw new Error(`${TOKEN_ENV} is not set; live mode needs it`);
  }
  return token;
}

// Converse messages for one request. The document block (when given) goes
// before the text block in the same user message.
function buildMessages(prompt, pdfBytes) {
  const content = [];
  if (pdfBytes) {
    content.push({ document: { format: 'pdf', name: 'rulebook', source: { bytes: pdfBytes } } });
  }
  content.push({ text: prompt });
  return [{ role: 'user', content }];
}

function buildConverseInput(prompt, pdfBytes) {
  return {
    modelId: MODEL_ID,
    messages: buildMessages(prompt, pdfBytes),
    inferenceConfig: { temperature: 0 },
  };
}

// Concatenated text blocks of output.message.content. Non-text blocks are
// skipped. A response with no text block is an error, never an empty answer.
function extractText(response) {
  const content = response && response.output && response.output.message
    && response.output.message.content;
  if (!Array.isArray(content)) {
    throw new Error('Bedrock Converse response has no output.message.content');
  }
  const texts = content.filter((b) => b && typeof b.text === 'string').map((b) => b.text);
  if (texts.length === 0) {
    throw new Error('Bedrock Converse response has no text blocks');
  }
  return texts.join('');
}

// SDK path: one ConverseCommand per call. The SDK is required here, lazily, so
// Mock_Mode never loads it. options.clientConfig is merged into the client
// config (tests use it to inject a requestHandler; no network).
async function liveConverse({ prompt, pdfBytes }, options = {}) {
  const token = readToken();
  const { BedrockRuntimeClient, ConverseCommand } = require('@aws-sdk/client-bedrock-runtime');
  const client = new BedrockRuntimeClient({
    region: REGION,
    token: async () => ({ token }),
    authSchemePreference: ['httpBearerAuth'],
    maxAttempts: 1, // exactly one Converse request per call, no SDK retries
    ...(options.clientConfig || {}),
  });
  try {
    const response = await client.send(new ConverseCommand(buildConverseInput(prompt, pdfBytes)));
    return extractText(response);
  } finally {
    client.destroy();
  }
}

function converseUrl() {
  return `https://bedrock-runtime.${REGION}.amazonaws.com/model/${encodeURIComponent(MODEL_ID)}/converse`;
}

// Fallback path (see VERIFY note above): the Converse REST API over fetch.
// Document bytes are base64 in JSON. options.fetchImpl defaults to global fetch.
async function liveConverseFetch({ prompt, pdfBytes }, options = {}) {
  const token = readToken();
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const messages = buildMessages(prompt, pdfBytes);
  if (pdfBytes) {
    messages[0].content[0].document.source.bytes = Buffer.from(pdfBytes).toString('base64');
  }
  const res = await fetchImpl(converseUrl(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ messages, inferenceConfig: { temperature: 0 } }),
  });
  const bodyText = await res.text();
  let body = null;
  try {
    body = bodyText ? JSON.parse(bodyText) : null;
  } catch (err) {
    if (res.ok) throw new Error(`Bedrock Converse response is not JSON: ${err.message}`);
  }
  if (!res.ok) {
    const msg = (body && (body.message || body.Message)) || bodyText || res.statusText;
    throw new Error(`Bedrock Converse failed: HTTP ${res.status}: ${msg}`);
  }
  return extractText(body);
}

function checkPrompt(prompt) {
  if (typeof prompt !== 'string') throw new TypeError('prompt must be a string');
}

async function askNova(prompt) {
  checkPrompt(prompt);
  if (isMockMode()) return mockResponse(prompt, null);
  return liveConverse({ prompt, pdfBytes: null });
}

async function askNovaWithPdf(prompt, pdfBytes) {
  checkPrompt(prompt);
  if (!(pdfBytes instanceof Uint8Array)) {
    throw new TypeError('askNovaWithPdf: pdfBytes must be a Uint8Array');
  }
  if (isMockMode()) return mockResponse(prompt, pdfBytes);
  return liveConverse({ prompt, pdfBytes });
}

module.exports = {
  REGION,
  MODEL_ID,
  TOKEN_ENV,
  DEFAULT_MOCK_DIR,
  askNova,
  askNovaWithPdf,
  isMockMode,
  mockPath,
  setMockDir,
  getMockDir,
  liveConverse,
  liveConverseFetch,
  buildConverseInput,
  extractText,
  converseUrl,
};

'use strict';
// Live-mode request shape tests (task 4.2, Requirement 1.1). No network: the
// SDK gets an injected requestHandler and the fetch fallback an injected fetch.
// The token is a fake value, set only for each test and restored afterwards.

const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const nova = require('../nova_api');

const FAKE_TOKEN = 'test-token-not-real';

function withToken(fn) {
  return async () => {
    const prev = process.env[nova.TOKEN_ENV];
    process.env[nova.TOKEN_ENV] = FAKE_TOKEN;
    try {
      await fn();
    } finally {
      if (prev === undefined) delete process.env[nova.TOKEN_ENV];
      else process.env[nova.TOKEN_ENV] = prev;
    }
  };
}

const CANNED = {
  output: { message: { role: 'assistant', content: [{ text: 'Hello ' }, { text: 'world' }] } },
  stopReason: 'end_turn',
  usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
  metrics: { latencyMs: 1 },
};

// Captures every request the SDK would send and answers with CANNED.
function capturingHandler() {
  const requests = [];
  return {
    requests,
    handler: {
      async handle(request) {
        requests.push(request);
        return {
          response: {
            statusCode: 200,
            headers: { 'content-type': 'application/json' },
            body: Readable.from([Buffer.from(JSON.stringify(CANNED))]),
          },
        };
      },
      updateHttpClientConfig() {},
      httpHandlerConfigs() { return {}; },
      destroy() {},
    },
  };
}

test('extractText concatenates text blocks and skips others', () => {
  const text = nova.extractText({
    output: { message: { content: [{ text: 'a' }, { reasoningContent: {} }, { text: 'b' }] } },
  });
  assert.equal(text, 'ab');
  assert.throws(() => nova.extractText({ output: { message: { content: [] } } }), /no text blocks/);
  assert.throws(() => nova.extractText({}), /no output\.message\.content/);
});

test('buildConverseInput: model, temperature 0, document block before text', () => {
  const bytes = new Uint8Array([1, 2, 3]);
  const input = nova.buildConverseInput('P', bytes);
  assert.equal(input.modelId, 'us.amazon.nova-2-lite-v1:0');
  assert.deepEqual(input.inferenceConfig, { temperature: 0 });
  assert.deepEqual(input.messages, [{
    role: 'user',
    content: [
      { document: { format: 'pdf', name: 'rulebook', source: { bytes } } },
      { text: 'P' },
    ],
  }]);
  assert.deepEqual(nova.buildConverseInput('P', null).messages[0].content, [{ text: 'P' }]);
});

test('SDK path sends one bearer-auth Converse request and returns joined text', withToken(async () => {
  const cap = capturingHandler();
  const pdf = new Uint8Array([37, 80, 68, 70]);
  const text = await nova.liveConverse({ prompt: 'Read it', pdfBytes: pdf }, {
    clientConfig: { requestHandler: cap.handler },
  });
  assert.equal(text, 'Hello world');
  assert.equal(cap.requests.length, 1);
  const req = cap.requests[0];
  assert.equal(req.hostname, 'bedrock-runtime.us-east-1.amazonaws.com');
  assert.match(decodeURIComponent(req.path), /^\/model\/us\.amazon\.nova-2-lite-v1:0\/converse$/);
  const auth = req.headers.authorization || req.headers.Authorization;
  assert.equal(auth, `Bearer ${FAKE_TOKEN}`);
  const body = JSON.parse(typeof req.body === 'string' ? req.body : new TextDecoder().decode(req.body));
  assert.deepEqual(body.inferenceConfig, { temperature: 0 });
  assert.deepEqual(body.messages[0].content[0].document.format, 'pdf');
  assert.equal(body.messages[0].content[0].document.name, 'rulebook');
  assert.equal(body.messages[0].content[0].document.source.bytes, Buffer.from(pdf).toString('base64'));
  assert.deepEqual(body.messages[0].content[1], { text: 'Read it' });
}));

test('fetch fallback posts to the converse URL with a Bearer header', withToken(async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 200, statusText: 'OK', text: async () => JSON.stringify(CANNED) };
  };
  const pdf = new Uint8Array([9, 8, 7]);
  const text = await nova.liveConverseFetch({ prompt: 'Q', pdfBytes: pdf }, { fetchImpl });
  assert.equal(text, 'Hello world');
  assert.equal(calls.length, 1);
  assert.equal(decodeURIComponent(calls[0].url),
    'https://bedrock-runtime.us-east-1.amazonaws.com/model/us.amazon.nova-2-lite-v1:0/converse');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${FAKE_TOKEN}`);
  const body = JSON.parse(calls[0].init.body);
  assert.deepEqual(body.inferenceConfig, { temperature: 0 });
  assert.deepEqual(body.messages[0].content, [
    { document: { format: 'pdf', name: 'rulebook', source: { bytes: Buffer.from(pdf).toString('base64') } } },
    { text: 'Q' },
  ]);
}));

test('fetch fallback surfaces the Bedrock error message without the token', withToken(async () => {
  const fetchImpl = async () => ({
    ok: false, status: 403, statusText: 'Forbidden',
    text: async () => JSON.stringify({ message: 'Access denied' }),
  });
  await assert.rejects(nova.liveConverseFetch({ prompt: 'Q', pdfBytes: null }, { fetchImpl }), (err) => {
    assert.match(err.message, /HTTP 403: Access denied/);
    assert.ok(!err.message.includes(FAKE_TOKEN));
    return true;
  });
}));

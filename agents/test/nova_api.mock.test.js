'use strict';
// Mock_Mode tests (task 4.3, Requirements 1.2 and 1.3). The token is removed
// for each test and restored afterwards. Mock files live in a temp directory
// selected with setMockDir; the shipped agents/cache/mock is never touched.

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs/promises');
const { execFileSync } = require('node:child_process');
const nova = require('../nova_api');

const NOVA_PATH = path.join(__dirname, '..', 'nova_api.js');
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]); // "%PDF-1.7"

// Runs fn in Mock_Mode with a fresh temp mock dir; restores token and dir.
function inMockMode(fn) {
  return async (t) => {
    const prev = process.env[nova.TOKEN_ENV];
    delete process.env[nova.TOKEN_ENV];
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nova-mock-'));
    nova.setMockDir(dir);
    try {
      await fn(t, dir);
    } finally {
      nova.setMockDir(null);
      if (prev === undefined) delete process.env[nova.TOKEN_ENV];
      else process.env[nova.TOKEN_ENV] = prev;
      await fs.rm(dir, { recursive: true, force: true });
    }
  };
}

async function writeMock(prompt, pdfBytes, text) {
  const file = nova.mockPath(prompt, pdfBytes);
  await fs.writeFile(file, JSON.stringify({ text }), 'utf8');
  return file;
}

function logged(t) {
  return t.mock.method(console, 'log', () => {});
}

function loggedLines(spy) {
  return spy.mock.calls.map((c) => c.arguments.join(' '));
}

test('unset and empty token both mean Mock_Mode', async () => {
  const prev = process.env[nova.TOKEN_ENV];
  try {
    delete process.env[nova.TOKEN_ENV];
    assert.equal(nova.isMockMode(), true);
    process.env[nova.TOKEN_ENV] = '';
    assert.equal(nova.isMockMode(), true);
    process.env[nova.TOKEN_ENV] = 'x';
    assert.equal(nova.isMockMode(), false);
  } finally {
    if (prev === undefined) delete process.env[nova.TOKEN_ENV];
    else process.env[nova.TOKEN_ENV] = prev;
  }
});

test('askNova returns the mock file text and logs MOCK MODE', inMockMode(async (t, dir) => {
  const prompt = 'List the sections.';
  const file = await writeMock(prompt, null, 'Section A\nSection B');
  assert.equal(path.dirname(file), dir);
  const spy = logged(t);
  const text = await nova.askNova(prompt);
  assert.equal(text, 'Section A\nSection B');
  assert.ok(loggedLines(spy).includes('MOCK MODE'));
}));

test('askNovaWithPdf returns the mock file keyed by prompt and PDF bytes', inMockMode(async (t) => {
  const prompt = 'Extract from the rulebook.';
  await writeMock(prompt, PDF, 'with pdf');
  await writeMock(prompt, null, 'without pdf');
  const spy = logged(t);
  assert.equal(await nova.askNovaWithPdf(prompt, PDF), 'with pdf');
  assert.equal(await nova.askNova(prompt), 'without pdf');
  assert.ok(loggedLines(spy).includes('MOCK MODE'));
}));

test('empty-string token is Mock_Mode for calls too', inMockMode(async (t) => {
  process.env[nova.TOKEN_ENV] = '';
  await writeMock('p', null, 'mocked');
  logged(t);
  assert.equal(await nova.askNova('p'), 'mocked');
}));

test('missing mock file throws an error naming the expected absolute path', inMockMode(async (t, dir) => {
  logged(t);
  const prompt = 'No mock for this one.';
  const expected = nova.mockPath(prompt, null);
  assert.ok(path.isAbsolute(expected));
  assert.equal(path.dirname(expected), dir);
  await assert.rejects(nova.askNova(prompt), (err) => {
    assert.equal(err.message, `Mock response missing: ${expected}`);
    return true;
  });

  const expectedPdf = nova.mockPath(prompt, PDF);
  assert.notEqual(expectedPdf, expected);
  await assert.rejects(nova.askNovaWithPdf(prompt, PDF), (err) => {
    assert.equal(err.message, `Mock response missing: ${expectedPdf}`);
    return true;
  });
}));

// A fresh Node process with the token removed: network primitives are
// replaced with throwing stubs before nova_api is required, then both mock
// calls run and the child reports what it saw.
test('Mock_Mode loads no Bedrock SDK module and makes no network call', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nova-mock-child-'));
  try {
    const script = `
      'use strict';
      const net = require('net');
      const http = require('http');
      const https = require('https');
      const attempts = [];
      const block = (name) => function () { attempts.push(name); throw new Error('network blocked: ' + name); };
      globalThis.fetch = block('fetch');
      http.request = block('http.request'); http.get = block('http.get');
      https.request = block('https.request'); https.get = block('https.get');
      net.connect = block('net.connect'); net.createConnection = block('net.createConnection');
      net.Socket.prototype.connect = block('net.Socket.connect');
      const fs = require('fs');
      const [novaPath, dir] = JSON.parse(process.argv[1]);
      const nova = require(novaPath);
      nova.setMockDir(dir);
      const pdf = new Uint8Array([1, 2, 3]);
      fs.writeFileSync(nova.mockPath('q', null), JSON.stringify({ text: 'plain' }));
      fs.writeFileSync(nova.mockPath('q', pdf), JSON.stringify({ text: 'pdf' }));
      (async () => {
        const logs = [];
        const origLog = console.log;
        console.log = (...a) => logs.push(a.join(' '));
        let results;
        try {
          results = [await nova.askNova('q'), await nova.askNovaWithPdf('q', pdf)];
          try { await nova.askNova('missing'); } catch (e) { results.push(e.message); }
        } finally {
          console.log = origLog;
        }
        const sdk = Object.keys(require.cache).filter((k) => k.split(/[\\\\/]/).includes('@aws-sdk'));
        process.stdout.write(JSON.stringify({ results, logs, attempts, sdk }));
      })().catch((e) => { process.stderr.write(String(e && e.stack)); process.exit(1); });
    `;
    const env = { ...process.env };
    delete env[nova.TOKEN_ENV];
    delete env.NOVA_MOCK_DIR;
    const out = execFileSync(process.execPath, ['-e', script, JSON.stringify([NOVA_PATH, dir])], {
      env,
      encoding: 'utf8',
    });
    const report = JSON.parse(out);
    assert.equal(report.results[0], 'plain');
    assert.equal(report.results[1], 'pdf');
    assert.match(report.results[2], /^Mock response missing: /);
    assert.deepEqual(report.logs, ['MOCK MODE', 'MOCK MODE', 'MOCK MODE']);
    assert.deepEqual(report.attempts, []);
    assert.deepEqual(report.sdk, []);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

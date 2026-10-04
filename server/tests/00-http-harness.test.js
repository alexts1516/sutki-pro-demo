import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { request } from './helpers.js';

test('HTTP harness: повторные и параллельные запросы обслуживает один listener, ответы не повторяются скрыто', async () => {
  const app = express(); let calls = 0;
  app.post('/check', (req, res) => res.json({ port: req.socket.localPort, calls: ++calls }));
  const first = await request(app).post('/check');
  const results = await Promise.all(Array.from({ length: 20 }, () => request(app).post('/check')));
  for (const result of results) {
    assert.equal(result.status, 200); assert.equal(result.body.port, first.body.port);
  }
  assert.equal(calls, 21);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { id } from 'ethers';
import { generateResult } from '../scripts/ai-worker.mjs';

const task = { schema: 'ai-era.task.v1', prompt: 'Write a short product description.' };
test('AI adapter sends model and prompt, commits exact specification and result bytes', async () => {
  const output = await generateResult(task, { model: 'test-model', fetchImpl: async (url, options) => {
    assert.equal(url.href, 'http://127.0.0.1:11434/api/generate');
    assert.deepEqual(JSON.parse(options.body), { model: 'test-model', prompt: task.prompt, stream: false });
    return { ok: true, json: async () => ({ done: true, response: 'A result.', model: 'test-model' }) };
  }});
  assert.equal(output.specificationHash, id(output.specificationJSON));
  assert.equal(output.resultHash, id(output.resultJSON));
  assert.equal(JSON.parse(output.resultJSON).specificationHash, output.specificationHash);
  assert.equal(JSON.parse(output.resultJSON).text, 'A result.');
});
test('AI adapter refuses missing model, invalid task, endpoint failure and incomplete result', async () => {
  await assert.rejects(generateResult(task), /OLLAMA_MODEL/);
  await assert.rejects(generateResult({}, { model: 'test' }), /schema/);
  await assert.rejects(generateResult(task, { model: 'test', fetchImpl: async () => ({ ok: false, status: 503 }) }), /503/);
  await assert.rejects(generateResult(task, { model: 'test', fetchImpl: async () => ({ ok: true,
    json: async () => ({ done: false, response: '' }) }) }), /completed/);
});

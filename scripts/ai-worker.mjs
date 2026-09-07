import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { id } from 'ethers';

export async function generateResult(task, { model, baseUrl = 'http://127.0.0.1:11434', fetchImpl = fetch } = {}) {
  if (typeof model !== 'string' || !model.trim()) throw new Error('Set OLLAMA_MODEL to an installed model name.');
  if (task.schema !== 'ai-era.task.v1' || typeof task.prompt !== 'string' || !task.prompt.trim()) {
    throw new Error('Task must have schema ai-era.task.v1 and a nonempty prompt.');
  }
  const url = new URL('/api/generate', baseUrl);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Invalid inference URL.');
  const response = await fetchImpl(url, { method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, prompt: task.prompt, stream: false }),
    signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`Inference service failed: HTTP ${response.status}`);
  const data = await response.json();
  if (data.done !== true || typeof data.response !== 'string' || !data.response.trim()) {
    throw new Error('Inference service did not return a completed text response.');
  }
  const specificationJSON = JSON.stringify(task);
  const result = { schema: 'ai-era.result.v1', specificationHash: id(specificationJSON),
    model: data.model ?? model, text: data.response, generatedAt: new Date().toISOString(),
    provenance: 'Inference endpoint response; model identity is self-reported, not cryptographically attested.' };
  const resultJSON = JSON.stringify(result);
  return { specificationJSON, resultJSON, specificationHash: id(specificationJSON), resultHash: id(resultJSON) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (!process.argv[2]) throw new Error('Usage: node scripts/ai-worker.mjs task.json');
    const task = JSON.parse(await fs.readFile(path.resolve(process.argv[2]), 'utf8'));
    const generated = await generateResult(task, { model: process.env.OLLAMA_MODEL,
      baseUrl: process.env.OLLAMA_URL || 'http://127.0.0.1:11434' });
    const out = fileURLToPath(new URL('../reports/', import.meta.url));
    await fs.mkdir(out, { recursive: true });
    // Hash the exact compact UTF-8 JSON bytes saved here. Do not reformat before verification.
    await fs.writeFile(path.join(out, 'ai-specification.json'), generated.specificationJSON);
    await fs.writeFile(path.join(out, 'ai-result.json'), generated.resultJSON);
    await fs.writeFile(path.join(out, 'ai-hashes.json'), JSON.stringify({
      specificationHash: generated.specificationHash, resultHash: generated.resultHash }, null, 2));
    console.log(`Specification hash: ${generated.specificationHash}\nResult hash: ${generated.resultHash}\nSaved in reports/. Review the result before submitting or approving on chain.`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}

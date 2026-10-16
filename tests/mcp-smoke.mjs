/**
 * MCP smoke test: spawn the ontoskill server, complete a real MCP handshake,
 * list tools, and exercise each one. Proves the server actually speaks MCP
 * rather than merely existing.
 *
 * Usage: node tests/mcp-smoke.mjs
 */
import { spawn } from 'node:child_process';
import path from 'node:path';

const SERVER = path.resolve(import.meta.dirname, '..', 'src', 'mcp-server.mjs');
const child = spawn(process.execPath, [SERVER], { stdio: ['pipe', 'pipe', 'inherit'] });

const pending = new Map();
let buf = '';
child.stdout.on('data', (d) => {
  buf += d.toString();
  let i;
  while ((i = buf.indexOf('\n')) !== -1) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    const msg = JSON.parse(line);
    if (pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  }
});

let id = 0;
function send(method, params) {
  const msgId = ++id;
  return new Promise((resolve, reject) => {
    pending.set(msgId, resolve);
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: msgId, method, params }) + '\n');
    setTimeout(() => reject(new Error(`timeout waiting for ${method}`)), 30_000);
  });
}

const results = [];
function check(name, cond, detail = '') {
  results.push({ name, ok: Boolean(cond), detail });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
}

try {
  const init = await send('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'smoke', version: '1' } });
  check('initialize handshake', init.result?.serverInfo?.name === 'ontoskill', JSON.stringify(init.result?.serverInfo));

  const list = await send('tools/list', {});
  const names = list.result?.tools?.map((t) => t.name) ?? [];
  check('tools/list returns 4 tools', names.length === 4, names.join(', '));

  const ok1 = await send('tools/call', { name: 'ontoskill', arguments: { intent: 'Show me the highest-volume mandi listings' } });
  const r1 = JSON.parse(ok1.result.content[0].text);
  check('ontoskill resolves a real namespace', r1.resolved?.project === 'mandi_board_v1', r1.expression);
  check('ontoskill picks the real discriminator', r1.resolved?.discriminator === 'type', `discriminator=${r1.resolved?.discriminator}`);
  check('ontoskill emits grammar-valid output', r1.grammarValid === true);

  const okA = await send('tools/call', { name: 'ontoskill', arguments: { intent: 'highest amount' } });
  const rA = JSON.parse(okA.result.content[0].text);
  check('ontoskill widens type ambiguity', rA.disambiguation?.length > 0, `${JSON.stringify(rA.disambiguation?.[0]?.observedTypes)}`);

  const ok2 = await send('tools/call', { name: 'ontoskill', arguments: { intent: 'find expert mentors for account abstraction' } });
  const r2 = JSON.parse(ok2.result.content[0].text);
  check('ontoskill refuses to invent (no expression)', !r2.expression, `warnings=${r2.warnings?.length}`);

  const ok3 = await send('tools/call', { name: 'validate_filter', arguments: { expression: 'reputationScore >= 4.5 && type = "Profile"' } });
  const r3 = JSON.parse(ok3.result.content[0].text);
  check('validate_filter catches the plan example', r3.ok === false && r3.violations.length >= 3, `${r3.violations.length} violations`);

  const ok4 = await send('tools/call', { name: 'validate_filter', arguments: { expression: "project = str('mandi_board_v1') AND amount >= u64(0)" } });
  const r4 = JSON.parse(ok4.result.content[0].text);
  check('validate_filter passes a correct expression', r4.ok === true);

  const ok5 = await send('tools/call', { name: 'arkiv_vocabulary', arguments: { kind: 'ambiguous' } });
  const r5 = JSON.parse(ok5.result.content[0].text);
  check('arkiv_vocabulary lists ambiguous attributes', Array.isArray(r5) && r5.length === 29, `${r5.length} ambiguous`);

  const ok6 = await send('tools/call', { name: 'arkiv_query', arguments: { expression: '' } });
  check('arkiv_query rejects an empty filter', ok6.result?.isError === true, ok6.result?.content?.[0]?.text?.slice(0, 60));

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  child.kill();
  process.exit(failed.length ? 1 : 0);
} catch (e) {
  console.error('SMOKE FAILED:', e.message);
  child.kill();
  process.exit(1);
}

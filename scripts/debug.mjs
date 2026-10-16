/** Ad-hoc predicate debugger. Usage: node scripts/debug.mjs */
import { createClient } from '../src/rpc.mjs';

const client = createClient({ paceMs: 1200 });
const M = "project = str('mandi_board_v1')";
const B = "project = str('bhaiyaplease')";

const EXPRS = [
  // what types does `price` actually carry?
  `${M} AND price >= dec(0)`,
  `${M} AND price >= dec(1)`,
  `${M} AND price > dec(0)`,
  `${M} AND price >= u64(0)`,
  `${M} AND price >= i32(0)`,
  `${M} AND price >= u256(0)`,
  // what types does `tip` actually carry?
  `${B} AND tip >= i32(0)`,
  `${B} AND tip >= i32(1)`,
  `${B} AND tip >= i32(5)`,
  `${B} AND tip >= i32(10)`,
  `${B} AND tip > i32(0)`,
  `${B} AND tip = i32(10)`,
  // discriminator distribution
  `${M} AND type = str('price_vote')`,
  `${M} AND NOT type = str('price_vote')`,
  `${M} AND type STARTSWITH str('price')`,
];
for (const e of EXPRS) {
  try {
    const n = await client.count(e);
    console.log(`${String(n).padStart(5)}  ${e.replace(/project = str\('[a-z_0-9]+'\) AND /, '')}`);
  } catch (err) {
    console.log(`  ERR  ${e}  -> ${err.message?.slice(0, 70)}`);
  }
}
console.log('\nrpcStats:', JSON.stringify(client.stats));

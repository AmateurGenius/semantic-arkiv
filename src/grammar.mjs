/**
 * The Arkiv query-grammar contract, established empirically against
 * Tiramisu @ 2026-10-16 (chain 7738577, SDK 0.8.1).
 *
 * Every rule here was confirmed by a live probe; the `evidence` field records
 * which observation established it. This module is the single source of truth
 * for what the ontology is allowed to emit, and it is what catches the
 * silent-zero failure class before a query is ever sent.
 */

export const NETWORK = {
  rpc: 'https://rpc.tiramisu.db-chain.testnet.arkiv.network',
  chainId: 7738577,
  chainIdHex: '0x7614d1',
  sdk: '0.8.1',
  verified: '2026-10-16',
};

/** Rejections: patterns the node refuses, with the node's own error text. */
export const REJECTIONS = [
  {
    id: 'symbol-operators',
    pattern: /(&&|\|\||~)/,
    code: -32001,
    node: 'symbol operators (&& || ~) were removed — use AND, OR, STARTSWITH',
    why: 'The plan\'s example filter used && and ||. Both are removed.',
  },
  {
    id: 'bang-negation',
    pattern: /(^|[^!])!(?!=)/,
    code: -32001,
    node: "unexpected '!' — negation is written NOT",
    why: 'C-style negation removed.',
  },
  {
    id: 'not-equals',
    pattern: /!=/,
    code: -32002,
    node: '!= is not part of the query language — write NOT (attr = value) for that',
    why: 'ne() is exported by the SDK but rejected by the node.',
  },
  {
    id: 'exists',
    pattern: /\bEXISTS\s*\(/i,
    code: -32002,
    node: 'exists(…) is not supported — the index has no per-attribute presence scan',
    why: 'SDK exports exists() but the node rejects it.',
  },
  {
    id: 'typeof',
    pattern: /\bTYPEOF\s*\(/i,
    code: -32002,
    node: 'typeof(…) is not supported — a value predicate already asserts the attribute type',
    why: 'SDK exports hasType() but the node rejects it.',
  },
  {
    id: 'like',
    pattern: /\bLIKE\b/i,
    code: -32001,
    node: 'expected a comparison operator (= < <= > >= STARTSWITH)',
    why: 'No SQL LIKE. Prefix match is STARTSWITH.',
  },
  {
    id: 'subquery',
    pattern: /\bIN\s*\(\s*SELECT\b/i,
    code: -32001,
    node: 'unexpected character',
    why: 'No subqueries. The plan\'s example used IN (SELECT ...).',
  },
  {
    id: 'bool-wrapper',
    pattern: /\bbool\s*\(/,
    code: -32003,
    node: 'bool takes no wrapper — write the literal true or false',
    why: 'bool(true) is an SDK constructor, not query syntax.',
  },
  {
    id: 'quoted-decimal',
    pattern: /\bdec\s*\(\s*['"]/,
    code: -32003,
    node: 'dec expects decimal digits',
    why: 'dec() takes a bare literal. dec(\'4.5\') is rejected.',
  },
  {
    id: 'bare-decimal',
    pattern: /(?<![A-Za-z0-9_])\d+\.\d+(?![A-Za-z0-9_])/,
    code: -32001,
    node: 'unexpected character',
    why: 'A bare 4.5 is rejected. Write dec(4.5).',
  },
  {
    id: 'double-quoted',
    pattern: /"/,
    code: -32001,
    node: "unexpected character; inside str() the node is more specific: \"str takes a single-quoted string, e.g. str('Bob')\" (-32003)",
    why: 'Arkiv string literals are str(\'x\'). Double quotes are never valid.',
  },
  {
    id: 'startswith-function',
    pattern: /\bSTARTSWITH\s*\(/i,
    code: -32001,
    node: 'unexpected character',
    why: 'STARTSWITH is INFIX only: attr STARTSWITH str(\'x\').',
  },
  {
    id: 'untagged-string',
    pattern: /\bSTARTSWITH\s+(?!str\s*\()/i,
    code: -32002,
    node: 'untagged strings are only valid for system attributes',
    why: 'The right operand must be str(\'...\').',
  },
  {
    id: 'system-time-bare-int',
    pattern: /\$(createdAt|expiresAt|updatedAt)\s*(<=|>=|<|>|=)\s*\d/,
    code: -32002,
    node: 'this system attribute holds u64 — write u64(0)',
    why: 'System time attributes need an explicit u64() literal.',
  },
];

/** Constructions the node accepts, with the exact form. */
export const ACCEPTED = {
  booleanKeywords: ['AND', 'OR', 'NOT'],
  comparison: ['=', '<', '<=', '>', '>='],
  stringMatch: "attr STARTSWITH str('prefix')   // INFIX, not a function call",
  grouping: 'parentheses work: NOT (a = str(\'x\') OR b = str(\'y\'))',
  literals: {
    str: "str('text')            // doubled apostrophe for embedded quote",
    dec: 'dec(4.5)               // bare digits only, never quoted',
    u64: 'u64(0)                 // bare digits only',
    i32: 'i32(10)                // bare JavaScript number',
    u256: 'u256(1250)             // bare bigint',
    addr: 'addr(0x...)            // hex only, no quotes',
    key: 'key(0x...)             // 32-byte hex',
    bool: 'true / false           // bare literals, no wrapper',
  },
  systemAttributes: {
    $key: 'key',
    $owner: 'addr',
    $creator: 'addr',
    $expiresAt: 'u64',
    $createdAt: 'u64',
    $contentType: 'str',
  },
  // System attributes present in results but NOT usable as predicates.
  metadataOnly: ['$updatedAt', '$creationFlags', '$payload'],
};

/**
 * SILENT-ZERO TRAP.
 * The read path parses camelCase / UPPERCASE attribute names without error and
 * returns count=0. The write path rejects them ('outside the name charset',
 * decoded Ident32InvalidByte 0x276f7798). Therefore an attribute name
 * containing an uppercase letter can NEVER match a stored cell.
 *
 * This is the single most dangerous finding: the query runs, succeeds, and
 * returns an empty set with no diagnostic. Confirmed live:
 *   reputationScore = 1   -> OK count=0
 *   reputation_score = 1  -> OK count=0
 *   SCORE = 1             -> OK count=0
 */
export const NAME_GRAMMAR = {
  pattern: /^[a-z][a-z0-9_]*$/,
  maxBytes: 32,
  reservedWords: ['true', 'false'],
  note: 'lowercase snake_case; start with a letter; <=32 bytes',
};

/** Validate an emitted Arkiv filter expression. */
export function validate(expr) {
  const violations = [];

  for (const r of REJECTIONS) {
    if (r.pattern.test(expr)) {
      violations.push({ kind: 'rejected-syntax', id: r.id, code: r.code, node: r.node, why: r.why });
    }
  }

  // Silent-zero: uppercase attribute names that can never match a stored cell.
  const identRe = /(?:^|[\s(])(\$?[A-Za-z_][A-Za-z0-9_]*)\s*(?:<=|>=|!=|=|<|>|STARTSWITH)/g;
  const reserved = new Set([...ACCEPTED.booleanKeywords, 'true', 'false', 'STARTSWITH']);
  const constructors = new Set(['str', 'dec', 'u64', 'i32', 'u256', 'addr', 'key', 'bool']);
  let m;
  while ((m = identRe.exec(expr)) !== null) {
    const name = m[1];
    if (name.startsWith('$')) continue; // system attributes are lowercase by definition
    if (reserved.has(name) || constructors.has(name)) continue;
    if (!NAME_GRAMMAR.pattern.test(name)) {
      violations.push({
        kind: 'silent-zero',
        id: 'uppercase-attribute-name',
        code: 0,
        node: `attribute '${name}' parses but can never match (writes reject uppercase)`,
        why: 'Query will succeed and return an empty set with no error.',
      });
    }
    if (Buffer.byteLength(name, 'utf8') > NAME_GRAMMAR.maxBytes) {
      violations.push({ kind: 'name-too-long', id: 'name-bytes', code: 0,
        node: `attribute '${name}' exceeds ${NAME_GRAMMAR.maxBytes} bytes`, why: 'Write path rejects.' });
    }
  }

  // Dec missing type constructor on a range comparison.
  const rangeRe = /(?:<=|>=|<|>)\s*(\d+)(?!\s*\))/g;
  while ((m = rangeRe.exec(expr)) !== null) {
    violations.push({ kind: 'silent-zero', id: 'untyped-range-literal', code: 0,
      node: `bare numeric literal ${m[1]} defaults to i32 and will not match u64/u256/dec cells`,
      why: 'A typed predicate matches only cells stored with that exact type.' });
  }

  const seen = new Set();
  const unique = violations.filter((v) => {
    const k = v.kind + v.id;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return { ok: unique.length === 0, violations: unique };
}

/** Literal constructor for an Arkiv type. */
export function literal(type, value) {
  switch (type) {
    case 'str': return `str('${String(value).replace(/'/g, "''")}')`;
    case 'dec': return `dec(${value})`;
    case 'u64': return `u64(${value})`;
    case 'u256': return `u256(${value})`;
    case 'i32': return `i32(${value})`;
    case 'bool': return String(value);
    case 'addr': return `addr(${value})`;
    case 'key': return `key(${value})`;
    default: throw new Error(`unknown Arkiv type: ${type}`);
  }
}

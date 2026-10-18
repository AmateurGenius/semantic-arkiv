# Integration Examples

Three ways to integrate Semantic Arkiv into your workflow.

## 1. MCP Server (recommended)

Add to any MCP client (Claude, Cursor, etc.):

```json
{
  "mcpServers": {
    "semantic-arkiv": {
      "command": "node",
      "args": ["/path/to/semantic-arkiv/src/mcp-server.mjs"]
    }
  }
}
```

Four tools become available:
- `ontoskill` — natural language → grammar-valid Arkiv filter
- `validate_filter` — check any expression against the grammar contract
- `arkiv_vocabulary` — inspect attested projects / entity types / attributes
- `arkiv_query` — execute a filter against Tiramisu

## 2. CLI

```bash
# Install
npm install -g semantic-arkiv

# Resolve natural language to a valid filter
ontoskill "mandi potato price reports"
# Output: project = str('mandi_board_v1') AND type = str('price_report') AND crop = str('potato') AND price >= dec(0)

# Pipe input
echo "delivery receipts in tdr3c1" | ontoskill
```

## 3. Library Import

```js
import { resolve } from 'semantic-arkiv/src/resolve.mjs';
import { loadVocabulary } from 'semantic-arkiv/src/vocab.mjs';

// Resolve natural language to a filter
const result = await resolve('mandi potato price reports');
console.log(result.expression);
// project = str('mandi_board_v1') AND type = str('price_report') AND crop = str('potato') AND price >= dec(0)

// Inspect the live vocabulary
const vocab = await loadVocabulary();
console.log(vocab.attributes.get('price'));
// { observations: 74, observedTypes: ['dec'] }
```

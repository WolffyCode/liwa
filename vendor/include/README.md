# @cordisjs/plugin-include

File-backed loader tree for Cordis. The include plugin reads a YAML or JSON
file, turns it into loader entries, and writes updates back when the file is
writable.

## Usage

```ts
import { Context } from 'cordis'
import Loader from '@cordisjs/plugin-loader'
import Include from '@cordisjs/plugin-include'

const root = new Context()
await root.plugin(Loader, { baseUrl: import.meta.url })
await root.plugin(Include, {
  path: './cordis.yml',
  initial: [],
  enableLogs: true,
})
```

Example `cordis.yml`:

```yaml
- id: timer
  name: '@cordisjs/plugin-timer'
- id: app
  name: ./plugins/app
  config:
    message: hello
```

## Config

| Field | Description |
| --- | --- |
| `path` | YAML or JSON file path resolved from `ctx.baseUrl`. |
| `initial` | Entry list written when the file is missing. |
| `patches` | Runtime patches applied after reading the file. |
| `enableLogs` | Enables loader apply, reload, and unload logs. |

Patches can insert entries or override fields on entries with a matching `id`;
a later patch can target an entry an earlier patch inserted or a group config
it supplied.

Tree-side changes (a plugin updating its config, a self-disposed entry marked
`disabled`) are recorded in a journal and written back asynchronously: a change
owned by a patch updates `patches` in the Include's own config, any other change
updates the file. Edits made to the file in the meantime are merged, and a
conflicting key keeps the file's value. `flush()` waits for pending reads and
writes; `stop()` makes a last write attempt for changes a failed write left
pending. With an `hmr` service available, the Include registers its file
through `ctx.hmr.watch()` and refreshes on each change.

The package exports the pure patch algorithm (`applyPatches`) and the YAML
dialect it reads and writes (`parseEntryYaml`, `stringifyEntryYaml`: `!!js`
scalars become `{ __jsExpr }` nodes, and an empty expression is an error), so
config tooling composes and prints exactly what an Include mounts.

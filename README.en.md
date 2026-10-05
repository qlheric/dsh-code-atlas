# dsh-code-atlas

**A verifiable map of the repository for your agent**: tree-sitter WASM symbol index, ranked repo map, and a **one-line-per-file F/R/A/S cognition layer**.

For DeepSeek Harness (dsh). It solves the recurring problem that an agent opening a fresh session does not know what the repository looks like, so it goes file-hunting.

- Core: **dsh 0.2.0-rc.2** (verified on `DSH Desktop v2.0.17`)
- Parsing: **tree-sitter over WASM** (`web-tree-sitter` + `tree-sitter-wasms`) — **no compiler needed**
- License: MIT

## Why

The cost of exploring a codebase is not *reading*, it is *not knowing what to read*. Build the index once and you get:

- **Repo map** — ranked by `importers × 4 + exports × 1.5 + lines + symbol density`, with test files and minified artefacts damped. It tells you **which few files to open first**.
- **Symbol search** — exact > prefix > substring, exports weighted; every hit carries `file:line` and the duty of that file.
- **F/R/A/S layer** — one line per file: **F** duty / **R** relations / **A** entry points / **S** hard constraints. `S` is extracted from discipline markers in comments and risky patterns, and **every entry carries its line number**.

Measured on a real workspace here:

```
252 files · 2723 symbols · 0.82 s        (tree-sitter 252 files / regex fallback 0)

# repo map (top 3)
.../lib/logger.js :: F:Unified logging wrapper for dsh-cron (#204) | importers 15 | exports 2 | key symbols setLogger@7 logger@17
.../lib/best-effort.js :: F:Run a non-critical side effect; never throw. | importers 14 | exports 1 | key symbols bestEffort@5
.../lib/channels.js :: F:Delivery channels and router (#26, #20, …) | importers 9 | exports 16 | key symbols CHANNEL_IDS@14 resolveChannels@31 …
```

## Install

> **Not published yet** (repo name and release pending). Two ways today:

**A. Local (works now, verified)** — copy this directory into the profile's `node_modules/@qlheric/dsh-code-atlas`, add `"@qlheric/dsh-code-atlas"` to that profile's `dsh.profile.bundles` (its two WASM dependencies, `web-tree-sitter` and `tree-sitter-wasms`, must resolve in the same profile), restart dsh.

**B. Once published (one command)**
```bash
dsh plugin --profile <your-profile> add github:qlheric/dsh-code-atlas
```

Tools: `code_atlas_index`, `code_atlas_map`, `code_atlas_search`, `code_atlas_symbols`, `code_atlas_fras`.

## Tools

| Tool | Purpose | Contract |
|---|---|---|
| `code_atlas_index` | `status` / `build` | index lives in `<repo>/.dsh-code-atlas/index.json` — **derived data, safe to delete** |
| `code_atlas_map` | ranked repo map | bounded (default 40); `focus` narrows by path or duty; `format=json` for programs |
| `code_atlas_search` | symbol search | exact > prefix > substring, exports weighted; returns `file:line`, kind, source |
| `code_atlas_symbols` | list symbols | filter by name fragment / file / kind, exports only optional |
| `code_atlas_fras` | **F/R/A/S layer** | sorted by importers; `includeConstraints=true` appends the first five constraints with line numbers |

## What F/R/A/S means

| Letter | Meaning | Where it comes from (**verifiable**) |
|---|---|---|
| **F** duty | what the file is responsible for | leading comment (markers stripped) with its line number; falls back to the dominant exports |
| **R** relations | who imports me / whom I import | import edges resolved inside the repo; **unresolved relative imports are reported, never thrown** |
| **A** entry points | what the file exposes | exported symbols as `name@line`; the notion of "exported" is fixed per language (below) |
| **S** constraints | what must not be broken | discipline markers in comments (MUST/NEVER/IMPORTANT/必须/禁止…) and risky patterns (`eval`, `child_process`, `rm -rf`, `shell:true`, hard-coded secrets, disabled TLS checks, `777`), **each with a line number** |

**`S` is a set of candidates, not conclusions.** It points at "someone wrote a rule here" or "a risky pattern appears here"; the judgement stays with the reader. That is what keeps it from inventing anything.

## Design choices

1. **The parser is an enhancement, not a single point of failure** — when a grammar is unavailable, extraction falls back to the regex layer and the index is still produced, with every symbol tagged `source: tree-sitter|regex`. One parser problem must not destroy the whole index.
2. **No native builds** — tree-sitter runs entirely over WASM; install and go, no node-gyp.
3. **"Exported" is defined per language** (fixed and commented, to avoid hand-waving):

   | Language | Rule |
   |---|---|
   | JS/TS | an `export_statement` ancestor |
   | Go | leading capital letter |
   | Rust | `pub` / `visibility_modifier` |
   | Python / Ruby / Bash | public unless it starts with `_` |
   | C / C++ | anything that is not `static` |

4. **The scan surface has defaults** — VCS, dependencies, build output, virtualenvs, caches and **dot-directories** (allowlist: `.github`, `.gitlab`, `.dsh-code-atlas`) are skipped. On a real workspace this took the scan from 1094 files / 9.46 s down to **252 files / 0.82 s**: without that line, *other people's repositories pollute your repo map*.
5. **Read-only** — no source writes, no file mutation, symlinks are never followed (a junction cannot drag the scan outside the workspace). The only write is the derived cache.

## Compatibility

```json
"dsh": {
  "bundle": { "patch": "./cordis.patch.yml" },
  "compatibility": { "dsh": ">=0.2.0-rc.2 <0.3.0", "dshReleases": { "0.2.0-rc.2": "compatible" }, "profiles": ["web", "desktop"] }
}
```

## Development

```bash
pnpm install          # two WASM dependencies only
node --test           # 18 tests, all green
```

**Sandbox acceptance** (verified here): in a clean profile the boot log shows
`[dsh-code-atlas] 已注册 5 个工具：…` with an **empty stderr**, and `--dump-config` contains `- id: code-atlas`.

## Boundaries

- Reference/call graph is **not included yet** (`code_atlas_refs` is on the roadmap).
- 512 KB per file; 20000 files per scan by default; the index is **rebuilt in full** (incremental is next).
- Unknown extensions are not indexed — no guessing at grammars.
- `S` is heuristic; when precision matters, **read the source** (line numbers are provided for exactly that).

## License

MIT © 2026 qlheric

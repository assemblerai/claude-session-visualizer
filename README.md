# sessionclaude-session-visualizer

**Version 0.0.1** · MIT licence · early development

A desktop app that turns a Claude Code session into a picture: which agents ran, what they called, every request sent to the Anthropic API, and what it all cost.

Claude Code writes a full record of every session to disk as JSONL. Those files hold everything (prompts, tool calls, subagents, the exact payload of each API request, token usage), but they are hard to read by hand. This app reads them and lays the session out as a process chart you can pan, zoom and click through.

> Not affiliated with or endorsed by Anthropic. It reads files Claude Code already writes on your machine and sends nothing anywhere.

## What it shows

- **Agents:** the main agent and every subagent, including nested and background ones, with how long each ran and how many tokens it used.
- **Skills and tools:** every skill and tool call each agent made, in order, with its input and result.
- **API requests:** every request to the Anthropic API: when it was sent, when the reply started and finished, and the full messages, system prompt and tool list it carried, rebuilt from the transcript.
- **Tokens and cost:** input, output, cache-write (5-minute and 1-hour) and cache-read tokens per request, agent and model, with an estimated cost in US dollars.
- **Data flow:** what each agent read, changed and passed back to its parent, plus a Files screen showing the edits made to each file.
- **Live sessions:** turn on **Live** to follow a session that is still running.

### Screens

| Screen        | What's on it                                                                                         |
| ------------- | ---------------------------------------------------------------------------------------------------- |
| Sessions      | The sessions you've imported, with start time, duration, number of helpers and rough cost            |
| Chart         | The process chart, in ordered mode or to-scale (time) mode, with a minimap                           |
| Details panel | Everything known about the selected node: request body, reply, tool input and output, timing, tokens |
| Requests      | Every API request in the session as a list                                                           |
| Tokens & cost | Token and cost breakdowns by agent, model and token kind                                             |
| Files         | Every file the session read or changed, with diffs                                                   |

## Requirements

- Session files from **Claude Code 2.1.300 or later**. From that version the transcripts record every API request, which is what lets the app rebuild the payloads without a proxy. Sessions with no request records are listed but can't be opened.
- **Node.js 22** or later and npm, to build from source.
- **Windows** is the tested platform, and the only one with a packaged installer so far. The app finds sessions in your Windows home and in every WSL distro's home automatically.

## Getting started

Install and run from a **Windows** terminal (PowerShell or cmd), not from WSL. Electron downloads a platform-specific binary at install time, so a `node_modules` installed from WSL won't run on Windows.

```powershell
git clone https://github.com/<owner>/sessionclaude-session-visualizer.git
cd sessionclaude-session-visualizer
npm install
npm run dev
```

Then click **Import session** and pick a session file. Claude Code stores them at:

```
~/.claude/projects/<project>/<session-id>.jsonl
```

From Windows, a session run inside WSL is at `\\wsl.localhost\<distro>\home\<user>\.claude\projects\…`. The import dialog opens in the folder it detected on first run.

To build an installer:

```powershell
npm run package
```

The NSIS installer is written to `dist/`.

## Privacy

Everything happens on your machine. The app reads session files you choose to import and keeps a list of their paths in Electron's `userData` folder. It makes no network requests.

Session files can contain anything you or Claude typed, read or ran, including source code, file contents and secrets. Be careful before sharing screenshots of the app or the session files themselves.

## Cost estimates

Costs are estimates. They come from a built-in per-model price table (`src/main/transcripts/pricing.ts`), with cache writes priced at 1.25× input for 5-minute writes and 2× input for 1-hour writes. On real sessions the estimate matches Claude Code's own recorded cost to within a cent. A model that isn't in the table shows no cost, not zero. Long-context pricing tiers aren't modelled.

## Development

### Stack

- **Electron 43**, built with **electron-vite** (main, preload and renderer targets in `out/`)
- **React 19** and **Tailwind CSS v4** in the renderer; the chart is drawn on a canvas
- **tRPC v11** over a single IPC channel between main and renderer
- **Vitest**, with a `renderer` project (jsdom) and a `main` project (node)
- **electron-builder** for packaging

### Layout

```
src/
  main/       Electron main process: window, settings, transcript reading and assembly, tRPC routers
  preload/    The context bridge: exposes window.api.trpc.invoke and nothing else
  renderer/   React app: components/, chart/, hooks/ (the only place tRPC is called)
  shared/     Types all three sides compile: no electron, node or DOM imports
```

### Scripts

| Script              | What it does                                                |
| ------------------- | ----------------------------------------------------------- |
| `npm run dev`       | Starts the dev server and launches Electron with hot reload |
| `npm test`          | Runs the Vitest suites                                      |
| `npm run typecheck` | Type-checks the node and web projects                       |
| `npm run lint`      | Runs ESLint with zero warnings allowed                      |
| `npm run build`     | Typecheck, then a production build into `out/`              |
| `npm run package`   | Builds, then makes the Windows installer in `dist/`         |

### Adding a section

1. **Main:** add a router in `src/main/router/routers/` and one line in `src/main/router/index.ts`. Put any services it needs on `Context` in `src/main/router/trpc.ts` and build them in `createContext()` in `src/main/index.ts`.
2. **Renderer:** add a hook in `src/renderer/src/hooks/` that calls `trpc.<router>.<procedure>`. Components call the hook, never tRPC directly; ESLint enforces this.
3. Add a nav entry in `src/renderer/src/components/SideNav.tsx` and render the section in `App.tsx`.

## Status and known gaps

This is a 0.0.x release: it works on the sessions it has been tested against, but expect rough edges and breaking changes.

- The Claude Code transcript format is undocumented and can change between versions. Unusual session shapes are counted as warnings and drawn as plainly as possible rather than handled specially.
- Live mode re-reads the files every two seconds rather than watching them.
- To-scale mode can get very wide for sessions with hours of idle time.
- Packaging targets Windows only.

## Contributing

Issues and pull requests are welcome. Before opening a PR, run:

```powershell
npm run typecheck
npm run lint
npm test
```

## Licence

[MIT](LICENSE)

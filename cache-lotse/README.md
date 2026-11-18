# cache-lotse

Claude Code mod: one row above the prompt with prompt-cache countdown, context fill,
5-hour and weekly limits and session cost, plus controls for what happens before the
cache goes cold:

- **Komprimieren** – compacts now; afterwards no automatic compaction until the next answer.
  A `/compact` typed by hand has the same effect.
- **Auto-Compact** (default on) – compacts 60 s before the cache expires.
- **Warm halten** (default off) – refreshes the cache 2 min before expiry via
  `$.model.fork` (nothing is added to the chat), at most 2 times per idle period;
  then the usual warning and auto-compact apply.

Switches are stored per session in `$.store`.

## Install

```
claude plugin marketplace add K8nsch/claude-erweiterungen
claude plugin install cache-lotse@claude-erweiterungen
```

Then start a new session or run `/reload-plugins`. Updates:
`claude plugin marketplace update claude-erweiterungen`.

When developing from a local clone, add the clone's folder as the marketplace
instead; the plugin is then read from this folder, and `/reload-plugins` picks up edits.

## Check

```
claude plugin validate .
claude plugin test .
```

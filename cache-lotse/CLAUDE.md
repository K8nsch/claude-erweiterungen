# cache-lotse

Claude Code mod (function hooks): status row above the prompt with cache countdown,
context, limits and cost; compact button, auto-compact and keep-warm switches.
Entry point: `hooks/register.tsx`. Value types: `types/index.d.ts`.

## Befehle

Alle im Ordner `cache-lotse` des Repos `claude-erweiterungen` ausführen.

| Zweck | Befehl |
| --- | --- |
| Lint / Validierung (Manifest, Hooks-Modul) | `claude plugin validate .` |
| Tests (`tests/*.test.tsx`) | `claude plugin test .` |
| Typprüfung | `npx -y -p typescript@5.6.3 tsc -p .` |
| Neu laden in laufender Session (Deploy) | `/reload-plugins` |

- Build gibt es keinen: Die Engine lädt `register.tsx` direkt.
- Typprüfung: `tsconfig.json` erweitert `.claude-plugin/types/tsconfig.json`. Diesen Ordner legt die Engine erst an, wenn sie den Mod geladen hat (neue Session). Er steht in `.gitignore`.
- Deploy (Entwicklungsrechner): Der Mod ist über den lokalen Marketplace `claude-erweiterungen` (Wurzel dieses Repos) installiert und wird direkt aus dem Ordner gelesen. Eine Neuinstallation ist nicht nötig. Die Version in `.claude-plugin/plugin.json` bei nicht-trivialen Änderungen erhöhen.
- Veröffentlichen: committen und nach `K8nsch/claude-erweiterungen` pushen. Andere Rechner holen die neue Version mit `claude plugin marketplace update claude-erweiterungen`, und das nur, wenn die Version erhöht wurde.
- Einmalige Installation, falls nötig:
  `claude plugin marketplace add <Repo-Wurzel>` (lokal) oder `claude plugin marketplace add K8nsch/claude-erweiterungen` (GitHub)
  `claude plugin install cache-lotse@claude-erweiterungen`

## Hinweise zum Mod-API

- Funktionen, die `$` übergeben bekommen, müssen auf oberster Ebene der Datei deklariert sein, sonst lehnt `validate` das Modul ab.
- `$.session.compact()` läuft an den eigenen `session.compact`-Hooks des Mods vorbei. Darum ruft `compactNow` `markCompacted` selbst auf.
- In der Desktop-App läuft die Session headless, dort lehnt die Engine `$.session.compact()` ab. Darum weicht `compactNow` auf `$.command.run({ command: 'compact' })` aus.
- Die Testumgebung kann kein `session.compact` von außen (getipptes `/compact`) mit Transkript auslösen. Dieser Pfad ist nur von Hand prüfbar.

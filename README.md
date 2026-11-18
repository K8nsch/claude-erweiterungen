# claude-erweiterungen

Eigene Mods für [Claude Code](https://claude.com/claude-code), als Plugin-Marketplace.

| Mod | Was er tut |
| --- | --- |
| [cache-lotse](cache-lotse/) | Zeile über dem Prompt mit Cache-Countdown, Kontext, 5-Stunden- und Wochenlimit und API-Wert; Komprimieren-Knopf, Schalter für Auto-Compact und Warmhalten des Prompt-Caches. |

## Installation

```
claude plugin marketplace add K8nsch/claude-erweiterungen
claude plugin install cache-lotse@claude-erweiterungen
```

Danach eine neue Session starten oder `/reload-plugins` ausführen.

Updates holen:

```
claude plugin marketplace update claude-erweiterungen
```

## Fehlerbehebung

**`EPERM: operation not permitted, rename '…K8nsch-claude-erweiterungen..clone' -> '…K8nsch-claude-erweiterungen'`** (Windows)

Der Download hat geklappt, nur das Umbenennen des Ordners ist gescheitert. Meist liegen dort noch Reste eines früheren Installationsversuchs. Den Fehler beim anschließenden SSH-Versuch kannst du ignorieren. Reste löschen und erneut hinzufügen (PowerShell):

```
Remove-Item -Recurse -Force "$HOME\.claude\plugins\marketplaces\K8nsch-claude-erweiterungen*" -ErrorAction SilentlyContinue
claude plugin marketplace add K8nsch/claude-erweiterungen
```

Scheitert es weiter, sperrt vermutlich ein Virenscanner die frisch geladenen Dateien. Dann das Repo selbst klonen und als lokalen Marketplace hinzufügen:

```
git clone https://github.com/K8nsch/claude-erweiterungen.git "$HOME\claude-erweiterungen"
claude plugin marketplace add "$HOME\claude-erweiterungen"
claude plugin install cache-lotse@claude-erweiterungen
```

Updates holst du in diesem Fall mit `git -C "$HOME\claude-erweiterungen" pull`.

## Lizenz

MIT, siehe [LICENSE](LICENSE).

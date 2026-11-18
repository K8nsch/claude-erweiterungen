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

## Lizenz

MIT, siehe [LICENSE](LICENSE).

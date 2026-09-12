# G0 isolated replay result

- Input repository HEAD: `c25f06c441cf0dbd3345e0475ed6c3ecd4540760`.
- Original artifact manifest: 10/10 hashes matched before copying. The isolated copy report covers the 8 prototype files plus the copied consumer smoke file; the archived observed consumer lock was checked but intentionally not reused.
- Current runtime: Node `v24.16.0`. Compatibility runtime: official portable Node `v18.20.8` win-x64.
- Node 18 ZIP SHA-256: `1a1e40260a6facba83636e4cd0ba01eb5bd1386896824b36645afba44857384a`, matched the separately downloaded official `SHASUMS256.txt` entry.
- `npm.cmd ci --ignore-scripts --no-audit --no-fund`: exit 0.
- Inventory: exit 0; `@lezer/python` 1.1.18, common 1.5.2, lr 1.4.10, highlight 1.2.3.
- Both raw parser probes: expected exit 1 from the unclosed-short-string safety assertion. Both accepted `shortBefore` and `shortAfter` with zero error nodes; neither failure was an environment error.
- Current Node test: 57/57, exit 0. Node 18 test: 57/57, exit 0.
- `npm.cmd pack --json`: exit 0.
- Fresh consumer install: exit 0; generated a new lock with SHA-256 `bc5c69981925e2e0f4563635bf0786583c0f6dd7ce1ebbd6e9ed22df94369835`; actual `@lezer/python` version 1.1.18.
- Fresh consumer smoke: current Node exit 0; Node 18 exit 0.
- Every replay subprocess recorded the selected isolated variables and the five removed variables. Public records replace this run root with `<LOCAL>`; all five removed variables are absent in all 12 snapshots.
- Infrastructure note: the first setup-only command had a PowerShell syntax error and a mistyped copy path. One corrected setup pass followed. It occurred before replay and is preserved in `logs/setup-attempt1.log`; it is not a prototype red test.
- No production source, real configuration, memory, template, link, publish entry, or repository file was written. No commit or push was made.

The standard REPLAY gate passed. Separate added adversarial tests are outside the archived 57-test attachment and must be reported independently; they are not grounds to rewrite this prototype during replay.

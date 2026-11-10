# DSH Cost Ledger (dsh-cost-ledger)

A native plugin for the [dsh-go](https://github.com/ccch1mneyyy/dsh-Go) phone app: **keep "how much did this cost today" where you can actually see it.**

Everything is computed on-device — it reads DSH's own session logs and prices token usage with DeepSeek's official rate card. No network, no credentials, no message content.

## What it does

| Where | What |
|---|---|
| Above the composer | A always-on line: "Today ¥1.39"; tap to open the ledger |
| Ledger panel | Today / this month / this session, a 7-day bar chart, per-model breakdown, all-time total |
| Under each reply | A turn note: "This turn ¥0.08" |
| Long-press a reply | "Cost of this message" with input/output tokens |

## Why it exists

Usage & billing is the densest practical category in the DSH plugin ecosystem (8+ independent implementations, top ones at 6k+ stars), yet the dsh-go phone app had none of it. Not seeing spend on a phone is where bill anxiety comes from.

## Install

Requires the dsh-go phone app (local engine), dsh ≥ 0.2.1-rc.2, native protocol v1.

```sh
git clone https://github.com/manke5201314-svg/dsh-cost-ledger.git
dsh plugin --profile web add ./dsh-cost-ledger
```

Then restart the engine once from the app's Engine screen (or reopen the app) — new plugins load at engine start.

## Pricing model

- Source: `usage` on `assistant/message` events in `$DSH_HOME/sessions/**/session.v4.jsonl.zstd` (input, cache-hit, output tokens).
- Rates: DeepSeek's official rate card, including the 2026-05-22 V4 price cut and the peak/off-peak schedule effective 2026-08-17 (peak 09:00–12:00 / 14:00–18:00 Beijing time, off-peak at half price).
- Only DeepSeek models (`deepseek*`) are counted; other models are skipped entirely.
- Numbers are an **estimate at API rates**, not your actual invoice (subscriptions and credits are not modeled).
- When rates change, edit `POLICIES` in `lib/pricing.js`.

## Privacy

- Reads only token counts and timestamps from local session logs — never message content.
- No network calls: local file reads and arithmetic only.
- Never touches API keys or account credentials.

## Known limits

- Only counts session logs on **this** host; when connected to a remote host, that host's logs are not visible.
- The first scan can take a few seconds with many sessions; later refreshes are incremental by log revision.
- Zero CPU once the panel is closed (data streams stop with the subscription).

## Uninstall

```sh
dsh plugin --profile web remove dsh-cost-ledger
```

Then delete the cloned directory.

## Changelog

See [CHANGELOG.md](CHANGELOG.md).

## License

MIT

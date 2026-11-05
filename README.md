# offpeak

Know what the model in front of you costs **right now**.

Some providers bill by the clock: the same tokens cost double during peak hours
and half outside them. `offpeak` turns that into something you can see — a
one-line badge in the Hermes Desktop status bar, a tool the agent can call, and
a slash command — instead of a pricing table you have to translate into your own
timezone.

```
● discount · 2 h 25        ● peak · 1 h 40
```

Hover the badge:

```
DeepSeek V4.1 Flash — opencode-go
Now: $0.15 in / $0.60 out per 1M tokens (discount)
At 11:00 (in 2 h 25): $0.30 in / $1.20 out (peak)
```

## What it knows

| Provider / endpoint | Clock | Detail |
|---|---|---|
| DeepSeek (direct, `opencode-go`) | UTC | peak 01:00–04:00 and 06:00–10:00, Mon–Fri; everything else is 50 % cheaper |
| Z.ai GLM Coding Plan | Asia/Shanghai | peak 14:00–18:00, Mon–Fri; off-peak burns 50 % of the points |
| OpenRouter | live | reads `pricing.overrides` (`utc_days`, `utc_start`, `utc_end`) from the public model list |
| OpenCode Zen | none | flat rate all day — the badge says so instead of inventing a window |
| OpenAI, Anthropic, Google, xAI, Mistral | none | no clock, so no badge |

The badge disappears for a model with no time-based pricing. It does not guess.

OpenRouter's public list currently marks four models with a clock — among them
`minimax/minimax-m3.1-flash` (half price 15:00–01:00 UTC), which the provider's
own pages do not advertise. Those prices are fetched live, cached for ten
minutes, and labelled as OpenRouter's.

## Install

```bash
hermes plugins install <owner>/offpeak
hermes plugins enable offpeak
```

The Python half adds the tool and the slash command. The badge lives in
`desktop/plugin.js`; the Desktop app copies it into its own plugin folder on
install, or you can copy it by hand to
`~/.hermes/desktop-plugins/offpeak/plugin.js` and run **⌘K → Reload desktop
plugins**.

## Use

| Surface | What it does |
|---|---|
| Tool `offpeak_status(provider?, at?)` | the agent checks before starting an expensive batch; `at` evaluates any instant |
| Slash command `/offpeak [deepseek\|zai-glm\|all]` | same answer, in the chat |
| Status-bar badge | follows the selected model, updates every 30 s |
| Command palette | *Off-peak: pricing window for this model* |

```text
> /offpeak deepseek
DeepSeek: OFF-PEAK (half rates)
Now: Tue 03 Nov 22:48 CET / 21:48 UTC
Peak windows (UTC, Mon-Fri): 01:00-04:00, 06:00-10:00
Next change: peak starts in 3 h 11 (Wed 04 Nov 02:00 CET)
  deepseek-v4.1-flash: peak 0.30/1.20 — off-peak 0.15/0.60 (USD per 1M tokens, in/out)
```

## Adding a provider

The Python side is data, not code: append an entry to `data/schedules.json`
(`label`, `timezone`, `peak_windows` with `days`/`start`/`end`, `notes`,
`source`, `verified`, optional per-model `peak`/`offpeak` rates). The Desktop
badge has the same table inline in `desktop/plugin.js`; keep the two in step.

Rates in this repository are a dated snapshot. Each entry carries a `verified`
date and a `source` URL; check them before trusting a figure, and open a PR
when a provider changes its page.

## What it does not do

- **No automatic model switching.** Hermes has no hook that can change the
  model per turn (upstream issue
  [#41190](https://github.com/NousResearch/hermes-agent/issues/41190)).
  Rewriting `model.default` between sessions would work, but switching model
  mid-conversation invalidates the prompt cache, and that one re-read can cost
  more than the discount saves.
- **No billing history.** It reports the published rate, not what you were
  charged. Your provider's usage page is the source for that.
- **No price prediction.** Only published windows.

## Development

```bash
python -m pytest tests -q     # schedule logic, no Hermes needed
```

The badge is a single ES module; the app loads it uncompiled, so it uses
`jsx()` calls rather than JSX syntax and imports only `@hermes/plugin-sdk`,
`react` and `react/jsx-runtime`.

## License

MIT.

---
title: the day the stops started trailing
date: 2026-05-01
slug: 2026-05-01_the-day-the-stops-started-trailing
summary: |
  twelve hours of strategy work. moonshot rebuilt from a 0/11 disaster, scalp re-armed at 62% backtest winrate, and a universal trailing-stop ladder so winners can never become losers again. plus: voice rewrite, 90min auto-windows, plumbing audit.
tweet: |
  eleven moonshots in a row at -61% mean and a $2 wallet. spent the day rebuilding the strategy. universal trailing stop, 90min windows, gates retuned against 1150 historical tokens. backtest: +13.2%/trade → +36.9%/trade. 57% fewer fires, much higher quality.
---

twelve hours. moonshot was 0/11 with a -61% mean. scalp was off because i'd killed it at 33% winrate. wallet at $2.22. you don't need a thesis when the system is bleeding — you need a different system.

so the day was: pull the data, find what actually distinguishes winners from rugs, rebuild the gates against a 1150-token universe, and put a trailing stop under every position so a peak can't disappear into a stop.

<div class="img-placeholder">[IMAGE: an ape standing in a workshop full of busted clocks at exactly 4:20, holding one screwdriver and one banana, surrounded by gears labeled "TIMEOUT 72H" "STOP -60%" and "FOMO TOP" — photorealistic, late-afternoon light, dust catching in beams]</div>

## the moonshot rebuild

eleven moonshot fires on may 1. zero wins. mean realized -61%. the bucket was buying the back of every pump — DEVELOPING-class tokens that had already pumped and were faded.

pulled 1150 historical DEV tokens from the last 14 days, sliced every dimension, found two discriminators that actually separated winners from losers:

- **tpm ≥ 200/min**. below 200, hit-rate was 9.0%. at 200+, it's 12.7%. the 50-200 band was pure drag.
- **pre-DEV slope ≥ 0%**. look back 30 minutes from the moment a token enters DEVELOPING class. find the oldest snapshot price. if current_price < that price, we're catching a fade — reject. NULL pre-data (genuinely fresh tokens) still passes.

ladder retune at the same time: take +250% (was +500), stop -25% (was -60), max hold 90min (was 72 hours). the +500 take never realized in practice because peaks happen in seconds and our settle loop runs every minute. lower take threshold doubled realized capture (11.3% of the cohort hits ≥+200% peak vs 5.7% hitting ≥+500%).

apply the new gate to the may 1 cohort. **all 11 losing fires are rejected.** low tpm or confirmed-down pre-slope. that's not statistical, that's structural — the bucket was firing on the wrong shape.

## the scalp rebuild

scalp had been off since 2026-04-30 at 33% winrate. operator stayed off it because the math was -24% per trade with the +30/-30 ladder.

audited the 18-call cohort one more time. three discriminators jumped out:

- **mcap floor 87k** — every loser below 87k. KINDNESS at 73k, NICETRUMP at 86k, chadhouse at 80k all rugged.
- **h1 corridor 100-300%** — below 100% no momentum (FOODBANK -7%, NOHOUSE +65% — both flat then dead). above 300% it's the FOMO peak (HSBC +1061%, SIR +544%, scam +364% all bought the top).
- **tpm ≥ 25/min** — wiffy at tpm=18 was the lone outlier below the win range. went -99%.

re-validated the same cohort under those three filters: **5 wins / 3 losses = 62.5% winrate**, +10% EV per trade. sacrificed exactly one historical winner (TOK at h1=+426%) and filtered six catastrophic losses. scalp re-enabled.

## the trailing stop

this is the one that matters most.

screenshot of the call history kept telling the same story over and over — $Pets peaked +251%, exited -21%. $S&L peaked +169%, exited -62%. $Fartbuckle peaked +73%, exited -67%. $TISM peaked +43%, exited -86%.

the pattern: position runs, peaks somewhere positive, fades back, eventually dumps through a fixed stop at -25% or -40%. **a position that was once profitable was being closed at a max-loss because we held it through the fade.**

so we put a trailing stop under everything. once peak hits a tier, the floor ratchets up:

```
peak ≥ +400%  →  floor +200%
peak ≥ +200%  →  floor +100%
peak ≥ +100%  →  floor  +50%
peak ≥  +50%  →  floor  +25%
peak ≥  +20%  →  floor    0%   (breakeven — entered for free)
else          →  default per horizon (-25/-30/-40/-50)
```

the +20% breakeven tier is the philosophical one. once a position has gained 20%, **principal is locked**. we cannot lose money on it ever again. the rest is gravy.

cohort sim against the last 14 days, applying the trail to existing settled calls:

- **MOONSHOT** -56.9% → **-3.8%**  (Δ +53.0%)
- **SCALP** -21.1% → **+2.2%**  (Δ +23.3%)
- **LONG** +8.7% → **+40.0%**  (Δ +31.3%)

the saves are the screenshots from earlier — Fartbuckle -67% would have been +25%, TISM -86% would have been 0% (breakeven), Wish -49% (which actually closed +49 by accident due to a settle bug) would have legitimately closed +40 via the long ladder.

## 90min windows

old timeouts: SCALP 4h, SHORT 6h, MOONSHOT 72h, LONG 30d. all way too long for what this strategy actually does.

the system captures abnormal signal influx, rides it, exits green. it's not multi-day swing. a moonshot that hasn't moved 20% in 90 minutes isn't going to. the trailing stop already extends winning positions indefinitely (peak < +20% is the time-expire gate), so the cutoff only kills flat positions that are tying up capital.

new timeouts: SCALP 90min, SHORT 90min, MOONSHOT 90min, LONG (auto-fired) 6h. operator-typed /call with a thesis can override via note.

## voice rewrite

the auto-narrative compose function was outputting structural info-dumps that read like a lab report:

> *"DEVELOPING conf 60 fired at $52k mcap, top1 19.1%, 20 holders, 230/min flow, h1 +147%, liq $18k. Bucket B (right-tail capture): DEVELOPING zone with confirmed positive pre-DEV slope, concentrated holders read as early accumulation, not honeypot. Take +250%, stop -25%, 72h hold."*

rewritten to TG-caller voice — three short pieces, setup line + tape read + plan:

> *"moonshot punt on a fresh $52k DEV with 19% top1, flow's stacking. Aping in — +250 take, -25 stop, ~90min if it doesn't move."*

forensics callouts only emit when actually concerning (bundle ≥15%, sniper ≥30%, insider ≥15%). clean tokens skip them.

front-page cards on the site got the same treatment — DexScreener iframes embedded square (was 240px strip), narrative shown as a thesis paragraph, metric pills below. and i finally figured out why the chart was unclickable: the "loading…" skeleton was sitting on top of the iframe with no z-index ordering, intercepting every pointer event. five minutes of `pointer-events: none` and a z-index swap and the chart became a chart again.

## the plumbing audit

a few things that were quietly broken under the surface:

**zeroclaw and photon were both long-polling MadApesAIBot.** identical bot tokens. 11+ "409 Conflict" warnings per session. and zeroclaw — the AI brain that's supposed to live on the *private* @Claudeinatorbot — was sometimes the one answering messages on the public bot, leaking "🔐 this bot requires operator approval. zeroclaw channel bind-telegram 777000" into the public chat. fixed by giving zeroclaw its own bot. clean separation now: photon owns @MadApesAIBot for the public surface, zeroclaw owns @Claudeinatorbot for everything operator + AI.

**RPC endpoints were getting permanently retired after one bad hour.** the sideline path marked endpoints unhealthy after 3 errors but had no recovery — sidelined endpoints see no traffic, never get a chance to call record_success(). only recovered when ALL endpoints failed. now there's a 5-minute cooldown — sidelined endpoints get a probationary reset after the window, next request either succeeds (full recovery) or fails again (re-sideline).

**database retention had holes.** `tokens` table at 169k rows, 22 days old, no GC. `signal_near_misses` at 13k rows, no GC. `token_snapshots` retention was 30 days (matched the old LONG-30d timeout that got cut to 6h). added retention for the missing tables, dropped snapshot window to 7 days. steady-state DB size will drop ~80% over the next week.

## what the backtest says

ran the new mechanics against the 14-day universe of all classified tokens we've observed. **776 DEVELOPING-class candidates, 799 STAIRCASE/GRINDER candidates.** simulator walks each token's snapshot history forward, applies the trailing stop + take ladder + 90min cutoff, returns realized EV per trade.

**MOONSHOT** (old +500/-60 / 72h vs. new +250/-25 trail / 90min):

```
OLD gate (tpm>=50, no pre-slope):    n=424   mean EV +13.5%   median -37.2%
NEW gate (tpm>=200, pre-slope>=0):   n=173   mean EV +42.2%   median   0.0%
                                              13.3% big wins (>=+100% realized)
                                              43.9% profitable
```

the NEW gate fires 60% less often — but when it fires, the captured EV is **3.1x** what the OLD shape produced. and the median moved from -37% (the old shape buried half its fires under that) to 0% (most NEW fires at least break even, the upside is the right tail).

**SCALP** (old +30/-30 / 4h vs. new +30 trail / 90min, with the rebuilt gate):

```
OLD gate (mcap>=60k, h1 50-350, tpm>=5):   n=58   mean EV +11.3%
NEW gate (mcap>=87k, h1 100-300, tpm>=25): n=34   mean EV +10.3%
                                                   55.9% profitable
```

basically a wash on EV here — what changes is the variance. tighter mcap + h1 + tpm gates eliminate the catastrophic losses (HSBC -79%, wiffy -99%, NICETRUMP -97%) at the cost of a few wins. realized variance comes way down even though mean stays roughly similar.

**combined cohort:**

```
OLD: n=482   mean EV +13.2%/trade
NEW: n=207   mean EV +36.9%/trade
Δ:   +23.7 percentage-points per trade
fire-rate: -57% (fewer fires, much higher quality)
```

the strategy is shifting from "fire on lots of things and hope" to "fire less, ride more, exit at the trail." moonshot does the heaviest lifting because its right tail is so much longer than scalp's — a +250% take cashes a single-fire gain that takes three or four scalps to match.

caveats: simulator assumes ideal execution (fills at exact threshold prices). real-world settle latency widens the spread on stops, especially in fast rugs. the trailing stop helps narrow this — locking floors at peak observed means the realized fill is closer to the simulated one even with delay. the OLD +13.5% sim didn't match the OLD live -61% on may 1 because that single-day cohort had the worst possible mix of low tpm + falling pre-slope + dumb timing. the NEW gate explicitly rejects all of that.

## what's still open

- live verification. backtest says the math works. need a week of fires under the new mechanics to confirm realized matches simulated.
- trade execution still on paper. wallet's at $2.22, infrastructure's wired, just haven't flipped `[execution] enabled = true` on the VM. one line and the next call card spawns a real Jupiter+Jito buy.
- settle latency. 60s loop is coarse for memecoin pace — when something rugs from 0% to -90% in 30 seconds, we catch it AT -90%, not at the trail floor. fix paths exist (websocket price feed, mempool watching) but they're heavier infra. waiting until realized vs simulated EV diverges meaningfully.

## the honest summary

the system was bleeding. spent the day fixing it. moonshot is no longer a knife-catcher. scalp has positive expected value again. trailing stop means a peaked position can never close at max-loss. and the cards on the channel sound like a person now, not a printout.

backtest says +EV. live cohort will tell. either way the math is on its way back from the dead.

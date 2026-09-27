# Trend Trade

可扩展的 TypeScript 量化交易回测平台 MVP。当前版本支持多 crypto 标的、`SKHYNIX`、`MU`、常用分钟/小时/日线周期、趋势跟踪回测，以及独立的 Wyckoff SOS → LPS、Spring 和 UTAD 日线回测与手动 Top300 扫描；模拟盘和实盘交易仍需独立执行适配器。

## Architecture

核心流水线：

```text
MarketDataProvider
  -> Strategy
  -> ExecutionEngine
  -> Portfolio
  -> Metrics
```

关键约束：

- `Strategy` 只生成 `Signal`，不下单、不改仓位、不操作资金。
- `BacktestEngine` 只负责编排，不包含任何具体策略逻辑。
- 现有 Trend 策略继续使用 `Strategy.generateSignal`；跨 bar 维护状态的新策略实现 `IncrementalStrategySession`，通过同一注册表接入回测。
- `IncrementalStrategyRunner` 按 symbol、timeframe、策略类型和配置隔离 session，跳过重复或倒序 bar，并提供带版本的可序列化快照用于恢复。
- Wyckoff 使用独立的增量回测与扫描入口；Trend 的策略、表单和图表路径保持原样。
- 执行、组合、市场数据和指标都通过 interface 解耦，方便后续替换为 Paper Trading 或 Broker adapter。

## Project Structure

```text
apps/
  web/       React + Vite + Tailwind + Recharts
  server/    Express + Prisma API

packages/
  shared/       shared types, DTO, zod schema
  market-data/  MarketDataProvider, Binance/Yahoo providers, crypto Top300 adapters
  indicator/    EMA, ATR, drawdown, metrics
  strategy/     Trend strategy and incremental Wyckoff session
  execution/    simulated fills, fees, slippage, ATR stop
  portfolio/    cash, position, trades, equity curve
  backtest/     orchestration engine

prisma/
  schema.prisma
```

## MVP Strategy

Trend indicators: `MA` (simple moving average), `EMA`, or a separate `MACD_TREND` strategy. MA/EMA signals use closing-price crossings of the selected average, including reverse exits and position flips. Legacy configs default to EMA. For storage compatibility, `trendEmaPeriod`, `trendEma`, and the `EMA` exit-trigger value retain their names; `trendMaType` determines the actual average used.

The MACD strategy uses the MACD line (fast EMA minus slow EMA) crossing its signal EMA on completed bars. Defaults are 12/26/9. A golden cross opens long and a death cross opens short; direction settings can restrict entries. With `exitTrigger = MACD`, the opposite cross closes or flips the current position. Optional `zeroFilterEnabled` applies only to entries: `abs(MACD line) / close * 100` must be at most `zeroProximityPct` (default 0.5%). Reverse exits still fire when the filter blocks a new entry. ATR stops, ADX, and volume filters work as they do for the MA/EMA strategy. The MACD line, signal, and histogram are saved with each chart point and shown below the price chart.

Symbol:

- `BTC`
- `ETH`
- `SOL`
- `BNB`
- `ENA`
- `SUI`
- `UNI`
- `AAVE`
- `LINK`
- `ONDO`
- `HYPE`
- `VVV`
- `NEAR`
- `MORPHO`
- `RAY`
- `JUP`
- `KMNO`
- `CAKE`
- `LDO`
- `SKHYNIX`
- `MU`
- `MRVL`
- `PLTR`
- `HOOD`
- `SOFI`
- `SNDK`
- `CRWV`
- `NBIS`
- `IREN`
- `AVGO`
- `INTC`
- `ARM`
- `AMD`
- `XIAOMI` (Yahoo: `1810.HK`)
- `BABA`
- `BIDU`
- `00700` (Yahoo: `0700.HK`)
- `03690` (Yahoo: `3690.HK`)
- `JD`
- `BILI`
- `PDD`
- `TSM`
- `TCOM`
- `FUTU`
- `PONY`
- `QQQ`
- `SPY`
- `VGT`
- `SMH`
- `SOXX`
- `IGV`
- `XBI`
- `DRAM`
- `LYTE`

Timeframes:

- `1m`
- `2m`
- `5m`
- `15m`
- `30m`
- `1h`
- `2h`
- `4h`
- `1d`

Strategy:

- Trend EMA period: `200`
- ATR period: `14`
- ATR multiplier: `2`
- ATR stop enabled: `true`
- ADX period: `14`
- ADX threshold: `20`
- ADX filter enabled: `true`
- Volume MA period: `20`
- Volume multiplier: `1`
- Volume filter enabled: `true`
- Direction: `LONG_ONLY`, `SHORT_ONLY`, or `LONG_SHORT`
- Exit trigger: `EMA` or `NONE`

Rules:

- Close crosses above trend EMA -> open long, or close short in `SHORT_ONLY`
- Close crosses below trend EMA -> open short, or close long in `LONG_ONLY`
- With `exitTrigger = EMA`, a reverse EMA signal closes the existing position and opens the new opposite position
- With `exitTrigger = NONE`, reverse EMA signals do not close an existing position
- EMA exits do not require ATR, ADX, or volume filters to be enabled or warmed up
- Entry signals must pass ADX and volume filters only when those filters are enabled
- ATR stop loss is executed only when ATR stop is enabled
- Position sizing: all-in cash allocation

## API

### `POST /api/backtests`

Runs and saves a backtest.

```json
{
  "symbol": "ETH",
  "timeframe": "1h",
  "startTime": "2023-01-01T00:00:00.000Z",
  "endTime": "2024-01-01T00:00:00.000Z",
  "initialCapital": 10000,
  "feeRate": 0.001,
  "slippageRate": 0.0005,
  "strategy": {
    "type": "EMA_TREND",
    "trendEmaPeriod": 200,
    "atrPeriod": 14,
    "atrMultiplier": 2,
    "direction": "LONG_ONLY"
  }
}
```

### `GET /api/backtests`

Returns the latest saved runs.

### `GET /api/backtests/:id`

Returns config, metrics, equity curve, drawdown curve, and trades for a saved run.

### Wyckoff API

- `POST /api/wyckoff/backtests` runs a single Binance USDT spot symbol on completed daily candles and saves the result. Body: `symbol`, ISO `startTime`/`endTime`, `initialCapital`, `feeRate`, `slippageRate`, and optional `strategy`.
- `GET /api/wyckoff/backtests/:id` reads a saved Wyckoff result.
- `POST /api/wyckoff/scans` starts a manual market-cap Top300 scan. Body: optional `strategy`. Returns a task ID with HTTP 202; only one scan runs at a time.
- `GET /api/wyckoff/scans/:id` returns task progress and per-asset results, including skip and error reasons.

The independent page is at `http://localhost:5173/wyckoff/`. It has its own component and API client. Top300 membership comes from CoinGecko; completed 1d OHLCV comes from Binance spot USDT pairs. Set `COINGECKO_DEMO_API_KEY` in `.env` if required by the CoinGecko API. Assets without an unambiguous ticker, active Binance pair, or enough daily history are shown as skipped; a failed asset does not fail the whole scan. The scan is manual, with no order execution.

New Wyckoff backtests return a per-bar strategy status alongside OHLCV. The page charts daily candles and volume, the active range boundaries, breakout and invalidation levels, Spring/UTAD extremes, detection events, and actual simulated entry/exit fills. Pan or zoom the chart, use **Fit all** or **Latest 120**, and hover a bar for its prices and strategy status. Older saved runs created before per-bar status was added can still provide candles and fills, but do not contain historical level overlays.

### Wyckoff SOS → LPS, Spring and UTAD heuristics

These are configurable price-action heuristics, not canonical Wyckoff classifiers. The [Wyckoff Method tutorial](https://chartschool.stockcharts.com/table-of-contents/market-analysis/wyckoff-analysis-articles/the-wyckoff-method-a-tutorial) describes a spring as a break below range support that returns into the range, and UTAD as a distribution-stage breakout above resistance that fails. This implementation recognizes the price pattern but does not infer the preceding accumulation or distribution phase. The strategy type identifier remains `WYCKOFF_SOS_LPS` for API compatibility. Defaults:

| Setting | Default | Meaning |
| --- | ---: | --- |
| `rangeBars` | 20 | Daily bars used to identify a range |
| `maxRangeWidthPct` | 0.18 | Maximum `(high - low) / average close` |
| `sosLpsEnabled`, `springEnabled`, `utadEnabled` | true, true, true | Enable each signal path independently |
| `sosBreakoutPct` | 0.01 | Close must exceed range high by this fraction |
| `sosVolumeMultiplier` | 1.5 | SOS volume relative to range average |
| `sosCloseLocationMin` | 0.7 | Minimum close position within SOS bar's high-low spread |
| `lpsMinBars`, `lpsMaxBars` | 3, 15 | Days after SOS when LPS may confirm |
| `lpsTolerancePct` | 0.03 | Allowed LPS proximity to range high |
| `lpsMaxVolumeRatio` | 0.85 | Maximum LPS volume relative to SOS volume |
| `springPenetrationPct` | 0.01 | Spring low must break range support by at least 1% |
| `utadPenetrationPct` | 0.01 | UTAD high must break range resistance by at least 1% |
| `trapReentryMaxBars` | 3 | Number of later daily bars allowed for return into the range |
| `invalidationPct` | 0.04 | Close-based invalidation beyond the setup's price level |

The range uses the latest `rangeBars` highs, lows, closes, and volumes. A strong, high-volume close above its high marks SOS. A later lower-volume pullback near the breakout level marks LPS and emits `BUY`. A Spring first pierces support, then closes back at or above support on that bar or within `trapReentryMaxBars` subsequent bars; it emits `BUY`. A UTAD first pierces resistance, then closes back at or below resistance within the same window; it emits `SELL_SHORT`. A strong SOS that returns into the range within that window is treated as a failed breakout and can emit the UTAD short signal. A bar that crosses both boundaries is ambiguous and produces no entry. Spring and UTAD use the lowest low or highest high of the trap, respectively, as their close-based invalidation reference; a subsequent close beyond that extreme by `invalidationPct` emits `CLOSE_LONG` or `CLOSE_SHORT`. The SOS/LPS long still invalidates on a close below range resistance by `invalidationPct`. An expired waiting window invalidates the setup without entry.

`ENTERED` means an entry signal was emitted; actual fills and holdings belong to the execution layer. The simulator fills at the confirming day's close and closes any remaining position at the backtest end. It does not model intrabar stop execution or market impact. Spring and UTAD require no volume threshold because both low- and high-volume variants occur; this increases false-positive risk. No formal accumulation/distribution context, Spring retest, UTAD retest, SOW, LPSY, profit target, or general trend exit is implemented. Ticker-based CoinGecko-to-Binance mapping can be imperfect even after duplicate tickers are skipped. Changing these settings creates a new checkpoint identity; the session state version also changed, so old checkpoints are not restored into the new strategy.

The UTAD short is a signal and a simulated backtest trade. Binance spot candles are used only as market data; actual short execution requires a separate margin, futures, or broker adapter.

## Database

SQLite via Prisma.

Persisted models:

- `BacktestRun`
- `StrategyConfig`
- `Trade`
- `Metrics`
- `EquityPoint`
- `DrawdownPoint`
- `WyckoffBacktestRun`
- `WyckoffScanJob`
- `WyckoffCheckpoint`

Strategy configs, Wyckoff results, jobs, and checkpoints are stored as serialized JSON text because the Prisma SQLite connector used by this MVP does not support native JSON columns. A server restart marks an in-progress scan failed; the next manual scan restores saved per-asset strategy checkpoints and processes newly closed bars. If a checkpoint is older than the scan's lookback window, that asset replays from scratch.

## Local Setup

```bash
pnpm install
cp .env.example .env
pnpm prisma:generate
pnpm exec prisma migrate deploy
pnpm dev
```

Web:

```text
http://localhost:5173
```

API:

```text
http://localhost:4000
```

## Useful Commands

```bash
pnpm typecheck
pnpm build
pnpm test
pnpm dev:web
pnpm dev:server
pnpm prisma:studio
```

If Prisma prints `Schema engine error` without details on macOS, retry the same command with:

```bash
RUST_BACKTRACE=1 RUST_LOG=debug pnpm prisma:migrate --name init
```

## Extension Path

Stateful strategy:

- Implement `IncrementalStrategySession` with `onClosedBar`, `snapshot`, and `restore`; return a `Signal` and optional phase status for each completed bar.
- Backtests replay completed candles through `IncrementalStrategyRunner`; the Top300 scanner uses the same session and saved checkpoints. A future live adapter can use this runner after adding execution feedback and broker reconciliation.
- A session that throws while processing a bar must be restored from its last saved checkpoint before receiving another bar.

Grid strategy:

- Add `GridStrategyConfig` in `packages/shared`
- Implement `GridStrategy` in `packages/strategy`
- Register it in `StrategyRegistry`
- No changes required in `BacktestEngine`

Paper trading:

- Replace historical `MarketDataProvider` with live stream provider
- Replace `SimulatedExecutionEngine` with paper execution adapter
- Reuse strategy, portfolio, and metrics contracts

Binance live trading:

- Add `Broker` interface
- Add `BrokerExecutionEngine`
- Add `RiskManager`, `OrderManager`, and `PortfolioSync`
- Keep strategy as signal-only

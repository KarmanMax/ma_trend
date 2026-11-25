# Trend Trade

可扩展的 TypeScript 量化交易回测平台 MVP。当前版本支持多 crypto 与美股标的、分钟/小时/日/周线周期、趋势跟踪回测、支撑与阻力扫描，以及独立的 Wyckoff SOS → LPS、Spring 和 UTAD 日线回测与手动 Top300 扫描；模拟盘和实盘交易仍需独立执行适配器。

## 支撑与阻力扫描

打开 `/levels/`，选择 `1h`、`4h`、`1d` 或 `1w`，可按加密货币市值前 200（不含稳定币）、蓝筹美股 + 半导体，以及支撑/阻力方向筛选。加密市场每次扫描从 CoinGecko 读取市值前 200，过滤稳定币后再匹配 Binance 正在交易的 USDT 现货对；因此如果部分资产没有 Binance USDT 现货对，实际扫描数量会少于 200。扫描读取 Binance USDT 现货及 Yahoo Finance 美股 K 线；默认显示最新收盘价距离关键价位不超过 2% 的标的，距离阈值可设为 0.1%–10%。

算法使用最近 120 根**已完成** K 线：局部高/低点须高于/低于前后各 2 根 K 线；相距不超过 1% 的同侧摆动点合并，至少出现 2 次触及才形成价位。支撑位必须低于当前收盘价，阻力位必须高于当前收盘价。页面显示价位、距离、触及次数、最新行情时间、最近触及时间，并列出缺失行情的标的。扫描是手动触发的观察工具，不保存结果，也不生成交易信号。

在结果表中点击“查看 K 线”可打开该标的的对应周期图表，并在图表内切换 `1h`、`4h`、`1d`、`1w`。原筛选周期显示对应支撑/阻力虚线；切换周期后显示该周期的已完成 K 线。向左拖动或缩小图表、接近最早 K 线时会自动加载更早数据，同时保留当前可见时间范围。图表数据接口为 `GET /api/levels/candles?symbol=BTC&timeframe=1d`，使用可选的 `before` 毫秒时间戳游标获取更早一页；仅接受扫描标的和上述四个周期。历史数据范围受 Binance、Yahoo 数据源可用性限制。

## 15m 急拉反转扫描

`pnpm scan:pump-reversal` 扫描加密货币市值 Top100 中有 Binance USDT 永续合约的标的，识别两类独立形态：急拉后的放量破位空头，以及恐慌长下影后重新站上 EMA200/恐慌 K 线中位的多头。默认回看 10 天（控制定时扫描的 API 请求量），只使用已完成的 15m K 线，信号在收盘确认并按下一根开盘价统计，4 小时结果包含 0.2% 往返成本。一次性研究可显式加大 `--lookback-days`，但不要高频运行长历史扫描。

空头提醒要求峰值较前 6 小时最低收盘价上涨超过 50%，且峰值前 45 分钟收盘涨幅为正。峰值后若 45 分钟收盘涨幅降至峰值前涨幅的一半或以下，记为减速。在峰值后的 8 小时内，先观察到减速，再于后续收盘确认高点和收盘价均已连续两次下移。确认时收盘须低于 EMA20、较峰值回撤至少 18%，且成交量达到前 20 根均量的 2 倍。最新一根收盘即可确认，下一根开盘数据稍后补齐。

可用参数：`--top 100`、`--symbols PIEVERSE`（默认额外关注 PIEVERSE）、`--lookback-days 10`、`--recent-bars 4`、`--concurrency 5` 和 `--json`。例如：

```sh
pnpm scan:pump-reversal -- --top 80 --lookback-days 60 --recent-bars 2
```

输出的 `SUPPORTED` 只表示当前固定规则在至少 20 个历史样本中，扣除成本后的平均收益为正且胜率不低于 52%；它不是下单指令。统计尚未计入各合约实际资金费率、订单簿冲击和强平风险，真实下单仍需独立执行与风险控制适配器。

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

Crypto daily backtests offer a **Daily candle start (UTC+8)** setting for 00:00, 04:00, 08:00, 12:00, 16:00, or 20:00. The form defaults to 00:00. Date inputs use Beijing calendar dates, with the end date excluded. The API uses absolute UTC timestamps and accepts an optional `dailyCandleStartHour`. API requests and saved daily runs without an explicit hour use 08:00.

The optional **Support / resistance filter** applies to MA, EMA, and all MACD strategies, including cooldown rechecks. It uses the same confirmed swing zones as the level scanner, from up to 120 completed bars on the selected timeframe before the signal bar. Long entries require clearance to the next resistance and short entries require clearance to the next support, measured from the signal price to the near edge of the zone. The default clearance is 1 ATR(14). An enabled filter waits for ATR warmup, and a clear side permits the entry. Reverse exits follow the strategy's exit setting. Enable with `levelFilterEnabled` and set `levelMinClearanceAtr` to adjust the threshold.

The backtest form opens with BTC, `MA` (simple moving average), and **Candle close crossover** selected. `CLOSE_CROSS` compares each close with its corresponding average and uses the signal bar's indicators and closing price for execution. `INTRABAR_TOUCH` uses the average and entry filters from the last completed bar. A directional touch fills at the average, or at the open if price gaps to the other side. Historical OHLC supports one moving-average signal per bar. An intrabar fill is recorded against that bar's close timestamp because the exact touch time is unavailable. Select the mode under **Signal trigger** or set `trendTriggerMode` in the strategy config. The API defaults to `INTRABAR_TOUCH` when the strategy config omits `trendTriggerMode`. Legacy configs default to EMA. For storage compatibility, `trendMaType` determines the average used with `trendEmaPeriod`, `trendEma`, and the `EMA` exit-trigger value.

The MACD strategy uses the MACD line (fast EMA minus slow EMA) crossing its signal EMA on completed bars. Defaults are 12/26/9. A golden cross opens long and a death cross opens short; direction settings can restrict entries. With `exitTrigger = MACD`, the opposite cross closes or flips the current position. Optional `zeroFilterEnabled` applies only to entries: `abs(MACD line) / close * 100` must be at most `zeroProximityPct` (default 0.5%). Reverse exits still fire when the filter blocks a new entry. ATR stops, ADX, and volume filters work as they do for the MA/EMA strategy. The MACD line, signal, and histogram are saved with each chart point and shown below the price chart.

The separate `MACD_MOMENTUM` strategy detects a histogram fill-state change on completed bars. It requires three consecutive histogram bars on the same side of zero, avoiding duplicate zero-cross signals. A histogram slope reversal upward opens long; a reversal downward opens short. This corresponds to solid/hollow transitions for both positive and negative histogram bars. With `exitTrigger = MACD_MOMENTUM`, the opposite signal closes or flips the current position. The MACD periods and optional entry filters are shared with the cross strategy.

Select **MACD · Momentum + EMA trend** (`MACD_MOMENTUM_TREND`) to require trend confirmation on the same completed candle as the histogram turn. The default is EMA60 (`trendEmaPeriod`) with MACD 12/26/9. An upward turn above the EMA signals long, and a downward turn below the EMA signals short. A close on the EMA is neutral. A later EMA cross on its own does not replay an earlier histogram turn. Simulated signal fills use the confirming candle's close, and the result chart shows both EMA and MACD.

By default, an opposite combined signal exits the current position. It also opens a reverse position if the trade direction, enabled entry filters, and cooldown permit. Set `exitTrigger = NONE` to disable combined-signal exits. ATR stops still work when enabled. If you opt in to resuming pending entries after a loss cooldown, the EMA side, same-side histogram slope, and entry filters must still support the entry on the recheck bar.

Symbol:

- `BTC`
- `ETH`
- `SOL`
- `BNB`
- `XRP`
- `ADA`
- `DOGE`
- `AVAX`
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
- `AAPL`
- `MSFT`
- `NVDA`
- `AMZN`
- `GOOGL`
- `META`
- `BRK-B`
- `JPM`
- `V`
- `MA`
- `WMT`
- `COST`
- `UNH`
- `XOM`
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
- `8h`
- `12h`
- `1d`
- `1w`

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

- An upward MA/EMA signal opens long, or closes short in `SHORT_ONLY`.
- A downward MA/EMA signal opens short, or closes long in `LONG_ONLY`.
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

安装 Node.js 和 pnpm 后，在项目根目录运行：

```bash
pnpm start
```

首次运行时会按锁文件安装依赖，并在缺少 `.env` 时从模板创建。命令会生成 Prisma Client、应用数据库迁移，然后同时启动 Web 和 API。终端按 `Ctrl+C` 停止服务。

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

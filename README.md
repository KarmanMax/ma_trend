# Trend Trade

可扩展的 TypeScript 量化交易回测平台 MVP。当前版本支持 `ETHUSDT`、常用分钟/小时/日线周期、EMA 趋势跟踪策略，并保留扩展到网格策略、多标的、参数优化、模拟盘和 Binance 实盘交易的接口边界。

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
- 新增策略通过 `Strategy` interface 和 `StrategyRegistry` 注册，不修改回测核心。
- 执行、组合、市场数据和指标都通过 interface 解耦，方便后续替换为 Paper Trading 或 Broker adapter。

## Project Structure

```text
apps/
  web/       React + Vite + Tailwind + Recharts
  server/    Express + Prisma API

packages/
  shared/       shared types, DTO, zod schema
  market-data/  MarketDataProvider and Binance provider
  indicator/    EMA, ATR, drawdown, metrics
  strategy/     Strategy interface and EMA trend strategy
  execution/    simulated fills, fees, slippage, ATR stop
  portfolio/    cash, position, trades, equity curve
  backtest/     orchestration engine

prisma/
  schema.prisma
```

## MVP Strategy

Symbol:

- `ETHUSDT`

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

- EMA fast: `50`
- EMA slow: `200`
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

- EMA50 crosses above EMA200 -> open long, or close short in `SHORT_ONLY`
- EMA50 crosses below EMA200 -> open short, or close long in `LONG_ONLY`
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
  "symbol": "ETHUSDT",
  "timeframe": "1h",
  "startTime": "2023-01-01T00:00:00.000Z",
  "endTime": "2024-01-01T00:00:00.000Z",
  "initialCapital": 10000,
  "feeRate": 0.001,
  "slippageRate": 0.0005,
  "strategy": {
    "type": "EMA_TREND",
    "emaFast": 50,
    "emaSlow": 200,
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

## Database

SQLite via Prisma.

Persisted models:

- `BacktestRun`
- `StrategyConfig`
- `Trade`
- `Metrics`
- `EquityPoint`
- `DrawdownPoint`

`StrategyConfig.configJson` is stored as serialized JSON text because the Prisma SQLite connector used by this MVP does not support native JSON columns.

## Local Setup

```bash
pnpm install
cp .env.example .env
pnpm prisma:generate
pnpm prisma:migrate --name init
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

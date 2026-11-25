import { useEffect, useId, useState, type ReactNode } from "react";
import { Activity, BarChart3, ChevronDown, LoaderCircle, Play, Settings2, ShieldCheck, SlidersHorizontal } from "lucide-react";
import {
  dailyCandleStartHours,
  defaultDailyCandleStartHour,
  defaultLevelMinClearanceAtr,
  defaultMomentumTrendEmaPeriod,
  supportsDailyCandleStart,
  supportedSymbols,
  supportedTimeframes,
  type BacktestConfig,
  type DailyCandleStartHour,
  type EmaTrendStrategyConfig,
  type MacdTrendStrategyConfig,
  type StrategyConfig,
  type SymbolCode,
  type Timeframe
} from "@trend-trade/shared";
import { formatDailyCandleStartHour } from "../lib/format";

export const defaultMaStrategy: EmaTrendStrategyConfig = {
  type: "EMA_TREND",
  trendEmaPeriod: 60,
  trendMaType: "MA",
  trendTriggerMode: "CLOSE_CROSS",
  atrPeriod: 14,
  atrMultiplier: 2,
  atrStopEnabled: false,
  adxPeriod: 14,
  adxThreshold: 20,
  adxFilterEnabled: false,
  volumeMaPeriod: 20,
  volumeMultiplier: 1,
  volumeFilterEnabled: false,
  direction: "LONG_SHORT",
  exitTrigger: "EMA"
};

const defaultMacdStrategy: MacdTrendStrategyConfig = {
  type: "MACD_TREND",
  macdFastPeriod: 12,
  macdSlowPeriod: 26,
  macdSignalPeriod: 9,
  zeroFilterEnabled: false,
  zeroProximityPct: 0.5,
  atrPeriod: 14,
  atrMultiplier: 2,
  atrStopEnabled: false,
  adxPeriod: 14,
  adxThreshold: 20,
  adxFilterEnabled: false,
  volumeMaPeriod: 20,
  volumeMultiplier: 1,
  volumeFilterEnabled: false,
  direction: "LONG_SHORT",
  exitTrigger: "MACD"
};

type SignalModel = "MA" | "EMA" | "MACD" | "MACD_MOMENTUM" | "MACD_MOMENTUM_TREND";

function switchTrendStrategy(current: StrategyConfig, indicator: SignalModel): StrategyConfig {
  const common = {
    atrPeriod: current.atrPeriod,
    atrMultiplier: current.atrMultiplier,
    atrStopEnabled: current.atrStopEnabled,
    adxPeriod: current.adxPeriod,
    adxThreshold: current.adxThreshold,
    adxFilterEnabled: current.adxFilterEnabled,
    volumeMaPeriod: current.volumeMaPeriod,
    volumeMultiplier: current.volumeMultiplier,
    volumeFilterEnabled: current.volumeFilterEnabled,
    levelFilterEnabled: current.levelFilterEnabled,
    levelMinClearanceAtr: current.levelMinClearanceAtr,
    lossCooldownBars: current.lossCooldownBars,
    resumeEntryAfterCooldown: current.resumeEntryAfterCooldown,
    direction: current.direction
  };
  const noSignalExit = current.exitTrigger === "NONE";
  if (indicator !== "MA" && indicator !== "EMA") {
    const macd = current.type === "EMA_TREND" ? defaultMacdStrategy : current;
    const macdFields = {
      ...common,
      macdFastPeriod: macd.macdFastPeriod,
      macdSlowPeriod: macd.macdSlowPeriod,
      macdSignalPeriod: macd.macdSignalPeriod,
      zeroFilterEnabled: macd.zeroFilterEnabled,
      zeroProximityPct: macd.zeroProximityPct
    };
    if (indicator === "MACD_MOMENTUM_TREND") {
      return {
        ...macdFields,
        type: indicator,
        trendEmaPeriod: current.type === indicator ? current.trendEmaPeriod : defaultMomentumTrendEmaPeriod,
        exitTrigger: noSignalExit ? "NONE" : indicator
      };
    }
    return indicator === "MACD"
      ? { ...macdFields, type: "MACD_TREND", exitTrigger: noSignalExit ? "NONE" : "MACD" }
      : { ...macdFields, type: indicator, exitTrigger: noSignalExit ? "NONE" : indicator };
  }
  return {
    ...defaultMaStrategy,
    ...common,
    ...(current.type === "EMA_TREND" ? {
      trendEmaPeriod: current.trendEmaPeriod,
      trendTriggerMode: current.trendTriggerMode,
      exitOnFailedBreakout: current.exitOnFailedBreakout,
      keepCooldownSignalsByDirection: current.keepCooldownSignalsByDirection,
      filterExtendedCooldownEntries: current.filterExtendedCooldownEntries
    } : {}),
    trendMaType: indicator,
    exitTrigger: noSignalExit ? "NONE" : "EMA"
  };
}

type BacktestFormProps = {
  config: BacktestConfig;
  onChange: (config: BacktestConfig) => void;
  onSubmit: () => void;
  loading: boolean;
  error: string | null;
  symbolLabels: Record<SymbolCode, string>;
  timeframeLabels: Record<Timeframe, string>;
};

export function BacktestForm({ config, onChange, onSubmit, loading, error, symbolLabels, timeframeLabels }: BacktestFormProps) {
  const strategy = config.strategy;
  const macd = strategy.type === "EMA_TREND" ? null : strategy;
  const invalidMacdPeriods = macd !== null && macd.macdFastPeriod >= macd.macdSlowPeriod;
  const macdErrorId = useId();
  const invalidDateRange = !(Date.parse(config.startTime) < Date.parse(config.endTime));
  const dateErrorId = useId();
  const canSetDailyCandleStart = supportsDailyCandleStart(config.symbol, config.timeframe);
  const [costsOpen, setCostsOpen] = useState(false);
  const lossCooldownBars = strategy.lossCooldownBars ?? 0;
  const enabledFilters = [strategy.atrStopEnabled, strategy.adxFilterEnabled, strategy.volumeFilterEnabled,
    strategy.levelFilterEnabled, lossCooldownBars > 0].filter(Boolean).length;
  const reverseExit = strategy.type === "EMA_TREND" ? "EMA" : strategy.type === "MACD_TREND" ? "MACD" : strategy.type;

  function updateStrategy(patch: Partial<StrategyConfig>) {
    onChange({ ...config, strategy: { ...strategy, ...patch } as StrategyConfig });
  }

  return (
    <form
      className="backtest-form"
      aria-label="Backtest parameters"
      onSubmit={(event) => {
        event.preventDefault();
        if (!invalidMacdPeriods && !invalidDateRange && !loading) onSubmit();
      }}
    >
      <div className="backtest-form-header">
        <span className="form-header-icon"><Settings2 size={18} aria-hidden="true" /></span>
        <div>
          <h2 className="text-sm font-semibold">Backtest setup</h2>
          <p className="mt-0.5 text-xs text-muted">Configure your next strategy run</p>
        </div>
      </div>

      <div className="backtest-form-scroll">
        <fieldset disabled={loading} className="backtest-form-body">
          <section className="form-section" aria-labelledby="market-heading">
            <SectionHeading id="market-heading" label="Market & range" />
            <div className="grid grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] gap-3">
              <Field label="Symbol">
                <select className="input" value={config.symbol} onChange={(event) => onChange({ ...config, symbol: event.target.value as SymbolCode })}>
                  {supportedSymbols.map((symbol) => <option key={symbol} value={symbol}>{symbolLabels[symbol]}</option>)}
                </select>
              </Field>
              <Field label="Timeframe">
                <select className="input" value={config.timeframe} onChange={(event) => onChange({ ...config, timeframe: event.target.value as Timeframe })}>
                  {supportedTimeframes.map((timeframe) => <option key={timeframe} value={timeframe}>{timeframeLabels[timeframe]}</option>)}
                </select>
              </Field>
            </div>
            {canSetDailyCandleStart && (
              <Field label="Daily candle start (UTC+8)">
                <select className="input" value={config.dailyCandleStartHour ?? defaultDailyCandleStartHour}
                  onChange={(event) => onChange({ ...config, dailyCandleStartHour: Number(event.target.value) as DailyCandleStartHour })}>
                  {dailyCandleStartHours.map((hour) => <option key={hour} value={hour}>{formatDailyCandleStartHour(hour)}</option>)}
                </select>
              </Field>
            )}
            <div className="form-date-grid">
              <Field label="Start date">
                <input className="input" type="date" required aria-invalid={invalidDateRange || undefined} aria-describedby={invalidDateRange ? dateErrorId : undefined}
                  max={config.endTime.slice(0, 10)} value={config.startTime.slice(0, 10)}
                  onInput={(event) => onChange({ ...config, startTime: `${event.currentTarget.value}T00:00:00.000Z` })} />
              </Field>
              <Field label="End date">
                <input className="input" type="date" required aria-invalid={invalidDateRange || undefined} aria-describedby={invalidDateRange ? dateErrorId : undefined}
                  min={config.startTime.slice(0, 10)} value={config.endTime.slice(0, 10)}
                  onInput={(event) => onChange({ ...config, endTime: `${event.currentTarget.value}T00:00:00.000Z` })} />
              </Field>
            </div>
            {canSetDailyCandleStart && <p className="form-help">Beijing dates. The end date is excluded.</p>}
            {invalidDateRange ? <p id={dateErrorId} role="alert" className="text-xs text-negative">Start date must be before end date.</p> : null}
            <NumberField label="Initial capital" value={config.initialCapital} min={0.01} step="any" suffix="USD"
              onChange={(value) => onChange({ ...config, initialCapital: value })} />
          </section>

          <section className="form-section" aria-labelledby="strategy-heading">
            <SectionHeading id="strategy-heading" label="Strategy" icon={<Activity size={14} />} />
            <Field label="Signal model">
              <select className="input" value={strategy.type === "EMA_TREND" ? strategy.trendMaType ?? "EMA" : reverseExit}
                onChange={(event) => onChange({ ...config, strategy: switchTrendStrategy(strategy, event.target.value as SignalModel) })}>
                <option value="MA">MA</option>
                <option value="EMA">EMA</option>
                <option value="MACD">MACD · Signal crossover</option>
                <option value="MACD_MOMENTUM">MACD · Momentum reversal</option>
                <option value="MACD_MOMENTUM_TREND">MACD · Momentum + EMA trend</option>
              </select>
            </Field>

            {macd ? (
              <div className="macd-parameter-card">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-slate-700">MACD periods</span>
                  <span className="form-unit-label">in bars</span>
                </div>
                <div className="grid grid-cols-3 gap-2.5">
                  <NumberField label="Fast" ariaLabel="MACD fast period" value={macd.macdFastPeriod} min={1} invalid={invalidMacdPeriods} describedBy={invalidMacdPeriods ? macdErrorId : undefined}
                    onChange={(value) => updateStrategy({ macdFastPeriod: value })} />
                  <NumberField label="Slow" ariaLabel="MACD slow period" value={macd.macdSlowPeriod} min={1} invalid={invalidMacdPeriods} describedBy={invalidMacdPeriods ? macdErrorId : undefined}
                    onChange={(value) => updateStrategy({ macdSlowPeriod: value })} />
                  <NumberField label="Signal" ariaLabel="MACD signal period" value={macd.macdSignalPeriod} min={1}
                    onChange={(value) => updateStrategy({ macdSignalPeriod: value })} />
                </div>
                {invalidMacdPeriods ? <p id={macdErrorId} role="alert" className="mt-2 text-xs text-negative">Fast period must be smaller than slow period.</p> : null}
                <p className="mt-3 text-xs leading-relaxed text-muted">
                  {strategy.type === "MACD_TREND"
                    ? "A golden cross opens long; a death cross opens short."
                    : strategy.type === "MACD_MOMENTUM_TREND"
                      ? "A same-side histogram turn and the matching side of the EMA must align at the same close."
                      : "Trade when the histogram turns upward or downward on the same side of zero."}
                </p>
                <div className="mt-3 border-t border-blue-100 pt-3">
                  <ToggleField label="Near-zero entries" description="Limit entries to signals close to the zero line." checked={macd.zeroFilterEnabled}
                    onChange={(value) => updateStrategy({ zeroFilterEnabled: value })}>
                    <NumberField label="Max. distance from zero" value={macd.zeroProximityPct} min={0} max={100} step="0.1" suffix="%"
                      onChange={(value) => updateStrategy({ zeroProximityPct: value })} />
                    <p className="form-help">MACD line distance as a percentage of price. Reverse exits still apply.</p>
                  </ToggleField>
                </div>
              </div>
            ) : strategy.type === "EMA_TREND" ? (
              <>
                <Field label="Signal trigger">
                  <select className="input" value={strategy.trendTriggerMode ?? "INTRABAR_TOUCH"}
                    onChange={(event) => updateStrategy({ trendTriggerMode: event.target.value as EmaTrendStrategyConfig["trendTriggerMode"] })}>
                    <option value="INTRABAR_TOUCH">Intrabar price touch</option>
                    <option value="CLOSE_CROSS">Candle close crossover</option>
                  </select>
                </Field>
                {strategy.trendTriggerMode !== "CLOSE_CROSS" ? (
                  <label className="flex items-start gap-2 text-xs">
                    <input type="checkbox" checked={strategy.exitOnFailedBreakout ?? false}
                      onChange={(event) => updateStrategy({ exitOnFailedBreakout: event.target.checked })} />
                    Exit new positions if the entry bar closes back across the average
                  </label>
                ) : null}
                <NumberField label={`${strategy.trendMaType ?? "EMA"} period`} value={strategy.trendEmaPeriod} min={1} suffix="bars"
                  onChange={(value) => updateStrategy({ trendEmaPeriod: value })} />
              </>
            ) : null}

            {strategy.type === "MACD_MOMENTUM_TREND" && (
              <NumberField label="Trend EMA period" value={strategy.trendEmaPeriod} min={1} suffix="bars"
                onChange={(value) => updateStrategy({ trendEmaPeriod: value })} />
            )}

            <fieldset className="min-w-0">
              <legend className="form-label mb-1.5">Trade direction</legend>
              <div className="direction-control">
                {([
                  ["LONG_SHORT", "Long & Short"],
                  ["LONG_ONLY", "Long only"],
                  ["SHORT_ONLY", "Short only"]
                ] as const).map(([value, label]) => (
                  <label className="direction-option" key={value}>
                    <input type="radio" name="trade-direction" value={value} checked={strategy.direction === value} onChange={() => updateStrategy({ direction: value })} />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <Field label="Exit rule">
              <select className="input" value={strategy.exitTrigger} onChange={(event) => updateStrategy({ exitTrigger: event.target.value as StrategyConfig["exitTrigger"] })}>
                <option value={reverseExit}>{strategy.type === "MACD_MOMENTUM_TREND" ? "On opposite combined signal" : "On opposite signal"}</option>
                <option value="NONE">No signal exit</option>
              </select>
            </Field>
          </section>

          <section className="form-section" aria-labelledby="risk-heading">
            <SectionHeading id="risk-heading" label="Risk & filters" icon={<ShieldCheck size={14} />} detail={`${enabledFilters} active`} />
            <div className="filter-card">
              <ToggleField label="ATR stop loss" description={strategy.atrStopEnabled ? "Stop distance = ATR × multiplier." : "Add a volatility-based protective stop."} checked={strategy.atrStopEnabled}
                onChange={(value) => updateStrategy({ atrStopEnabled: value })}>
                <div className="grid grid-cols-2 gap-3">
                  <NumberField label="ATR period" value={strategy.atrPeriod} min={1} suffix="bars" onChange={(value) => updateStrategy({ atrPeriod: value })} />
                  <NumberField label="Multiplier" ariaLabel="ATR multiplier" value={strategy.atrMultiplier} min={0.1} step="0.1" suffix="×" onChange={(value) => updateStrategy({ atrMultiplier: value })} />
                </div>
              </ToggleField>
            </div>
            <div className="filter-card">
              <ToggleField label="Loss cooldown" description="Pause new entries after an ATR stop or a losing signal exit." checked={lossCooldownBars > 0}
                onChange={(value) => updateStrategy({ lossCooldownBars: value ? 3 : 0 })}>
                <NumberField label="Bars to wait" value={lossCooldownBars} min={1} max={Number.MAX_SAFE_INTEGER} suffix="bars"
                  onChange={(value) => updateStrategy({ lossCooldownBars: value })} />
                <label className="flex items-center gap-2 text-xs">
                  <input type="checkbox" checked={strategy.resumeEntryAfterCooldown ?? false}
                    onChange={(event) => updateStrategy({ resumeEntryAfterCooldown: event.target.checked })} />
                  Recheck pending entries after cooldown
                </label>
                {strategy.type === "EMA_TREND" && strategy.trendTriggerMode !== "CLOSE_CROSS" && strategy.resumeEntryAfterCooldown && (
                  <label className="flex items-center gap-2 text-xs">
                    <input type="checkbox" checked={strategy.keepCooldownSignalsByDirection ?? false}
                      onChange={(event) => updateStrategy({ keepCooldownSignalsByDirection: event.target.checked })} />
                    Keep one pending entry per direction
                  </label>
                )}
                {strategy.type === "EMA_TREND" && strategy.resumeEntryAfterCooldown && (
                  <label className="flex items-center gap-2 text-xs">
                    <input type="checkbox" checked={strategy.filterExtendedCooldownEntries ?? false}
                      onChange={(event) => updateStrategy({ filterExtendedCooldownEntries: event.target.checked })} />
                    Skip rechecks at least 2 ATR from the average with 20-bar momentum in the entry direction
                  </label>
                )}
              </ToggleField>
            </div>
            <div className="filter-card">
              <ToggleField label="ADX trend filter" description={strategy.adxFilterEnabled ? "Only enter when ADX meets the minimum." : "Filter out signals in weaker trends."} checked={strategy.adxFilterEnabled}
                onChange={(value) => updateStrategy({ adxFilterEnabled: value })}>
                <div className="grid grid-cols-2 gap-3">
                  <NumberField label="ADX period" value={strategy.adxPeriod} min={1} suffix="bars" onChange={(value) => updateStrategy({ adxPeriod: value })} />
                  <NumberField label="Min. ADX" value={strategy.adxThreshold} min={0} max={100} step="any" onChange={(value) => updateStrategy({ adxThreshold: value })} />
                </div>
              </ToggleField>
            </div>
            <div className="filter-card">
              <ToggleField label="Volume filter" description="Require volume above its moving average." checked={strategy.volumeFilterEnabled}
                onChange={(value) => updateStrategy({ volumeFilterEnabled: value })}>
                <div className="grid grid-cols-2 gap-3">
                  <NumberField label="Volume MA" value={strategy.volumeMaPeriod} min={1} suffix="bars" onChange={(value) => updateStrategy({ volumeMaPeriod: value })} />
                  <NumberField label="Multiplier" ariaLabel="Volume multiplier" value={strategy.volumeMultiplier} min={0.1} step="0.1" suffix="×" onChange={(value) => updateStrategy({ volumeMultiplier: value })} />
                </div>
              </ToggleField>
            </div>
            <div className="filter-card">
              <ToggleField label="Support / resistance filter" description="Require room to the next resistance for longs or support for shorts."
                checked={strategy.levelFilterEnabled ?? false} onChange={(value) => updateStrategy({ levelFilterEnabled: value })}>
                <NumberField label="Minimum clearance" value={strategy.levelMinClearanceAtr ?? defaultLevelMinClearanceAtr}
                  min={0.1} step="any" suffix="ATR" onChange={(value) => updateStrategy({ levelMinClearanceAtr: value })} />
              </ToggleField>
            </div>
          </section>

          <details className="form-costs" onToggle={(event) => setCostsOpen(event.currentTarget.open)}>
            <summary>
              <SlidersHorizontal size={14} aria-hidden="true" />
              <span className="flex-1">Trading costs</span>
              <span className="text-xs font-normal text-muted">{Number((config.feeRate * 100).toFixed(4))}% / {Number((config.slippageRate * 100).toFixed(4))}%</span>
              <ChevronDown className="costs-chevron" size={14} aria-hidden="true" />
            </summary>
            {costsOpen ? <div className="grid grid-cols-2 gap-3 pt-3">
              <NumberField label="Fee per trade" value={Number((config.feeRate * 100).toFixed(6))} min={0} max={10} step="0.01" suffix="%"
                onChange={(value) => onChange({ ...config, feeRate: value / 100 })} />
              <NumberField label="Slippage" value={Number((config.slippageRate * 100).toFixed(6))} min={0} max={10} step="0.01" suffix="%"
                onChange={(value) => onChange({ ...config, slippageRate: value / 100 })} />
            </div> : null}
          </details>
        </fieldset>
      </div>

      <div className="backtest-form-footer">
        {error ? <p role="alert" className="mb-3 rounded-md border border-red-200 bg-red-50 p-2.5 text-xs text-negative">{error}</p> : null}
        <button className="run-backtest-button" type="submit" disabled={loading || invalidMacdPeriods || invalidDateRange}>
          {loading ? <LoaderCircle size={16} className="animate-spin" aria-hidden="true" /> : <Play size={15} fill="currentColor" aria-hidden="true" />}
          {loading ? "Running backtest…" : "Run Backtest"}
        </button>
      </div>
    </form>
  );
}

function SectionHeading({ id, label, icon, detail }: { id: string; label: string; icon?: ReactNode; detail?: string }) {
  return <div className="form-section-heading"><h3 id={id}>{icon ?? <BarChart3 size={14} />}{label}</h3>{detail ? <span>{detail}</span> : null}</div>;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="form-field"><span className="form-label">{label}</span>{children}</label>;
}

function NumberField({ label, ariaLabel, value, onChange, step = "1", min, max, suffix, invalid, describedBy }: {
  label: string;
  ariaLabel?: string;
  value: number;
  onChange: (value: number) => void;
  step?: string;
  min?: number;
  max?: number;
  suffix?: string;
  invalid?: boolean;
  describedBy?: string;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);

  return (
    <Field label={label}>
      <span className="number-input-wrap">
        <input className={`input${suffix ? " input-with-suffix" : ""}`} type="number" required aria-label={ariaLabel} aria-invalid={invalid || undefined}
          aria-describedby={describedBy} min={min} max={max} step={step} value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            if (event.target.validity.valid) onChange(event.target.valueAsNumber);
          }} />
        {suffix ? <span className="input-suffix" aria-hidden="true">{suffix}</span> : null}
      </span>
    </Field>
  );
}

function ToggleField({ label, description, checked, onChange, children }: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <div className={`toggle-field${checked ? " is-enabled" : ""}`}>
      <label className="toggle-label">
        <span className="min-w-0 flex-1"><span className="block text-[13px] font-semibold">{label}</span><span id={`${id}-help`} className="mt-1 block text-xs leading-relaxed text-muted">{description}</span></span>
        <span className="form-switch">
          <input type="checkbox" role="switch" aria-label={label} aria-describedby={`${id}-help`} aria-controls={`${id}-fields`} aria-expanded={checked} checked={checked} onChange={(event) => onChange(event.target.checked)} />
          <span className="switch-track" aria-hidden="true"><span /></span>
        </span>
      </label>
      <fieldset id={`${id}-fields`} hidden={!checked} disabled={!checked} className="toggle-fields">{checked ? children : null}</fieldset>
    </div>
  );
}

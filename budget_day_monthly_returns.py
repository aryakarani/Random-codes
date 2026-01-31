#!/usr/bin/env python3
import argparse
import os
from datetime import datetime, timedelta

import numpy as np
import pandas as pd
import yfinance as yf
from tabulate import tabulate

DEFAULT_SYMBOLS = ["BEL.NS", "RVNL.NS", "RELIANCE.NS", "^NSEI"]
REQUIRED_COLUMNS = ["Open", "High", "Low", "Close"]
FALLBACK_SUFFIXES = [".NS", ".BO"]


def normalize_index(df: pd.DataFrame) -> pd.DataFrame:
    """Return df with tz-naive, normalized, sorted DatetimeIndex."""
    if df.empty:
        return df
    idx = pd.to_datetime(df.index)
    if getattr(idx, "tz", None) is not None:
        idx = idx.tz_convert(None)
    idx = idx.normalize()
    df = df.copy()
    df.index = idx
    return df.sort_index()


def symbol_candidates(sym: str) -> list[str]:
    if "." in sym or sym.startswith("^"):
        return [sym]
    return [sym] + [f"{sym}{suffix}" for suffix in FALLBACK_SUFFIXES]


def next_trading_day(df: pd.DataFrame, date: pd.Timestamp) -> pd.Timestamp | None:
    """Return date if present, else next available trading date after `date`."""
    if df.empty:
        return None
    target = pd.Timestamp(date).normalize()
    idx = df.index
    if target in idx:
        return target
    pos = idx.searchsorted(target)
    if pos < len(idx):
        return idx[pos]
    return None


def month_end_close(df: pd.DataFrame) -> pd.Series:
    """Month-end close series (last available close each month)."""
    if df.empty:
        return pd.Series(dtype=float)
    return df["Close"].resample("ME").last()


def compute_monthly_returns(df: pd.DataFrame, years: list[int]) -> pd.DataFrame:
    """Returns Jan/Feb close-to-close monthly returns for given years."""
    if df.empty:
        return pd.DataFrame({"Year": years, "Jan": np.nan, "Feb": np.nan})
    mclose = month_end_close(df)
    mret = mclose.pct_change() * 100.0  # close-to-close monthly return

    rows = []
    for y in years:
        row = {"Year": y}
        for m, mname in [(1, "Jan"), (2, "Feb")]:
            dt = pd.Timestamp(year=y, month=m, day=1) + pd.offsets.MonthEnd(0)
            val = mret.get(dt, np.nan)
            row[mname] = float(val) if pd.notna(val) else np.nan
        rows.append(row)
    return pd.DataFrame(rows)


def compute_budget_day_intraday(
    df: pd.DataFrame, years: list[int], budget_month: int, budget_day: int
) -> pd.DataFrame:
    """Budget day intraday move (Close-Open)/Open for each year."""
    rows = []
    for y in years:
        target = pd.Timestamp(year=y, month=budget_month, day=budget_day)
        d = next_trading_day(df, target)
        if d is None:
            rows.append(
                {
                    "Year": y,
                    "TradeDate": None,
                    "Open": np.nan,
                    "Close": np.nan,
                    "Intraday_%": np.nan,
                }
            )
            continue
        o = float(df.loc[d, "Open"])
        c = float(df.loc[d, "Close"])
        intraday = (c - o) / o * 100.0 if o else np.nan
        rows.append(
            {
                "Year": y,
                "TradeDate": d.strftime("%Y-%m-%d"),
                "Open": o,
                "Close": c,
                "Intraday_%": intraday,
            }
        )
    return pd.DataFrame(rows)


def derive_year_range(df: pd.DataFrame, years_back: int | None) -> tuple[int, int]:
    if df.empty:
        raise ValueError("Cannot derive year range from empty data.")
    first_year = int(df.index.min().year)
    last_year = int(df.index.max().year)
    if years_back and years_back > 0:
        start_year = max(first_year, last_year - years_back + 1)
    else:
        start_year = first_year
    return start_year, last_year


def download_symbol(sym: str, start: str, end: str) -> tuple[pd.DataFrame, str]:
    last_df = pd.DataFrame()
    for candidate in symbol_candidates(sym):
        df = yf.download(candidate, start=start, end=end, auto_adjust=False, progress=False)
        if df.empty:
            last_df = df
            continue
        if isinstance(df.columns, pd.MultiIndex):
            df.columns = df.columns.get_level_values(0)
        missing = [col for col in REQUIRED_COLUMNS if col not in df.columns]
        if missing:
            raise ValueError(f"{candidate}: Missing columns from Yahoo data: {missing}")
        df = df[REQUIRED_COLUMNS].dropna()
        return normalize_index(df), candidate
    return last_df, sym


def ensure_output_dir(prefix: str) -> None:
    if not prefix:
        return
    directory = os.path.dirname(prefix)
    if directory:
        os.makedirs(directory, exist_ok=True)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--symbols",
        nargs="+",
        default=DEFAULT_SYMBOLS,
        help="Yahoo symbols, e.g. BEL.NS RVNL.NS RELIANCE.NS ^NSEI",
    )
    ap.add_argument("--start_year", type=int, default=2021)
    ap.add_argument("--end_year", type=int, default=2025)
    ap.add_argument("--budget_month", type=int, default=2)
    ap.add_argument("--budget_day", type=int, default=1)
    ap.add_argument(
        "--auto_years",
        action="store_true",
        help="Derive year range from available data (uses --years_back).",
    )
    ap.add_argument(
        "--years_back",
        type=int,
        default=5,
        help="When using --auto_years, keep up to N most recent years (<=0 = all).",
    )
    ap.add_argument(
        "--save_csv",
        type=str,
        default="",
        help="Optional path prefix to save CSVs (e.g., results/out)",
    )
    args = ap.parse_args()

    if not args.auto_years and args.start_year > args.end_year:
        ap.error("--start_year must be <= --end_year")

    years_back = args.years_back if args.years_back and args.years_back > 0 else None
    years = list(range(args.start_year, args.end_year + 1))

    # Pull a buffer around the years so month-end computations work
    if args.auto_years:
        start = "1900-01-01"
        end = (datetime.utcnow().date() + timedelta(days=1)).strftime("%Y-%m-%d")
    else:
        start = f"{args.start_year - 1}-12-01"
        end = f"{args.end_year}-03-31"

    monthly_tables = {}
    budget_tables = {}

    ensure_output_dir(args.save_csv.rstrip("/"))

    for sym in args.symbols:
        df, resolved = download_symbol(sym, start=start, end=end)
        if df.empty:
            print(f"\n{sym}: No data returned.")
            continue

        if args.auto_years:
            start_year, end_year = derive_year_range(df, years_back)
            years = list(range(start_year, end_year + 1))
        else:
            start_year, end_year = args.start_year, args.end_year

        monthly = compute_monthly_returns(df, years)
        budget = compute_budget_day_intraday(df, years, args.budget_month, args.budget_day)

        monthly_tables[resolved] = monthly
        budget_tables[resolved] = budget

        print("\n" + "=" * 90)
        if resolved != sym:
            print(f"{sym}: resolved to {resolved} for Yahoo data.")
        print(f"{resolved} — Jan/Feb monthly % change (close-to-close monthly return)")
        print(tabulate(monthly, headers="keys", tablefmt="github", floatfmt=".3f"))

        print(
            "\n"
            + f"{resolved} — Budget day intraday % (Open→Close) for "
            f"{args.budget_day:02d}-{args.budget_month:02d}-{start_year}..{end_year}"
        )
        print(tabulate(budget, headers="keys", tablefmt="github", floatfmt=".3f"))

        if args.save_csv:
            prefix = args.save_csv.rstrip("/")
            monthly.to_csv(
                f"{prefix}_{resolved.replace('^', '')}_monthly_jan_feb.csv", index=False
            )
            budget.to_csv(
                f"{prefix}_{resolved.replace('^', '')}_budget_intraday.csv", index=False
            )


if __name__ == "__main__":
    main()

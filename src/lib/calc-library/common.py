"""Shared utilities for the Cortex calculation library."""

import json
import re
import pandas as pd


def safe_numeric(value, default=0.0):
    """Parse any monetary/numeric string to float. Handles $, commas, %, None, N/A, and JSON-wrapped values like {"value": 123}."""
    if value is None:
        return default
    if isinstance(value, (int, float)):
        return float(value)
    s = str(value).strip()
    if not s or s.lower() in ("n/a", "none", "null", "-", "—", ""):
        return default
    if s.startswith("{"):
        try:
            parsed = json.loads(s)
            if isinstance(parsed, dict) and "value" in parsed:
                return safe_numeric(parsed["value"], default)
        except (json.JSONDecodeError, TypeError):
            pass
    s = re.sub(r"[,$%]", "", s)
    s = s.replace("(", "-").replace(")", "")
    try:
        return float(s)
    except (ValueError, TypeError):
        return default


def safe_currency(value):
    """Format a float as $X,XXX or ($X,XXX) for negatives."""
    n = safe_numeric(value)
    if n < 0:
        return f"(${abs(n):,.0f})"
    return f"${n:,.0f}"


def pct(numerator, denominator, default=0.0):
    """Safe percentage: numerator / denominator * 100 with zero-division guard."""
    n = safe_numeric(numerator)
    d = safe_numeric(denominator)
    if d == 0:
        return default
    return (n / d) * 100


def delta(a, b):
    """a - b with None handling."""
    return safe_numeric(a) - safe_numeric(b)


def load_data(path="/tmp/data.json"):
    """Load JSON (from sandbox SQL result) into a DataFrame."""
    with open(path) as f:
        raw = json.load(f)
    rows = raw.get("rows", raw) if isinstance(raw, dict) else raw
    if not rows:
        return pd.DataFrame()
    return pd.DataFrame(rows)


def extract_sources(df, col="source_file"):
    """Collect unique non-null source_file values from a DataFrame."""
    if df is None or df.empty or col not in df.columns:
        return []
    return sorted(df[col].dropna().unique().tolist())


def df_coverage(name, df):
    """Return a coverage entry: {name: {rows: N, has_data: bool}}."""
    if df is None or df.empty:
        return {name: {"rows": 0, "has_data": False}}
    return {name: {"rows": len(df), "has_data": True}}


def make_result(result, formula, intermediates=None, warnings=None,
                sources=None, data_coverage=None, confidence="medium"):
    """Standard return dict for all calc library functions."""
    return {
        "result": result,
        "formula": formula,
        "intermediates": intermediates or {},
        "warnings": warnings or [],
        "sources": sources or [],
        "data_coverage": data_coverage or {},
        "confidence": confidence,
    }


def numeric_col(df, col, default=0.0):
    """Convert a DataFrame column to numeric, filling bad values with default."""
    if col not in df.columns:
        return pd.Series([default] * len(df), index=df.index)
    return pd.to_numeric(df[col].apply(lambda v: safe_numeric(v, default)), errors="coerce").fillna(default)


def confidence_level(coverage_dict):
    """Derive confidence from data_coverage: high/medium/low."""
    if not coverage_dict:
        return "low"
    sources_with_data = sum(1 for v in coverage_dict.values() if v.get("has_data"))
    total = len(coverage_dict)
    if total == 0:
        return "low"
    ratio = sources_with_data / total
    if ratio >= 0.8:
        return "high"
    if ratio >= 0.5:
        return "medium"
    return "low"

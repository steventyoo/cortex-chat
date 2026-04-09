"""Schedule delay cost attribution."""

from common import safe_numeric, pct, extract_sources, df_coverage, make_result, numeric_col, confidence_level
import pandas as pd


def delay_cost_attribution(prod_df, daily_df=None, rfi_df=None, dc_df=None, co_df=None, **kwargs):
    """Attribute schedule delay costs to specific causes with evidence."""
    warnings = []
    cov = {}
    cov.update(df_coverage("production", prod_df))
    cov.update(df_coverage("daily_report", daily_df))
    cov.update(df_coverage("rfi", rfi_df))
    cov.update(df_coverage("design_changes", dc_df))
    cov.update(df_coverage("change_orders", co_df))
    all_sources = []

    if prod_df is None or prod_df.empty:
        if daily_df is None or daily_df.empty:
            return make_result({"error": "No production or daily data"}, "N/A", warnings=["No data"], data_coverage=cov, confidence="low")

    total_disruption_cost = 0
    total_disruption_hours = 0
    by_cause = None

    if prod_df is not None and not prod_df.empty:
        prod = prod_df.copy()
        prod["disruption_cost"] = numeric_col(prod, "disruption_cost")
        prod["disruption_hours"] = numeric_col(prod, "total_disruption_hours")
        total_disruption_cost = float(prod["disruption_cost"].sum())
        total_disruption_hours = float(prod["disruption_hours"].sum())
        all_sources.extend(extract_sources(prod_df))

        cause_col = None
        for c in ["disruption_cause_categories", "Disruption Cause Categories"]:
            if c in prod.columns:
                cause_col = c
                break

        resp_col = None
        for c in ["responsible_party", "Responsible Party"]:
            if c in prod.columns:
                resp_col = c
                break

        if cause_col:
            by_cause_df = prod.groupby(cause_col).agg(
                cost=("disruption_cost", "sum"),
                hours=("disruption_hours", "sum"),
                events=("disruption_cost", "size"),
            ).round(0).reset_index()
            by_cause_df["pct_of_total"] = by_cause_df["cost"].apply(
                lambda c: round(pct(c, total_disruption_cost), 1) if total_disruption_cost else 0
            )
            by_cause_df = by_cause_df.sort_values("cost", ascending=False)
            by_cause = by_cause_df.to_dict("records")

    delay_categories = {}
    if daily_df is not None and not daily_df.empty:
        delay_col = None
        for c in ["delay_cause_category", "Delay Cause Category"]:
            if c in daily_df.columns:
                delay_col = c
                break
        if delay_col:
            delay_counts = daily_df[delay_col].value_counts().to_dict()
            delay_categories = {str(k): int(v) for k, v in delay_counts.items() if pd.notna(k)}
        all_sources.extend(extract_sources(daily_df))

    rfi_delays = 0
    if rfi_df is not None and not rfi_df.empty:
        schedule_col = None
        for c in ["schedule_impact", "Schedule Impact (Estimated Range)"]:
            if c in rfi_df.columns:
                schedule_col = c
                break
        if schedule_col:
            rfi_delays = len(rfi_df[rfi_df[schedule_col].astype(str).str.lower() != "none"])
        all_sources.extend(extract_sources(rfi_df))

    dc_delays = 0
    if dc_df is not None and not dc_df.empty:
        sched_col = None
        for c in ["schedule_impact", "Schedule Impact (ASI)"]:
            if c in dc_df.columns:
                sched_col = c
                break
        if sched_col:
            dc_delays = len(dc_df[dc_df[sched_col].astype(str).str.lower() != "none"])
        all_sources.extend(extract_sources(dc_df))

    blended_rate = safe_numeric(kwargs.get("blended_rate", 65))
    idle_cost = total_disruption_hours * blended_rate

    return make_result(
        {
            "total_disruption_cost": total_disruption_cost,
            "total_disruption_hours": total_disruption_hours,
            "estimated_idle_cost": round(idle_cost, 0),
            "rfis_with_schedule_impact": rfi_delays,
            "design_changes_with_schedule_impact": dc_delays,
            "delay_categories_from_daily": delay_categories,
            "by_disruption_cause": by_cause,
        },
        "Delay Cost = SUM(Disruption Cost) + (Disruption Hours * Blended Rate) by cause category",
        warnings=warnings,
        sources=sorted(set(all_sources)),
        data_coverage=cov,
        confidence=confidence_level(cov),
    )

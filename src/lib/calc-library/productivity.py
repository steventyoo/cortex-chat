"""Crew and foreman productivity calculations."""

from common import safe_numeric, pct, extract_sources, df_coverage, make_result, numeric_col, confidence_level
import pandas as pd


def foreman_gap(prod_df, jcr_df=None, **kwargs):
    """Rank foremen/crews by production rates and quantify the gap."""
    warnings = []
    cov = {}
    cov.update(df_coverage("production", prod_df))
    cov.update(df_coverage("jcr", jcr_df))

    if prod_df is None or prod_df.empty:
        return make_result({"error": "No production data"}, "N/A", warnings=["No production data"], data_coverage=cov, confidence="low")

    prod = prod_df.copy()
    prod["rate"] = numeric_col(prod, "production_rate")
    prod["hours"] = numeric_col(prod, "total_labor_hours")

    crew_col = None
    for c in ["foreman_name", "Foreman Name", "crew_id", "Crew ID / Crew Name"]:
        if c in prod.columns:
            crew_col = c
            break
    if not crew_col:
        crew_col = "source_file"
        warnings.append("No foreman/crew column found; grouping by source_file")

    activity_col = None
    for c in ["activity_type", "Activity Type"]:
        if c in prod.columns:
            activity_col = c
            break

    group_cols = [crew_col]
    if activity_col:
        group_cols.append(activity_col)

    grouped = prod.groupby(group_cols).agg(
        avg_rate=("rate", "mean"),
        total_hours=("hours", "sum"),
        record_count=("rate", "size"),
    ).round(2).reset_index()

    if activity_col:
        best_by_activity = grouped.loc[grouped.groupby(activity_col)["avg_rate"].idxmax()]
        best_rates = dict(zip(best_by_activity[activity_col], best_by_activity["avg_rate"]))
        grouped["best_rate"] = grouped[activity_col].map(best_rates)
    else:
        best_rate = grouped["avg_rate"].max()
        grouped["best_rate"] = best_rate

    grouped["gap_pct"] = grouped.apply(
        lambda r: round(pct(r["best_rate"] - r["avg_rate"], r["best_rate"]), 1) if r["best_rate"] > 0 else 0,
        axis=1
    )
    grouped = grouped.sort_values("gap_pct", ascending=False)

    return make_result(
        {"crews": grouped.to_dict("records")},
        "Gap % = (Best Rate - This Rate) / Best Rate * 100 per activity",
        warnings=warnings,
        sources=extract_sources(prod_df),
        data_coverage=cov,
        confidence=confidence_level(cov),
    )


def overtime_impact(prod_df, jcr_df=None, **kwargs):
    """Detect overtime patterns and quantify cost impact."""
    warnings = []
    cov = {}
    cov.update(df_coverage("production", prod_df))
    cov.update(df_coverage("jcr", jcr_df))

    if prod_df is None or prod_df.empty:
        return make_result({"error": "No production data"}, "N/A", warnings=["No production data"], data_coverage=cov, confidence="low")

    prod = prod_df.copy()
    prod["hours"] = numeric_col(prod, "total_labor_hours")
    prod["rate"] = numeric_col(prod, "production_rate")

    ot_col = None
    for c in ["overtime_shift", "Overtime / Shift", "hours_by_type"]:
        if c in prod.columns:
            ot_col = c
            break

    activity_col = None
    for c in ["activity_type", "Activity Type"]:
        if c in prod.columns:
            activity_col = c
            break

    trend_col = None
    for c in ["productivity_trend", "Productivity Trend (7-day)"]:
        if c in prod.columns:
            trend_col = c
            break

    total_hours = float(prod["hours"].sum())

    if ot_col:
        ot_records = prod[prod[ot_col].astype(str).str.lower().str.contains("ot|overtime|double")]
        ot_hours = float(numeric_col(ot_records, "total_labor_hours").sum())
    else:
        ot_hours = 0
        warnings.append("No overtime column found; cannot separate OT hours")

    ot_pct = pct(ot_hours, total_hours)
    ot_premium_rate = safe_numeric(kwargs.get("ot_premium_rate", 1.5))
    ot_premium_cost = ot_hours * (ot_premium_rate - 1.0) * safe_numeric(kwargs.get("blended_rate", 65))

    by_activity = None
    if activity_col:
        grp = prod.groupby(activity_col).agg(
            total_hours=("hours", "sum"),
            avg_rate=("rate", "mean"),
            record_count=("hours", "size"),
        ).round(2).reset_index()
        grp = grp.sort_values("total_hours", ascending=False)
        by_activity = grp.to_dict("records")

    return make_result(
        {
            "total_hours": total_hours,
            "ot_hours": ot_hours,
            "ot_pct": round(ot_pct, 1),
            "estimated_ot_premium_cost": round(ot_premium_cost, 0),
            "by_activity": by_activity,
        },
        "OT Premium = OT Hours * (Premium Rate - 1.0) * Blended Rate",
        warnings=warnings,
        sources=extract_sources(prod_df),
        data_coverage=cov,
        confidence=confidence_level(cov),
    )


def crew_optimization(prod_df, jcr_df=None, **kwargs):
    """Find optimal crew compositions by activity type."""
    warnings = []
    cov = {}
    cov.update(df_coverage("production", prod_df))
    cov.update(df_coverage("jcr", jcr_df))

    if prod_df is None or prod_df.empty:
        return make_result({"error": "No production data"}, "N/A", warnings=["No production data"], data_coverage=cov, confidence="low")

    prod = prod_df.copy()
    prod["rate"] = numeric_col(prod, "production_rate")
    prod["hours"] = numeric_col(prod, "total_labor_hours")

    crew_col = None
    for c in ["crew_composition", "Crew Composition"]:
        if c in prod.columns:
            crew_col = c
            break
    if not crew_col:
        return make_result({"error": "No crew_composition column"}, "N/A", warnings=["No crew_composition column"], data_coverage=cov, confidence="low")

    activity_col = None
    for c in ["activity_type", "Activity Type"]:
        if c in prod.columns:
            activity_col = c
            break

    group_cols = [crew_col]
    if activity_col:
        group_cols = [activity_col, crew_col]

    grouped = prod.groupby(group_cols).agg(
        avg_rate=("rate", "mean"),
        total_hours=("hours", "sum"),
        record_count=("rate", "size"),
    ).round(2).reset_index()
    grouped = grouped.sort_values("avg_rate", ascending=False)

    return make_result(
        {"compositions": grouped.to_dict("records")},
        "Best crew = highest production rate per activity type",
        warnings=warnings,
        sources=extract_sources(prod_df),
        data_coverage=cov,
        confidence=confidence_level(cov),
    )


def apprentice_ratio_impact(prod_df, jcr_df=None, **kwargs):
    """Analyze how apprentice-to-journeyman ratios affect productivity."""
    warnings = []
    cov = {}
    cov.update(df_coverage("production", prod_df))
    cov.update(df_coverage("jcr", jcr_df))

    if prod_df is None or prod_df.empty:
        return make_result({"error": "No production data"}, "N/A", warnings=["No production data"], data_coverage=cov, confidence="low")

    prod = prod_df.copy()
    prod["rate"] = numeric_col(prod, "production_rate")
    prod["efficiency"] = numeric_col(prod, "cumulative_production_efficiency")

    crew_col = None
    for c in ["crew_composition", "Crew Composition"]:
        if c in prod.columns:
            crew_col = c
            break
    if not crew_col:
        return make_result({"error": "No crew_composition column"}, "N/A", warnings=["Missing crew data"], data_coverage=cov, confidence="low")

    prod["apprentice_pct"] = prod[crew_col].apply(_parse_apprentice_pct)

    bins = [0, 20, 40, 60, 80, 100]
    labels = ["0-20%", "20-40%", "40-60%", "60-80%", "80-100%"]
    prod["ratio_bucket"] = pd.cut(prod["apprentice_pct"], bins=bins, labels=labels, include_lowest=True)

    by_bucket = prod.groupby("ratio_bucket", observed=True).agg(
        avg_rate=("rate", "mean"),
        avg_efficiency=("efficiency", "mean"),
        record_count=("rate", "size"),
    ).round(2).reset_index()

    return make_result(
        {"by_ratio_bucket": by_bucket.to_dict("records")},
        "Group by apprentice % buckets, compare avg production rate",
        warnings=warnings,
        sources=extract_sources(prod_df),
        data_coverage=cov,
        confidence=confidence_level(cov),
    )


def _parse_apprentice_pct(comp_str):
    """Extract apprentice percentage from crew composition string."""
    if not comp_str or not isinstance(comp_str, str):
        return 0
    s = comp_str.lower()
    import re
    app_match = re.search(r"(\d+)\s*(?:apprentice|app)", s)
    jour_match = re.search(r"(\d+)\s*(?:journeyman|jour|jw)", s)
    if app_match and jour_match:
        app = int(app_match.group(1))
        jour = int(jour_match.group(1))
        total = app + jour
        return (app / total * 100) if total > 0 else 0
    return 0


def mobilization_cost(prod_df, estimate_df=None, **kwargs):
    """Quantify travel/mobilization time as % of total labor cost."""
    warnings = []
    cov = {}
    cov.update(df_coverage("production", prod_df))
    cov.update(df_coverage("estimate", estimate_df))

    if prod_df is None or prod_df.empty:
        return make_result({"error": "No production data"}, "N/A", warnings=["No production data"], data_coverage=cov, confidence="low")

    prod = prod_df.copy()
    prod["hours"] = numeric_col(prod, "total_labor_hours")

    mob_col = None
    for c in ["mobilization_event", "Mobilization Event"]:
        if c in prod.columns:
            mob_col = c
            break

    mob_cost_col = None
    for c in ["mobilization_cost", "Mobilization Cost"]:
        if c in prod.columns:
            mob_cost_col = c
            break

    total_hours = float(prod["hours"].sum())
    blended_rate = safe_numeric(kwargs.get("blended_rate", 65))
    total_labor_cost = total_hours * blended_rate

    if mob_cost_col:
        total_mob_cost = float(numeric_col(prod, mob_cost_col).sum())
    elif mob_col:
        mob_records = prod[prod[mob_col].astype(str).str.lower().str.contains("mob|travel|transit")]
        mob_hours = float(numeric_col(mob_records, "total_labor_hours").sum())
        total_mob_cost = mob_hours * blended_rate
    else:
        total_mob_cost = 0
        warnings.append("No mobilization column found; cannot calculate mob cost")

    mob_pct = pct(total_mob_cost, total_labor_cost) if total_labor_cost else 0

    gross_sf = 0
    if estimate_df is not None and not estimate_df.empty:
        gross_sf = safe_numeric(estimate_df.iloc[0].get("gross_square_footage") or estimate_df.iloc[0].get("Gross Square Footage"))

    return make_result(
        {
            "total_labor_cost": round(total_labor_cost, 0),
            "mobilization_cost": round(total_mob_cost, 0),
            "mob_pct_of_labor": round(mob_pct, 1),
            "gross_sf": gross_sf,
            "mob_cost_per_sf": round(total_mob_cost / gross_sf, 2) if gross_sf > 0 else 0,
        },
        "Mob % = Mobilization Cost / Total Labor Cost * 100",
        warnings=warnings,
        sources=extract_sources(prod_df),
        data_coverage=cov,
        confidence=confidence_level(cov),
    )

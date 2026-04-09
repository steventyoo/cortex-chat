"""Bid accuracy and variance analysis."""

from common import safe_numeric, pct, extract_sources, df_coverage, make_result, numeric_col, confidence_level
import pandas as pd


def bid_accuracy(estimate_df, jcr_df, **kwargs):
    """Compare bid estimates to actual costs segmented by project type."""
    warnings = []
    cov = {}
    cov.update(df_coverage("estimate", estimate_df))
    cov.update(df_coverage("jcr", jcr_df))

    if estimate_df is None or estimate_df.empty:
        return make_result({"error": "No estimate data"}, "N/A", warnings=["No estimate data"], data_coverage=cov, confidence="low")
    if jcr_df is None or jcr_df.empty:
        return make_result({"error": "No JCR data"}, "N/A", warnings=["No JCR data"], data_coverage=cov, confidence="low")

    est = estimate_df.copy()
    jcr = jcr_df.copy()

    est["bid_amount"] = numeric_col(est, "total_bid_amount")
    jcr["jtd_cost"] = numeric_col(jcr, "total_jtd_cost")
    jcr["revised_budget"] = numeric_col(jcr, "total_revised_budget")

    type_col = None
    for c in ["project_type", "Project Type"]:
        if c in est.columns:
            type_col = c
            break

    rows = []
    for _, e_row in est.iterrows():
        bid = safe_numeric(e_row.get("bid_amount"))
        if bid == 0:
            continue
        pid = e_row.get("project_id") or e_row.get("source_file")
        jcr_match = jcr[jcr.get("project_id", pd.Series()) == pid] if "project_id" in jcr.columns and "project_id" in est.columns else pd.DataFrame()

        actual = 0
        if not jcr_match.empty:
            actual = safe_numeric(jcr_match.iloc[0].get("jtd_cost"))
        elif len(jcr) == 1:
            actual = safe_numeric(jcr.iloc[0].get("jtd_cost"))

        if actual == 0:
            continue

        accuracy = 1 - abs(actual - bid) / bid
        variance_pct = ((actual - bid) / bid) * 100

        rows.append({
            "project": str(pid),
            "project_type": e_row.get(type_col, "Unknown") if type_col else "Unknown",
            "bid_amount": bid,
            "actual_cost": actual,
            "variance_dollar": actual - bid,
            "variance_pct": round(variance_pct, 1),
            "accuracy_score": round(accuracy, 3),
        })

    if not rows:
        warnings.append("Could not match any estimates to actuals")
        return make_result({"error": "No matched data"}, "N/A", warnings=warnings, data_coverage=cov, confidence="low")

    result_df = pd.DataFrame(rows)

    by_type = result_df.groupby("project_type").agg(
        count=("accuracy_score", "size"),
        avg_accuracy=("accuracy_score", "mean"),
        avg_variance_pct=("variance_pct", "mean"),
        total_variance=("variance_dollar", "sum"),
    ).round(2).reset_index()
    by_type = by_type.sort_values("avg_accuracy", ascending=False)

    return make_result(
        {
            "projects": rows,
            "by_type": by_type.to_dict("records"),
            "overall_accuracy": round(result_df["accuracy_score"].mean(), 3),
            "overall_variance_pct": round(result_df["variance_pct"].mean(), 1),
        },
        "Accuracy = 1 - |Actual - Bid| / Bid; Variance % = (Actual - Bid) / Bid * 100",
        warnings=warnings,
        sources=extract_sources(estimate_df) + extract_sources(jcr_df),
        data_coverage=cov,
        confidence=confidence_level(cov),
    )


def labor_hour_variance(prod_df, jcr_df=None, estimate_df=None, **kwargs):
    """Compare estimated vs actual labor hours by phase/activity."""
    warnings = []
    cov = {}
    cov.update(df_coverage("production", prod_df))
    cov.update(df_coverage("jcr", jcr_df))
    cov.update(df_coverage("estimate", estimate_df))

    if prod_df is None or prod_df.empty:
        return make_result({"error": "No production data"}, "N/A", warnings=["No production data"], data_coverage=cov, confidence="low")

    prod = prod_df.copy()
    prod["actual_hours"] = numeric_col(prod, "total_labor_hours")
    prod["est_rate"] = numeric_col(prod, "estimated_production_rate")
    prod["actual_rate"] = numeric_col(prod, "production_rate")

    activity_col = None
    for c in ["activity_type", "Activity Type", "work_phase"]:
        if c in prod.columns:
            activity_col = c
            break
    if not activity_col:
        activity_col = "activity_type"
        prod[activity_col] = "All"

    by_activity = prod.groupby(activity_col).agg(
        total_actual_hours=("actual_hours", "sum"),
        avg_production_rate=("actual_rate", "mean"),
        avg_estimated_rate=("est_rate", "mean"),
        record_count=("actual_hours", "size"),
    ).round(2).reset_index()

    by_activity["rate_variance_pct"] = by_activity.apply(
        lambda r: round(pct(r["avg_production_rate"] - r["avg_estimated_rate"], r["avg_estimated_rate"]), 1)
        if r["avg_estimated_rate"] != 0 else 0,
        axis=1
    )
    by_activity = by_activity.sort_values("rate_variance_pct")

    return make_result(
        {
            "by_activity": by_activity.to_dict("records"),
            "total_hours": float(prod["actual_hours"].sum()),
        },
        "Rate Variance % = (Actual Rate - Estimated Rate) / Estimated Rate * 100",
        warnings=warnings,
        sources=extract_sources(prod_df),
        data_coverage=cov,
        confidence=confidence_level(cov),
    )


def material_escalation(estimate_df, jcr_df, **kwargs):
    """Track material cost changes between bid and actual by CSI division."""
    warnings = []
    cov = {}
    cov.update(df_coverage("estimate", estimate_df))
    cov.update(df_coverage("jcr", jcr_df))

    if jcr_df is None or jcr_df.empty:
        return make_result({"error": "No JCR data"}, "N/A", warnings=["No JCR data"], data_coverage=cov, confidence="low")

    jcr = jcr_df.copy()

    div_col = None
    for c in ["csi_division", "CSI Division (Primary) — JCR", "csi_division_primary"]:
        if c in jcr.columns:
            div_col = c
            break

    mat_var_col = None
    for c in ["material_price_variance", "Material Price Variance"]:
        if c in jcr.columns:
            mat_var_col = c
            break

    if not mat_var_col:
        warnings.append("No material_price_variance column in JCR data")
        return make_result({"error": "No material variance data"}, "N/A", warnings=warnings, data_coverage=cov, confidence="low")

    jcr["mat_variance"] = numeric_col(jcr, mat_var_col)

    if div_col:
        by_div = jcr.groupby(div_col).agg(
            total_variance=("mat_variance", "sum"),
            line_count=("mat_variance", "size"),
            avg_variance=("mat_variance", "mean"),
        ).round(0).reset_index()
        by_div = by_div.sort_values("total_variance", ascending=False)
        by_div_list = by_div.to_dict("records")
    else:
        by_div_list = []
        warnings.append("No CSI division column; showing total only")

    return make_result(
        {
            "total_material_variance": float(jcr["mat_variance"].sum()),
            "by_division": by_div_list,
        },
        "Material Escalation = SUM(Material Price Variance) by CSI Division",
        warnings=warnings,
        sources=extract_sources(jcr_df),
        data_coverage=cov,
        confidence=confidence_level(cov),
    )

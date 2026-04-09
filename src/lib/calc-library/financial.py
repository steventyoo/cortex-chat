"""Financial profitability calculations."""

from common import safe_numeric, safe_currency, pct, delta, extract_sources, df_coverage, make_result, numeric_col, confidence_level
import pandas as pd


def project_profitability(jcr_df, co_df=None, prod_df=None, admin_df=None, estimate_df=None, **kwargs):
    """True project profitability including hidden costs."""
    warnings = []
    cov = {}
    all_sources = []
    cov.update(df_coverage("jcr", jcr_df))
    cov.update(df_coverage("change_orders", co_df))
    cov.update(df_coverage("production", prod_df))
    cov.update(df_coverage("project_admin", admin_df))
    cov.update(df_coverage("estimate", estimate_df))
    all_sources.extend(extract_sources(jcr_df))

    if jcr_df is None or jcr_df.empty:
        return make_result(
            {"error": "No JCR data available"},
            "N/A", warnings=["No JCR data"], data_coverage=cov, confidence="low"
        )

    total_revised_budget = safe_numeric(jcr_df.iloc[0].get("total_revised_budget"))
    total_jtd_cost = safe_numeric(jcr_df.iloc[0].get("total_jtd_cost"))
    total_over_under = safe_numeric(jcr_df.iloc[0].get("total_over_under_budget"))
    estimated_margin = safe_numeric(jcr_df.iloc[0].get("estimated_margin_at_completion"))
    total_cos = safe_numeric(jcr_df.iloc[0].get("total_change_orders"))
    net_job_profit = safe_numeric(jcr_df.iloc[0].get("net_job_profit") or jcr_df.iloc[0].get("net_job_profit_raw"))
    ar_total = safe_numeric(jcr_df.iloc[0].get("ar_total") or jcr_df.iloc[0].get("ar_total_raw"))
    ap_total = safe_numeric(jcr_df.iloc[0].get("ap_total") or jcr_df.iloc[0].get("ap_total_raw"))

    if not total_jtd_cost and ap_total:
        total_jtd_cost = ap_total
        warnings.append("Used ap_total as proxy for total_jtd_cost")

    if not total_revised_budget and ar_total:
        total_revised_budget = ar_total
        warnings.append("Used ar_total as proxy for total_revised_budget (contract revenue)")

    contract_value = 0
    if estimate_df is not None and not estimate_df.empty:
        contract_value = safe_numeric(estimate_df.iloc[0].get("contract_amount") or estimate_df.iloc[0].get("total_bid_amount"))
        all_sources.extend(extract_sources(estimate_df))

    if net_job_profit and not total_revised_budget:
        total_revised_budget = total_jtd_cost + net_job_profit
        warnings.append("Derived total_revised_budget from total_jtd_cost + net_job_profit")

    headline_margin = net_job_profit if net_job_profit else (delta(total_revised_budget, total_jtd_cost) if total_revised_budget else 0)
    headline_margin_pct = pct(headline_margin, total_revised_budget) if total_revised_budget else 0

    co_shrinkage = 0
    if co_df is not None and not co_df.empty:
        proposed = numeric_col(co_df, "gc_proposed_amount")
        approved = numeric_col(co_df, "owner_approved_amount")
        co_shrinkage = float(proposed.sum() - approved.sum())
        all_sources.extend(extract_sources(co_df))

    rework_cost = 0
    disruption_cost = 0
    if prod_df is not None and not prod_df.empty:
        rework_cost = float(numeric_col(prod_df, "rework_cost").sum())
        disruption_cost = float(numeric_col(prod_df, "disruption_cost").sum())
        all_sources.extend(extract_sources(prod_df))

    backcharge_cost = 0
    if admin_df is not None and not admin_df.empty:
        backcharge_cost = float(numeric_col(admin_df, "back_charges_amount").sum())
        all_sources.extend(extract_sources(admin_df))

    total_hidden = co_shrinkage + rework_cost + disruption_cost + backcharge_cost
    true_profit = headline_margin - total_hidden
    true_margin_pct = pct(true_profit, total_revised_budget) if total_revised_budget else 0

    result = {
        "contract_value": contract_value,
        "total_revised_budget": total_revised_budget,
        "total_jtd_cost": total_jtd_cost,
        "headline_margin": headline_margin,
        "headline_margin_pct": round(headline_margin_pct, 1),
        "co_shrinkage": co_shrinkage,
        "rework_cost": rework_cost,
        "disruption_cost": disruption_cost,
        "backcharge_cost": backcharge_cost,
        "total_hidden_costs": total_hidden,
        "true_profit": true_profit,
        "true_margin_pct": round(true_margin_pct, 1),
    }

    intermediates = {
        "total_change_orders": total_cos,
        "estimated_margin_at_completion": estimated_margin,
        "total_over_under_budget": total_over_under,
    }

    conf = confidence_level(cov)
    if total_revised_budget == 0:
        warnings.append("Total revised budget is zero — profitability cannot be calculated")
        conf = "low"

    return make_result(
        result,
        "True Profit = (Revised Budget - JTD Cost) - (CO Shrinkage + Rework + Disruption + Back-charges)",
        intermediates=intermediates,
        warnings=warnings,
        sources=sorted(set(all_sources)),
        data_coverage=cov,
        confidence=conf,
    )


def project_type_margin(estimate_df, jcr_df, **kwargs):
    """Compare profitability across project types."""
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

    type_col = None
    for c in ["project_type", "Project Type"]:
        if c in est.columns:
            type_col = c
            break
    if not type_col:
        return make_result({"error": "No project_type column in estimate data"}, "N/A", warnings=["Missing project_type column"], data_coverage=cov, confidence="low")

    est["bid_amount"] = numeric_col(est, "total_bid_amount")
    jcr["margin"] = numeric_col(jcr, "estimated_margin_at_completion")
    jcr["budget"] = numeric_col(jcr, "total_revised_budget")

    merged = est.merge(jcr[["source_file", "margin", "budget"]].drop_duplicates(), on="source_file", how="inner") if "source_file" in est.columns and "source_file" in jcr.columns else pd.DataFrame()

    if merged.empty:
        warnings.append("Could not match estimates to JCR records. Returning estimate-only view.")
        grouped = est.groupby(type_col).agg(
            project_count=("bid_amount", "size"),
            avg_bid=("bid_amount", "mean"),
            total_bid=("bid_amount", "sum"),
        ).round(0).reset_index()
        grouped.columns = ["project_type", "project_count", "avg_bid", "total_bid"]
        return make_result(
            {"by_type": grouped.to_dict("records")},
            "Grouped by project_type from estimate data",
            warnings=warnings,
            sources=extract_sources(est),
            data_coverage=cov,
            confidence="low",
        )

    merged["margin_pct"] = merged.apply(lambda r: pct(r["margin"], r["budget"]), axis=1)

    grouped = merged.groupby(type_col).agg(
        project_count=("bid_amount", "size"),
        avg_bid=("bid_amount", "mean"),
        total_revenue=("bid_amount", "sum"),
        avg_margin_pct=("margin_pct", "mean"),
    ).round(1).reset_index()
    grouped.columns = ["project_type", "project_count", "avg_bid", "total_revenue", "avg_margin_pct"]
    grouped = grouped.sort_values("avg_margin_pct", ascending=False)

    return make_result(
        {"by_type": grouped.to_dict("records")},
        "Avg Margin % = mean(Estimated Margin at Completion / Revised Budget * 100) by project type",
        sources=extract_sources(est) + extract_sources(jcr),
        data_coverage=cov,
        confidence=confidence_level(cov),
    )


def gc_profitability_score(co_df, admin_df, contract_df=None, jcr_df=None, **kwargs):
    """Score GCs by true profitability: margin minus hidden costs."""
    warnings = []
    cov = {}
    cov.update(df_coverage("change_orders", co_df))
    cov.update(df_coverage("project_admin", admin_df))
    cov.update(df_coverage("contract", contract_df))
    cov.update(df_coverage("jcr", jcr_df))

    if co_df is None or co_df.empty:
        return make_result({"error": "No CO data"}, "N/A", warnings=["No CO data"], data_coverage=cov, confidence="low")

    co = co_df.copy()
    co["proposed"] = numeric_col(co, "gc_proposed_amount")
    co["approved"] = numeric_col(co, "owner_approved_amount")
    co["shrinkage"] = co["proposed"] - co["approved"]

    gc_col = None
    for c in ["gc_name", "GC Name", "project_id"]:
        if c in co.columns:
            gc_col = c
            break
    if not gc_col:
        gc_col = "project_id"
        if gc_col not in co.columns:
            return make_result({"error": "No GC identifier column"}, "N/A", warnings=["No gc_name or project_id column"], data_coverage=cov, confidence="low")

    gc_scores = co.groupby(gc_col).agg(
        co_count=("proposed", "size"),
        total_proposed=("proposed", "sum"),
        total_approved=("approved", "sum"),
        total_shrinkage=("shrinkage", "sum"),
    ).reset_index()

    gc_scores["approval_rate_pct"] = gc_scores.apply(
        lambda r: round(pct(r["total_approved"], r["total_proposed"]), 1), axis=1
    )
    gc_scores = gc_scores.sort_values("total_shrinkage", ascending=False)
    gc_scores.columns = [gc_col, "co_count", "total_proposed", "total_approved", "total_shrinkage", "approval_rate_pct"]

    return make_result(
        {"gc_scores": gc_scores.to_dict("records")},
        "GC Score = Approval Rate (Approved / Proposed) and Total Shrinkage (Proposed - Approved)",
        sources=extract_sources(co),
        data_coverage=cov,
        confidence=confidence_level(cov),
    )

"""Change order analysis and recovery calculations."""

from common import safe_numeric, pct, extract_sources, df_coverage, make_result, numeric_col, confidence_level
import pandas as pd


def unbilled_recovery(co_df, dc_df=None, admin_df=None, **kwargs):
    """Identify approved COs not yet billed and unconverted design changes."""
    warnings = []
    cov = {}
    cov.update(df_coverage("change_orders", co_df))
    cov.update(df_coverage("design_changes", dc_df))
    cov.update(df_coverage("project_admin", admin_df))

    if co_df is None or co_df.empty:
        return make_result({"error": "No CO data"}, "N/A", warnings=["No CO data"], data_coverage=cov, confidence="low")

    co = co_df.copy()
    co["proposed"] = numeric_col(co, "gc_proposed_amount")
    co["approved"] = numeric_col(co, "owner_approved_amount")
    co["neg_delta"] = co["proposed"] - co["approved"]

    total_proposed = float(co["proposed"].sum())
    total_approved = float(co["approved"].sum())
    total_shrinkage = float(co["neg_delta"].sum())

    missed_revenue = 0
    unconverted_count = 0
    if dc_df is not None and not dc_df.empty:
        dc = dc_df.copy()
        conv_col = None
        for c in ["conversion_rate_flag", "Conversion Rate Flag"]:
            if c in dc.columns:
                conv_col = c
                break
        if conv_col:
            unconverted = dc[dc[conv_col].astype(str).str.lower().isin(["false", "no", "0"])]
            unconverted_count = len(unconverted)
            missed_revenue = float(numeric_col(unconverted, "estimated_missed_revenue").sum())

    result = {
        "total_proposed": total_proposed,
        "total_approved": total_approved,
        "total_shrinkage": total_shrinkage,
        "approval_rate_pct": round(pct(total_approved, total_proposed), 1),
        "unconverted_design_changes": unconverted_count,
        "estimated_missed_revenue": missed_revenue,
        "total_recovery_opportunity": total_shrinkage + missed_revenue,
    }

    return make_result(
        result,
        "Recovery = CO Shrinkage (Proposed - Approved) + Missed Revenue from unconverted design changes",
        sources=extract_sources(co_df) + extract_sources(dc_df),
        data_coverage=cov,
        confidence=confidence_level(cov),
    )


def co_approval_rate(co_df, dc_df=None, **kwargs):
    """Analyze CO approval rates and negotiation patterns by GC."""
    warnings = []
    cov = {}
    cov.update(df_coverage("change_orders", co_df))
    cov.update(df_coverage("design_changes", dc_df))

    if co_df is None or co_df.empty:
        return make_result({"error": "No CO data"}, "N/A", warnings=["No CO data"], data_coverage=cov, confidence="low")

    co = co_df.copy()
    co["proposed"] = numeric_col(co, "gc_proposed_amount")
    co["approved"] = numeric_col(co, "owner_approved_amount")
    co["neg_delta"] = numeric_col(co, "negotiation_delta")

    gc_col = None
    for c in ["gc_name", "GC Name", "project_id"]:
        if c in co.columns:
            gc_col = c
            break
    if not gc_col:
        gc_col = "project_id"
        if gc_col not in co.columns:
            co[gc_col] = "All"

    reason_col = None
    for c in ["change_reason", "Change Reason (Root Cause)"]:
        if c in co.columns:
            reason_col = c
            break

    by_gc = co.groupby(gc_col).agg(
        co_count=("proposed", "size"),
        total_proposed=("proposed", "sum"),
        total_approved=("approved", "sum"),
    ).reset_index()
    by_gc["approval_rate_pct"] = by_gc.apply(
        lambda r: round(pct(r["total_approved"], r["total_proposed"]), 1), axis=1
    )
    by_gc["avg_shrinkage_pct"] = by_gc.apply(
        lambda r: round(100 - pct(r["total_approved"], r["total_proposed"]), 1), axis=1
    )
    by_gc = by_gc.sort_values("approval_rate_pct")

    by_reason = None
    if reason_col:
        by_reason = co.groupby(reason_col).agg(
            count=("proposed", "size"),
            total_proposed=("proposed", "sum"),
            total_approved=("approved", "sum"),
        ).reset_index()
        by_reason["approval_rate_pct"] = by_reason.apply(
            lambda r: round(pct(r["total_approved"], r["total_proposed"]), 1), axis=1
        )
        by_reason = by_reason.sort_values("approval_rate_pct").to_dict("records")

    return make_result(
        {
            "overall_approval_rate_pct": round(pct(co["approved"].sum(), co["proposed"].sum()), 1),
            "by_gc": by_gc.to_dict("records"),
            "by_reason": by_reason,
        },
        "Approval Rate = Total Approved / Total Proposed * 100 by GC",
        sources=extract_sources(co_df),
        data_coverage=cov,
        confidence=confidence_level(cov),
    )


def panic_bid_analysis(estimate_df, jcr_df, contract_df=None, **kwargs):
    """Identify bids driven by market pressure and quantify margin impact."""
    warnings = []
    cov = {}
    cov.update(df_coverage("estimate", estimate_df))
    cov.update(df_coverage("jcr", jcr_df))
    cov.update(df_coverage("contract", contract_df))

    if estimate_df is None or estimate_df.empty:
        return make_result({"error": "No estimate data"}, "N/A", warnings=["No estimate data"], data_coverage=cov, confidence="low")

    est = estimate_df.copy()
    est["bid_amount"] = numeric_col(est, "total_bid_amount")

    fee_col = None
    for c in ["fee_markup_structure", "Fee / Markup Structure", "fee_markup"]:
        if c in est.columns:
            fee_col = c
            break

    mkt_col = None
    for c in ["market_condition", "Market Condition at Bid"]:
        if c in est.columns:
            mkt_col = c
            break

    design_col = None
    for c in ["design_completeness", "Design Completeness at Bid"]:
        if c in est.columns:
            design_col = c
            break

    est["fee_pct"] = numeric_col(est, fee_col) if fee_col else pd.Series([0] * len(est))

    panic_flags = pd.Series([False] * len(est), index=est.index)
    if fee_col:
        median_fee = est["fee_pct"].median()
        if median_fee > 0:
            panic_flags = panic_flags | (est["fee_pct"] < median_fee * 0.7)
    if mkt_col:
        panic_flags = panic_flags | est[mkt_col].astype(str).str.lower().str.contains("hot|competitive|tight")
    if design_col:
        panic_flags = panic_flags | est[design_col].astype(str).str.lower().str.contains("incomplete|partial|schematic")

    est["is_panic"] = panic_flags
    panic_bids = est[est["is_panic"]]
    disciplined_bids = est[~est["is_panic"]]

    if jcr_df is not None and not jcr_df.empty:
        jcr = jcr_df.copy()
        jcr["margin"] = numeric_col(jcr, "estimated_margin_at_completion")
        jcr["budget"] = numeric_col(jcr, "total_revised_budget")
        jcr["margin_pct"] = jcr.apply(lambda r: pct(r["margin"], r["budget"]), axis=1)
        avg_margin_all = float(jcr["margin_pct"].mean())
    else:
        avg_margin_all = 0

    return make_result(
        {
            "total_bids": len(est),
            "panic_bid_count": len(panic_bids),
            "disciplined_bid_count": len(disciplined_bids),
            "panic_pct": round(pct(len(panic_bids), len(est)), 1),
            "avg_panic_fee_pct": round(float(panic_bids["fee_pct"].mean()), 1) if len(panic_bids) > 0 else 0,
            "avg_disciplined_fee_pct": round(float(disciplined_bids["fee_pct"].mean()), 1) if len(disciplined_bids) > 0 else 0,
            "avg_margin_all_projects": round(avg_margin_all, 1),
        },
        "Panic = low fee (<70% of median) OR hot market OR incomplete design",
        warnings=warnings,
        sources=extract_sources(estimate_df),
        data_coverage=cov,
        confidence=confidence_level(cov),
    )

"""Risk scoring and benchmarking calculations."""

from common import safe_numeric, pct, extract_sources, df_coverage, make_result, numeric_col, confidence_level
import pandas as pd


def risk_concentration(contract_df, co_df=None, dc_df=None, **kwargs):
    """Assess revenue concentration with high-risk GCs."""
    warnings = []
    cov = {}
    cov.update(df_coverage("contract", contract_df))
    cov.update(df_coverage("change_orders", co_df))
    cov.update(df_coverage("design_changes", dc_df))

    if contract_df is None or contract_df.empty:
        return make_result({"error": "No contract data"}, "N/A", warnings=["No contract data"], data_coverage=cov, confidence="low")

    contracts = contract_df.copy()
    risk_col = None
    for c in ["risk_score", "Risk Score (1–5)", "Risk Score"]:
        if c in contracts.columns:
            risk_col = c
            break
    if not risk_col:
        return make_result({"error": "No risk_score column"}, "N/A", warnings=["No risk score data"], data_coverage=cov, confidence="low")

    contracts["risk"] = numeric_col(contracts, risk_col)

    gc_col = None
    for c in ["gc_name", "GC Name", "project_id"]:
        if c in contracts.columns:
            gc_col = c
            break
    if not gc_col:
        gc_col = "project_id" if "project_id" in contracts.columns else contracts.columns[0]

    value_col = None
    for c in ["contract_value", "current_contract_value"]:
        if c in contracts.columns:
            value_col = c
            break
    contracts["value"] = numeric_col(contracts, value_col) if value_col else pd.Series([0] * len(contracts))

    total_value = float(contracts["value"].sum())
    high_risk = contracts[contracts["risk"] >= 3]
    high_risk_value = float(high_risk["value"].sum())
    concentration_pct = pct(high_risk_value, total_value) if total_value else 0

    gc_risk = contracts.groupby(gc_col).agg(
        avg_risk=("risk", "mean"),
        total_value=("value", "sum"),
        contract_count=("risk", "size"),
    ).round(1).reset_index()
    gc_risk["pct_of_portfolio"] = gc_risk["total_value"].apply(lambda v: round(pct(v, total_value), 1) if total_value else 0)
    gc_risk["flag"] = gc_risk.apply(lambda r: r["avg_risk"] >= 3 and r["pct_of_portfolio"] >= 30, axis=1)
    gc_risk = gc_risk.sort_values("avg_risk", ascending=False)

    return make_result(
        {
            "total_portfolio_value": total_value,
            "high_risk_value": high_risk_value,
            "concentration_pct": round(concentration_pct, 1),
            "gc_risk": gc_risk.to_dict("records"),
            "alert": concentration_pct > 30,
        },
        "Concentration = Value with Risk >= 3 / Total Portfolio * 100. Alert if > 30%",
        warnings=warnings,
        sources=extract_sources(contract_df),
        data_coverage=cov,
        confidence=confidence_level(cov),
    )


def back_charge_score(co_df, contract_df=None, admin_df=None, **kwargs):
    """Score back-charge defense strength."""
    warnings = []
    cov = {}
    cov.update(df_coverage("change_orders", co_df))
    cov.update(df_coverage("contract", contract_df))
    cov.update(df_coverage("project_admin", admin_df))

    if co_df is None or co_df.empty:
        return make_result({"error": "No CO data"}, "N/A", warnings=["No CO data"], data_coverage=cov, confidence="low")

    co = co_df.copy()
    disputed_col = None
    for c in ["disputed", "Disputed (Y/N) + Outcome"]:
        if c in co.columns:
            disputed_col = c
            break

    total_cos = len(co)
    disputed_count = 0
    if disputed_col:
        disputed_count = len(co[co[disputed_col].astype(str).str.lower().str.contains("yes|y|disputed")])
    dispute_rate = pct(disputed_count, total_cos)

    notice_score = 50
    if admin_df is not None and not admin_df.empty:
        notice_col = None
        for c in ["notice_timeliness", "Notice Timeliness"]:
            if c in admin_df.columns:
                notice_col = c
                break
        if notice_col:
            timely = admin_df[admin_df[notice_col].astype(str).str.lower().str.contains("on time|timely|yes")]
            notice_score = min(100, int(pct(len(timely), len(admin_df))))

    contract_favorability = 50
    if contract_df is not None and not contract_df.empty:
        risk_col = None
        for c in ["risk_score", "Risk Score (1–5)"]:
            if c in contract_df.columns:
                risk_col = c
                break
        if risk_col:
            avg_risk = float(numeric_col(contract_df, risk_col).mean())
            contract_favorability = max(0, min(100, int(100 - avg_risk * 20)))

    defense_score = int(0.4 * notice_score + 0.3 * contract_favorability + 0.3 * (100 - dispute_rate))

    return make_result(
        {
            "total_cos": total_cos,
            "disputed_count": disputed_count,
            "dispute_rate_pct": round(dispute_rate, 1),
            "notice_timeliness_score": notice_score,
            "contract_favorability_score": contract_favorability,
            "defense_score": defense_score,
        },
        "Defense = 0.4 * Notice + 0.3 * Contract Favorability + 0.3 * (100 - Dispute Rate)",
        warnings=warnings,
        sources=extract_sources(co_df),
        data_coverage=cov,
        confidence=confidence_level(cov),
    )


def gc_pm_ranking(co_df, jcr_df=None, rfi_df=None, **kwargs):
    """Rank GC PMs by budget outcomes and coordination quality."""
    warnings = []
    cov = {}
    cov.update(df_coverage("change_orders", co_df))
    cov.update(df_coverage("jcr", jcr_df))
    cov.update(df_coverage("rfi", rfi_df))

    if jcr_df is None or jcr_df.empty:
        return make_result({"error": "No JCR data"}, "N/A", warnings=["No JCR data"], data_coverage=cov, confidence="low")

    jcr = jcr_df.copy()
    jcr["over_under"] = numeric_col(jcr, "total_over_under_budget")

    pm_col = None
    for c in ["gc_pm", "GC PM", "project_id"]:
        if c in jcr.columns:
            pm_col = c
            break
    if not pm_col:
        pm_col = "project_id" if "project_id" in jcr.columns else jcr.columns[0]

    by_pm = jcr.groupby(pm_col).agg(
        project_count=("over_under", "size"),
        avg_over_under=("over_under", "mean"),
        total_over_under=("over_under", "sum"),
    ).round(0).reset_index()
    by_pm = by_pm.sort_values("avg_over_under")
    by_pm.columns = [pm_col, "project_count", "avg_over_under", "total_over_under"]

    return make_result(
        {"pm_rankings": by_pm.to_dict("records")},
        "Rank by avg Over/Under Budget (negative = under budget = good)",
        warnings=warnings,
        sources=extract_sources(jcr_df),
        data_coverage=cov,
        confidence=confidence_level(cov),
    )


def sub_benchmark_score(prod_df, co_df=None, jcr_df=None, rfi_df=None, **kwargs):
    """Benchmark subcontractor performance across multiple dimensions."""
    warnings = []
    cov = {}
    cov.update(df_coverage("production", prod_df))
    cov.update(df_coverage("change_orders", co_df))
    cov.update(df_coverage("jcr", jcr_df))
    cov.update(df_coverage("rfi", rfi_df))

    if prod_df is None or prod_df.empty:
        return make_result({"error": "No production data"}, "N/A", warnings=["No production data"], data_coverage=cov, confidence="low")

    prod = prod_df.copy()
    prod["rate"] = numeric_col(prod, "production_rate")
    prod["rework"] = numeric_col(prod, "rework_cost")

    div_col = None
    for c in ["csi_division", "CSI Division"]:
        if c in prod.columns:
            div_col = c
            break
    if not div_col:
        div_col = "source_file"

    by_div = prod.groupby(div_col).agg(
        avg_rate=("rate", "mean"),
        total_rework=("rework", "sum"),
        record_count=("rate", "size"),
    ).round(2).reset_index()

    best_rate = by_div["avg_rate"].max() if not by_div.empty else 1
    by_div["productivity_score"] = by_div["avg_rate"].apply(lambda r: round(min(100, (r / best_rate) * 100), 0) if best_rate > 0 else 0)
    max_rework = by_div["total_rework"].max() if not by_div.empty else 1
    by_div["quality_score"] = by_div["total_rework"].apply(lambda r: round(max(0, 100 - (r / max_rework * 100)), 0) if max_rework > 0 else 100)
    w = kwargs.get("weights", {"productivity": 0.5, "quality": 0.5})
    by_div["overall_score"] = (by_div["productivity_score"] * w.get("productivity", 0.5) + by_div["quality_score"] * w.get("quality", 0.5)).round(0)
    by_div = by_div.sort_values("overall_score", ascending=False)

    return make_result(
        {"benchmarks": by_div.to_dict("records")},
        "Score = productivity_weight * (rate/best_rate*100) + quality_weight * (100 - rework/max_rework*100)",
        warnings=warnings,
        sources=extract_sources(prod_df),
        data_coverage=cov,
        confidence=confidence_level(cov),
    )


def bid_sweet_spot(estimate_df, jcr_df=None, **kwargs):
    """Find optimal project size/type for highest win rate and margin."""
    warnings = []
    cov = {}
    cov.update(df_coverage("estimate", estimate_df))
    cov.update(df_coverage("jcr", jcr_df))

    if estimate_df is None or estimate_df.empty:
        return make_result({"error": "No estimate data"}, "N/A", warnings=["No estimate data"], data_coverage=cov, confidence="low")

    est = estimate_df.copy()
    est["bid_amount"] = numeric_col(est, "total_bid_amount")

    result_col = None
    for c in ["bid_result", "Bid Result"]:
        if c in est.columns:
            result_col = c
            break
    if not result_col:
        return make_result({"error": "No bid_result column"}, "N/A", warnings=["No bid_result column"], data_coverage=cov, confidence="low")

    type_col = None
    for c in ["project_type", "Project Type"]:
        if c in est.columns:
            type_col = c
            break

    est["won"] = est[result_col].astype(str).str.lower().str.contains("win|won|award")

    size_bins = [0, 500_000, 1_000_000, 5_000_000, 10_000_000, float("inf")]
    size_labels = ["<$500K", "$500K-$1M", "$1M-$5M", "$5M-$10M", ">$10M"]
    est["size_range"] = pd.cut(est["bid_amount"], bins=size_bins, labels=size_labels, include_lowest=True)

    by_size = est.groupby("size_range", observed=True).agg(
        total_bids=("won", "size"),
        wins=("won", "sum"),
    ).reset_index()
    by_size["win_rate_pct"] = by_size.apply(lambda r: round(pct(r["wins"], r["total_bids"]), 1), axis=1)

    by_type = None
    if type_col:
        by_type = est.groupby(type_col).agg(
            total_bids=("won", "size"),
            wins=("won", "sum"),
            avg_bid=("bid_amount", "mean"),
        ).round(0).reset_index()
        by_type["win_rate_pct"] = by_type.apply(lambda r: round(pct(r["wins"], r["total_bids"]), 1), axis=1)
        by_type = by_type.sort_values("win_rate_pct", ascending=False).to_dict("records")

    total_bids = len(est)
    total_wins = int(est["won"].sum())

    return make_result(
        {
            "total_bids": total_bids,
            "total_wins": total_wins,
            "overall_win_rate_pct": round(pct(total_wins, total_bids), 1),
            "by_size": by_size.to_dict("records"),
            "by_type": by_type,
        },
        "Sweet Spot = size range × project type with highest Win Rate AND margin",
        warnings=warnings,
        sources=extract_sources(estimate_df),
        data_coverage=cov,
        confidence=confidence_level(cov),
    )

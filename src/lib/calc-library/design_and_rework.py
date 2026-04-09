"""Design change, rework, and VE tracking calculations."""

from common import safe_numeric, pct, extract_sources, df_coverage, make_result, numeric_col, confidence_level
import pandas as pd


def design_change_cost_rollup(dc_df, co_df=None, prod_df=None, rfi_df=None, **kwargs):
    """Trace full cost of design changes through RFI→ASI→CO pipeline."""
    warnings = []
    cov = {}
    cov.update(df_coverage("design_changes", dc_df))
    cov.update(df_coverage("change_orders", co_df))
    cov.update(df_coverage("production", prod_df))
    cov.update(df_coverage("rfi", rfi_df))
    all_sources = []

    if dc_df is None or dc_df.empty:
        return make_result({"error": "No design change data"}, "N/A", warnings=["No design change data"], data_coverage=cov, confidence="low")

    dc = dc_df.copy()
    dc["cost_impact"] = numeric_col(dc, "cost_impact")
    total_dc_cost = float(dc["cost_impact"].sum())
    all_sources.extend(extract_sources(dc_df))

    co_cost = 0
    co_shrinkage = 0
    if co_df is not None and not co_df.empty:
        co = co_df.copy()
        co["proposed"] = numeric_col(co, "gc_proposed_amount")
        co["approved"] = numeric_col(co, "owner_approved_amount")
        reason_col = None
        for c in ["change_reason", "Change Reason (Root Cause)"]:
            if c in co.columns:
                reason_col = c
                break
        if reason_col:
            design_cos = co[co[reason_col].astype(str).str.lower().str.contains("design|asi|rfi")]
            co_cost = float(design_cos["approved"].sum())
            co_shrinkage = float(design_cos["proposed"].sum() - design_cos["approved"].sum())
        else:
            co_cost = float(co["approved"].sum())
            warnings.append("No change_reason column; using all CO values")
        all_sources.extend(extract_sources(co_df))

    rework_cost = 0
    disruption_cost = 0
    disruption_hours = 0
    if prod_df is not None and not prod_df.empty:
        prod = prod_df.copy()
        rework_cost = float(numeric_col(prod, "rework_cost").sum())
        disruption_cost = float(numeric_col(prod, "disruption_cost").sum())
        disruption_hours = float(numeric_col(prod, "total_disruption_hours").sum())
        all_sources.extend(extract_sources(prod_df))

    total_design_impact = total_dc_cost + rework_cost + disruption_cost + co_shrinkage

    type_col = None
    for c in ["asi_type", "ASI Type"]:
        if c in dc.columns:
            type_col = c
            break
    by_type = None
    if type_col:
        by_type = dc.groupby(type_col).agg(
            count=("cost_impact", "size"),
            total_cost=("cost_impact", "sum"),
        ).round(0).reset_index().to_dict("records")

    return make_result(
        {
            "design_change_direct_cost": total_dc_cost,
            "co_approved_cost": co_cost,
            "co_shrinkage": co_shrinkage,
            "rework_cost": rework_cost,
            "disruption_cost": disruption_cost,
            "disruption_hours": disruption_hours,
            "total_design_impact": total_design_impact,
            "by_asi_type": by_type,
        },
        "Total Impact = DC Direct Cost + Rework + Disruption + CO Shrinkage",
        warnings=warnings,
        sources=sorted(set(all_sources)),
        data_coverage=cov,
        confidence=confidence_level(cov),
    )


def coordination_rework_total(prod_df, rfi_df=None, dc_df=None, **kwargs):
    """Quantify rework caused by coordination failures."""
    warnings = []
    cov = {}
    cov.update(df_coverage("production", prod_df))
    cov.update(df_coverage("rfi", rfi_df))
    cov.update(df_coverage("design_changes", dc_df))

    if prod_df is None or prod_df.empty:
        return make_result({"error": "No production data"}, "N/A", warnings=["No production data"], data_coverage=cov, confidence="low")

    prod = prod_df.copy()
    prod["rework_cost"] = numeric_col(prod, "rework_cost")
    prod["rework_hours"] = numeric_col(prod, "rework_labor_hours")

    cause_col = None
    for c in ["rework_cause", "Rework Cause"]:
        if c in prod.columns:
            cause_col = c
            break

    total_rework = float(prod["rework_cost"].sum())
    total_rework_hours = float(prod["rework_hours"].sum())

    coord_rework = 0
    coord_hours = 0
    by_cause = None
    if cause_col:
        by_cause_df = prod.groupby(cause_col).agg(
            cost=("rework_cost", "sum"),
            hours=("rework_hours", "sum"),
            count=("rework_cost", "size"),
        ).round(0).reset_index()
        by_cause_df = by_cause_df.sort_values("cost", ascending=False)
        by_cause = by_cause_df.to_dict("records")

        coord_mask = prod[cause_col].astype(str).str.lower().str.contains("coord|design|information|clash")
        coord_rework = float(prod.loc[coord_mask, "rework_cost"].sum())
        coord_hours = float(prod.loc[coord_mask, "rework_hours"].sum())
    else:
        warnings.append("No rework_cause column; showing totals only")

    coord_pct = pct(coord_rework, total_rework) if total_rework else 0

    rfi_count = 0
    if rfi_df is not None and not rfi_df.empty:
        rfi_root_col = None
        for c in ["root_cause_level_1", "Root Cause (Level 1)"]:
            if c in rfi_df.columns:
                rfi_root_col = c
                break
        if rfi_root_col:
            rfi_count = len(rfi_df[rfi_df[rfi_root_col].astype(str).str.lower().str.contains("design|coord|clash")])

    return make_result(
        {
            "total_rework_cost": total_rework,
            "total_rework_hours": total_rework_hours,
            "coordination_rework_cost": coord_rework,
            "coordination_rework_hours": coord_hours,
            "coordination_pct_of_rework": round(coord_pct, 1),
            "related_rfi_count": rfi_count,
            "by_cause": by_cause,
        },
        "Coordination Rework = SUM(rework_cost WHERE cause contains design/coordination/clash)",
        warnings=warnings,
        sources=extract_sources(prod_df),
        data_coverage=cov,
        confidence=confidence_level(cov),
    )


def ve_net_value(dc_df, co_df=None, prod_df=None, rfi_df=None, **kwargs):
    """Track VE decisions and their net value after downstream consequences."""
    warnings = []
    cov = {}
    cov.update(df_coverage("design_changes", dc_df))
    cov.update(df_coverage("change_orders", co_df))
    cov.update(df_coverage("production", prod_df))
    cov.update(df_coverage("rfi", rfi_df))

    if dc_df is None or dc_df.empty:
        return make_result({"error": "No design change data"}, "N/A", warnings=["No data"], data_coverage=cov, confidence="low")

    dc = dc_df.copy()
    type_col = None
    for c in ["asi_type", "ASI Type"]:
        if c in dc.columns:
            type_col = c
            break

    if type_col:
        ve_changes = dc[dc[type_col].astype(str).str.lower().str.contains("ve|value eng|enhancement")]
    else:
        ve_changes = dc
        warnings.append("No ASI Type column; analyzing all design changes")

    ve_savings = float(numeric_col(ve_changes, "cost_impact").sum())
    ve_count = len(ve_changes)

    rework_from_ve = 0
    if prod_df is not None and not prod_df.empty:
        cause_col = None
        for c in ["rework_cause", "Rework Cause"]:
            if c in prod_df.columns:
                cause_col = c
                break
        if cause_col:
            ve_rework = prod_df[prod_df[cause_col].astype(str).str.lower().str.contains("design|ve")]
            rework_from_ve = float(numeric_col(ve_rework, "rework_cost").sum())

    ve_rfis = 0
    if rfi_df is not None and not rfi_df.empty:
        ve_rfis = len(rfi_df)

    net_value = ve_savings - rework_from_ve

    return make_result(
        {
            "ve_count": ve_count,
            "intended_savings": ve_savings,
            "rework_cost_from_ve": rework_from_ve,
            "related_rfi_count": ve_rfis,
            "net_ve_value": net_value,
        },
        "Net VE = Intended Savings - Rework from VE decisions",
        warnings=warnings,
        sources=extract_sources(dc_df),
        data_coverage=cov,
        confidence=confidence_level(cov),
    )


def punch_list_cost(admin_df, prod_df=None, dc_df=None, **kwargs):
    """Analyze punch list items by trade and root cause."""
    warnings = []
    cov = {}
    cov.update(df_coverage("project_admin", admin_df))
    cov.update(df_coverage("production", prod_df))
    cov.update(df_coverage("design_changes", dc_df))

    if admin_df is None or admin_df.empty:
        return make_result({"error": "No admin data"}, "N/A", warnings=["No admin data"], data_coverage=cov, confidence="low")

    admin = admin_df.copy()
    total_punch = float(numeric_col(admin, "total_punch_items").sum())
    punch_days = float(numeric_col(admin, "days_to_complete_punch_list").mean())

    trade_col = None
    for c in ["items_by_trade", "Items by Trade (Punch)"]:
        if c in admin.columns:
            trade_col = c
            break

    rework_cost = 0
    rework_hours = 0
    by_cause = None
    if prod_df is not None and not prod_df.empty:
        prod = prod_df.copy()
        rework_cost = float(numeric_col(prod, "rework_cost").sum())
        rework_hours = float(numeric_col(prod, "rework_labor_hours").sum())
        cause_col = None
        for c in ["rework_cause", "Rework Cause"]:
            if c in prod.columns:
                cause_col = c
                break
        if cause_col:
            by_cause = prod.groupby(cause_col).agg(
                cost=("rework_cost", "sum") if "rework_cost" in prod.columns else ("rework_cost", "size"),
                count=(cause_col, "size"),
            ).round(0).reset_index()
            by_cause = by_cause.sort_values("cost", ascending=False).to_dict("records")

    warranty_items = float(numeric_col(admin, "warranty_items").sum())

    return make_result(
        {
            "total_punch_items": total_punch,
            "avg_days_to_complete": round(punch_days, 1),
            "rework_cost": rework_cost,
            "rework_hours": rework_hours,
            "warranty_items": warranty_items,
            "by_cause": by_cause,
        },
        "Punch Cost = SUM(Rework Cost) from production data; grouped by Rework Cause",
        warnings=warnings,
        sources=extract_sources(admin_df) + extract_sources(prod_df),
        data_coverage=cov,
        confidence=confidence_level(cov),
    )

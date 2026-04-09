"""Cash flow bottleneck and payment analysis."""

from common import safe_numeric, pct, delta, extract_sources, df_coverage, make_result, numeric_col, confidence_level
import pandas as pd


def cash_flow_bottleneck(admin_df, co_df=None, dc_df=None, **kwargs):
    """Identify where cash is stuck: pending COs, disputes, retention, stalled pipeline."""
    warnings = []
    cov = {}
    cov.update(df_coverage("project_admin", admin_df))
    cov.update(df_coverage("change_orders", co_df))
    cov.update(df_coverage("design_changes", dc_df))
    all_sources = []

    if admin_df is None or admin_df.empty:
        return make_result({"error": "No project_admin data"}, "N/A", warnings=["No admin data"], data_coverage=cov, confidence="low")

    retainage = float(numeric_col(admin_df, "retainage_held").sum())
    disputed = float(numeric_col(admin_df, "disputed_held_items").sum())
    days_to_pay = numeric_col(admin_df, "days_to_payment")
    avg_days_to_pay = float(days_to_pay.mean()) if len(days_to_pay) > 0 else 0
    all_sources.extend(extract_sources(admin_df))

    pending_co = 0
    if co_df is not None and not co_df.empty:
        co = co_df.copy()
        status_col = None
        for c in ["status", "Status", "co_status"]:
            if c in co.columns:
                status_col = c
                break
        if status_col:
            pending = co[co[status_col].str.lower().isin(["pending", "submitted", "in review"])]
        else:
            pending = co
            warnings.append("No CO status column found; counting all COs as pending")
        pending_co = float(numeric_col(pending, "gc_proposed_amount").sum())
        all_sources.extend(extract_sources(co_df))

    stalled_pipeline = 0
    if dc_df is not None and not dc_df.empty:
        dc = dc_df.copy()
        status_col = None
        for c in ["approval_status", "Approval Status"]:
            if c in dc.columns:
                status_col = c
                break
        if status_col:
            pending_dc = dc[~dc[status_col].str.lower().isin(["approved", "closed"])]
        else:
            pending_dc = dc
            warnings.append("No approval_status column in design changes; counting all as pending")
        stalled_pipeline = float(numeric_col(pending_dc, "proposed_amount").sum() + numeric_col(pending_dc, "cost_impact").sum())
        all_sources.extend(extract_sources(dc_df))

    total_stuck = retainage + disputed + pending_co + stalled_pipeline

    result = {
        "retainage_held": retainage,
        "disputed_items": disputed,
        "pending_co_value": pending_co,
        "stalled_pipeline_value": stalled_pipeline,
        "total_cash_stuck": total_stuck,
        "avg_days_to_payment": round(avg_days_to_pay, 1),
    }

    breakdown = {
        "retainage_pct_of_stuck": round(pct(retainage, total_stuck), 1) if total_stuck else 0,
        "disputes_pct_of_stuck": round(pct(disputed, total_stuck), 1) if total_stuck else 0,
        "co_pct_of_stuck": round(pct(pending_co, total_stuck), 1) if total_stuck else 0,
        "pipeline_pct_of_stuck": round(pct(stalled_pipeline, total_stuck), 1) if total_stuck else 0,
    }

    return make_result(
        result,
        "Cash Stuck = Retainage Held + Disputed Items + Pending COs + Stalled Pipeline",
        intermediates=breakdown,
        warnings=warnings,
        sources=sorted(set(all_sources)),
        data_coverage=cov,
        confidence=confidence_level(cov),
    )


def retention_readiness(admin_df, dc_df=None, **kwargs):
    """Score projects by retention release readiness."""
    warnings = []
    cov = {}
    cov.update(df_coverage("project_admin", admin_df))
    cov.update(df_coverage("design_changes", dc_df))

    if admin_df is None or admin_df.empty:
        return make_result({"error": "No admin data"}, "N/A", warnings=["No admin data"], data_coverage=cov, confidence="low")

    admin = admin_df.copy()
    admin["retainage"] = numeric_col(admin, "retainage_held")
    admin["punch_days"] = numeric_col(admin, "days_to_complete_punch_list")
    admin["punch_items"] = numeric_col(admin, "total_punch_items")

    id_col = "project_id" if "project_id" in admin.columns else admin.columns[0]

    open_dc = 0
    if dc_df is not None and not dc_df.empty:
        status_col = None
        for c in ["approval_status", "Approval Status"]:
            if c in dc_df.columns:
                status_col = c
                break
        if status_col:
            open_dc = len(dc_df[~dc_df[status_col].str.lower().isin(["approved", "closed"])])

    scores = []
    for _, row in admin.iterrows():
        ret = safe_numeric(row.get("retainage"))
        punch = safe_numeric(row.get("punch_items"))
        punch_d = safe_numeric(row.get("punch_days"))

        readiness = 100
        if punch > 20:
            readiness -= 30
        elif punch > 10:
            readiness -= 15
        if punch_d > 30:
            readiness -= 20
        elif punch_d > 14:
            readiness -= 10
        if open_dc > 5:
            readiness -= 20
        elif open_dc > 0:
            readiness -= 10

        scores.append({
            "project": row.get(id_col, "unknown"),
            "retainage_held": ret,
            "punch_items": int(punch),
            "punch_days_remaining": punch_d,
            "open_design_changes": open_dc,
            "readiness_score": max(0, min(100, readiness)),
        })

    scores.sort(key=lambda s: s["readiness_score"], reverse=True)
    total_retainage = sum(s["retainage_held"] for s in scores)
    releasable = sum(s["retainage_held"] for s in scores if s["readiness_score"] >= 70)

    return make_result(
        {"projects": scores, "total_retainage": total_retainage, "releasable_retainage": releasable},
        "Readiness = 100 - penalties(punch items, punch days, open design changes)",
        warnings=warnings,
        sources=extract_sources(admin_df),
        data_coverage=cov,
        confidence=confidence_level(cov),
    )


def payment_velocity_score(admin_df, co_df=None, dc_df=None, **kwargs):
    """Score GCs by payment speed across invoices, COs, and CCDs."""
    warnings = []
    cov = {}
    cov.update(df_coverage("project_admin", admin_df))
    cov.update(df_coverage("change_orders", co_df))
    cov.update(df_coverage("design_changes", dc_df))

    if admin_df is None or admin_df.empty:
        return make_result({"error": "No admin data"}, "N/A", warnings=["No admin data"], data_coverage=cov, confidence="low")

    admin = admin_df.copy()
    admin["days_to_pay"] = numeric_col(admin, "days_to_payment")

    gc_col = None
    for c in ["gc_name", "GC Name", "project_id"]:
        if c in admin.columns:
            gc_col = c
            break
    if not gc_col:
        return make_result({"error": "No GC identifier"}, "N/A", warnings=["No gc_name column"], data_coverage=cov, confidence="low")

    gc_vel = admin.groupby(gc_col).agg(
        avg_days=("days_to_pay", "mean"),
        invoice_count=("days_to_pay", "size"),
    ).round(1).reset_index()

    def score_days(d):
        if d <= 30:
            return "Fast"
        if d <= 60:
            return "Average"
        return "Slow"

    gc_vel["tier"] = gc_vel["avg_days"].apply(score_days)
    gc_vel = gc_vel.sort_values("avg_days")
    gc_vel.columns = [gc_col, "avg_days_to_payment", "invoice_count", "tier"]

    return make_result(
        {"gc_velocity": gc_vel.to_dict("records")},
        "Tier: <=30d=Fast, 31-60d=Average, >60d=Slow; weighted by volume",
        sources=extract_sources(admin_df),
        data_coverage=cov,
        confidence=confidence_level(cov),
    )


def invoice_rejection_rate(admin_df, co_df=None, **kwargs):
    """Analyze pay app rejection patterns by GC and reason."""
    warnings = []
    cov = {}
    cov.update(df_coverage("project_admin", admin_df))
    cov.update(df_coverage("change_orders", co_df))

    if admin_df is None or admin_df.empty:
        return make_result({"error": "No admin data"}, "N/A", warnings=["No admin data"], data_coverage=cov, confidence="low")

    admin = admin_df.copy()
    admin["billed"] = numeric_col(admin, "billed_this_period")
    admin["disputed"] = numeric_col(admin, "disputed_held_items")
    admin["days_to_pay"] = numeric_col(admin, "days_to_payment")

    total_billed = float(admin["billed"].sum())
    total_disputed = float(admin["disputed"].sum())
    rejection_rate = pct(total_disputed, total_billed) if total_billed else 0

    gc_col = None
    for c in ["gc_name", "GC Name", "project_id"]:
        if c in admin.columns:
            gc_col = c
            break

    by_gc = None
    if gc_col:
        gc_rej = admin.groupby(gc_col).agg(
            total_billed=("billed", "sum"),
            total_disputed=("disputed", "sum"),
            avg_days=("days_to_pay", "mean"),
        ).round(1).reset_index()
        gc_rej["rejection_rate_pct"] = gc_rej.apply(
            lambda r: round(pct(r["total_disputed"], r["total_billed"]), 1), axis=1
        )
        gc_rej = gc_rej.sort_values("rejection_rate_pct", ascending=False)
        by_gc = gc_rej.to_dict("records")

    return make_result(
        {
            "total_billed": total_billed,
            "total_disputed": total_disputed,
            "overall_rejection_rate_pct": round(rejection_rate, 1),
            "by_gc": by_gc,
        },
        "Rejection Rate = Disputed / Billed * 100",
        sources=extract_sources(admin_df),
        data_coverage=cov,
        confidence=confidence_level(cov),
    )

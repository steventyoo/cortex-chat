"""T&M billing and warranty callback calculations."""

from common import safe_numeric, pct, extract_sources, df_coverage, make_result, numeric_col, confidence_level
import pandas as pd


def billing_summary(admin_df, jcr_df=None, co_df=None, **kwargs):
    """Deduplicated billing summary from project_admin pay applications.

    Filters admin records to pay-application-type documents (avoiding double-counting
    from SOVs, lien releases, and meeting minutes that also contain billing fields).
    Falls back to all admin records if no document type column is available.
    """
    warnings = []
    cov = {}
    cov.update(df_coverage("project_admin", admin_df))
    cov.update(df_coverage("jcr", jcr_df))
    cov.update(df_coverage("change_orders", co_df))

    if admin_df is None or admin_df.empty:
        return make_result({"error": "No admin data"}, "N/A", warnings=["No admin data"], data_coverage=cov, confidence="low")

    admin = admin_df.copy()

    type_col = None
    for c in ["document_type", "Type", "doc_type", "meeting_type", "Meeting Type"]:
        if c in admin.columns:
            type_col = c
            break

    if type_col:
        pay_app_mask = admin[type_col].astype(str).str.lower().str.contains(
            "pay.*app|application.*payment|billing|invoice|requisition|pencil draw"
        )
        pay_apps = admin[pay_app_mask]
        if pay_apps.empty:
            pay_apps = admin
            warnings.append(f"No pay application records found in {type_col}; using all admin records")
        else:
            excluded = len(admin) - len(pay_apps)
            if excluded > 0:
                warnings.append(f"Filtered {excluded} non-pay-app records (SOVs, lien releases, etc.)")
    else:
        pay_apps = admin
        warnings.append("No document type column; using all admin records (risk of double-counting)")

    pay_apps = pay_apps.copy()
    pay_apps["billed"] = numeric_col(pay_apps, "billed_this_period")
    pay_apps["scheduled"] = numeric_col(pay_apps, "scheduled_value")
    pay_apps["contract_val"] = numeric_col(pay_apps, "current_contract_value")
    pay_apps["retainage"] = numeric_col(pay_apps, "retainage_held")
    pay_apps["days_to_pay"] = numeric_col(pay_apps, "days_to_payment")

    total_billed = float(pay_apps["billed"].sum())
    total_scheduled = float(pay_apps["scheduled"].sum())
    total_retainage = float(pay_apps["retainage"].sum())
    avg_days_to_pay = float(pay_apps["days_to_pay"].mean()) if pay_apps["days_to_pay"].sum() > 0 else 0
    contract_value = float(pay_apps["contract_val"].max()) if pay_apps["contract_val"].max() > 0 else 0

    billing_pct = pct(total_billed, contract_value) if contract_value else 0

    jcr_cost = 0
    if jcr_df is not None and not jcr_df.empty:
        jcr = jcr_df.copy()
        for col_name in ["total_jtd_cost", "ap_total", "ap_total_raw"]:
            val = safe_numeric(jcr.iloc[0].get(col_name))
            if val:
                jcr_cost = val
                break

    overbilling = total_billed - jcr_cost if jcr_cost > 0 and total_billed > jcr_cost else 0
    underbilling = jcr_cost - total_billed if jcr_cost > 0 and jcr_cost > total_billed else 0

    return make_result(
        {
            "pay_app_count": len(pay_apps),
            "total_billed": total_billed,
            "contract_value": contract_value,
            "billing_progress_pct": round(billing_pct, 1),
            "total_retainage_held": total_retainage,
            "avg_days_to_payment": round(avg_days_to_pay, 0),
            "overbilling": round(overbilling, 0),
            "underbilling": round(underbilling, 0),
            "jcr_cost_reference": jcr_cost,
        },
        "Billing Progress = Total Billed / Contract Value; Over/Under = Billed - JTD Cost",
        warnings=warnings,
        sources=extract_sources(admin_df) + extract_sources(jcr_df),
        data_coverage=cov,
        confidence=confidence_level(cov),
    )


def tm_underbilling(co_df, prod_df=None, jcr_df=None, **kwargs):
    """Detect T&M work where billed amounts are less than actual costs."""
    warnings = []
    cov = {}
    cov.update(df_coverage("change_orders", co_df))
    cov.update(df_coverage("production", prod_df))
    cov.update(df_coverage("jcr", jcr_df))

    if co_df is None or co_df.empty:
        return make_result({"error": "No CO data"}, "N/A", warnings=["No CO data"], data_coverage=cov, confidence="low")

    co = co_df.copy()
    co["proposed"] = numeric_col(co, "gc_proposed_amount")
    co["markup"] = numeric_col(co, "markup_applied")

    type_col = None
    for c in ["co_type", "CO Type", "change_reason", "Change Reason (Root Cause)"]:
        if c in co.columns:
            type_col = c
            break

    if type_col:
        tm_cos = co[co[type_col].astype(str).str.lower().str.contains("t&m|t & m|time.*material")]
        if tm_cos.empty:
            tm_cos = co
            warnings.append(f"No T&M COs found in {type_col}; using all COs")
    else:
        tm_cos = co
        warnings.append("No CO type column; analyzing all COs")

    tm_billed = float(tm_cos["proposed"].sum())

    actual_cost = 0
    if prod_df is not None and not prod_df.empty:
        prod = prod_df.copy()
        prod["hours"] = numeric_col(prod, "total_labor_hours")
        blended_rate = safe_numeric(kwargs.get("blended_rate", 65))
        actual_cost = float(prod["hours"].sum()) * blended_rate

    underbilling = actual_cost - tm_billed if actual_cost > 0 else 0

    markup_consistency = None
    if len(tm_cos) > 1 and tm_cos["markup"].std() > 0:
        markup_consistency = {
            "avg_markup_pct": round(float(tm_cos["markup"].mean()), 1),
            "std_markup_pct": round(float(tm_cos["markup"].std()), 1),
            "min_markup_pct": round(float(tm_cos["markup"].min()), 1),
            "max_markup_pct": round(float(tm_cos["markup"].max()), 1),
            "inconsistent": float(tm_cos["markup"].std()) > 5,
        }

    return make_result(
        {
            "tm_co_count": len(tm_cos),
            "tm_billed_total": tm_billed,
            "estimated_actual_cost": actual_cost,
            "estimated_underbilling": max(0, underbilling),
            "markup_analysis": markup_consistency,
        },
        "Underbilling = (Actual Hours * Rate + Materials + Markup) - Billed Amount",
        warnings=warnings,
        sources=extract_sources(co_df) + extract_sources(prod_df),
        data_coverage=cov,
        confidence=confidence_level(cov),
    )


def warranty_callback_cost(admin_df, prod_df=None, dc_df=None, **kwargs):
    """Trace warranty failures to crews and design changes."""
    warnings = []
    cov = {}
    cov.update(df_coverage("project_admin", admin_df))
    cov.update(df_coverage("production", prod_df))
    cov.update(df_coverage("design_changes", dc_df))

    if admin_df is None or admin_df.empty:
        return make_result({"error": "No admin data"}, "N/A", warnings=["No admin data"], data_coverage=cov, confidence="low")

    admin = admin_df.copy()
    warranty_count = float(numeric_col(admin, "warranty_items").sum())
    punch_items = float(numeric_col(admin, "total_punch_items").sum())
    punch_days = float(numeric_col(admin, "days_to_complete_punch_list").mean())

    trade_col = None
    for c in ["items_by_trade", "Items by Trade (Punch)", "warranty_item_trade", "Warranty Item Trade"]:
        if c in admin.columns:
            trade_col = c
            break

    rework_total = 0
    rework_by_cause = None
    if prod_df is not None and not prod_df.empty:
        prod = prod_df.copy()
        prod["rework_cost"] = numeric_col(prod, "rework_cost")
        prod["rework_hours"] = numeric_col(prod, "rework_labor_hours")
        rework_total = float(prod["rework_cost"].sum())

        cause_col = None
        for c in ["rework_cause", "Rework Cause"]:
            if c in prod.columns:
                cause_col = c
                break
        if cause_col:
            rework_by_cause = prod.groupby(cause_col).agg(
                cost=("rework_cost", "sum"),
                hours=("rework_hours", "sum"),
                count=(cause_col, "size"),
            ).round(0).reset_index()
            rework_by_cause = rework_by_cause.sort_values("cost", ascending=False).to_dict("records")

    design_rework_flag = 0
    if dc_df is not None and not dc_df.empty:
        rw_col = None
        for c in ["rework_required", "Rework Required?"]:
            if c in dc_df.columns:
                rw_col = c
                break
        if rw_col:
            design_rework_flag = len(dc_df[dc_df[rw_col].astype(str).str.lower().str.contains("yes|true|1")])

    estimated_callback_cost = rework_total * 0.3 if rework_total else 0
    if warranty_count > 0:
        estimated_callback_cost = max(estimated_callback_cost, warranty_count * safe_numeric(kwargs.get("avg_warranty_cost", 500)))

    return make_result(
        {
            "warranty_item_count": warranty_count,
            "punch_item_count": punch_items,
            "avg_punch_days": round(punch_days, 1),
            "total_rework_cost": rework_total,
            "design_changes_requiring_rework": design_rework_flag,
            "estimated_warranty_callback_cost": round(estimated_callback_cost, 0),
            "rework_by_cause": rework_by_cause,
        },
        "Warranty Cost = warranty_count * avg_cost OR 30% of rework (whichever is higher)",
        warnings=warnings,
        sources=extract_sources(admin_df) + extract_sources(prod_df),
        data_coverage=cov,
        confidence=confidence_level(cov),
    )

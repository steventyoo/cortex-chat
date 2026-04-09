"""Unit tests for the Cortex deterministic calculation library."""

import unittest
import sys
import os

sys.path.insert(0, os.path.dirname(__file__))

import pandas as pd
from common import safe_numeric, safe_currency, pct, delta, load_data, make_result, confidence_level
from financial import project_profitability, project_type_margin, gc_profitability_score
from cash_flow import cash_flow_bottleneck, retention_readiness, payment_velocity_score, invoice_rejection_rate
from variance import bid_accuracy, labor_hour_variance, material_escalation
from change_orders import unbilled_recovery, co_approval_rate, panic_bid_analysis
from productivity import foreman_gap, overtime_impact, crew_optimization, apprentice_ratio_impact, mobilization_cost
from risk_and_scoring import risk_concentration, back_charge_score, gc_pm_ranking, sub_benchmark_score, bid_sweet_spot
from design_and_rework import design_change_cost_rollup, coordination_rework_total, ve_net_value, punch_list_cost
from schedule import delay_cost_attribution
from billing import tm_underbilling, warranty_callback_cost


# ── Fixtures ────────────────────────────────────────────────────

def jcr_fixture():
    return pd.DataFrame([{
        "source_file": "JCR-001.xlsx",
        "project_id": "P1",
        "total_revised_budget": "1500000",
        "total_jtd_cost": "1200000",
        "total_over_under_budget": "-50000",
        "estimated_margin_at_completion": "250000",
        "total_change_orders": "100000",
    }])


def co_fixture():
    return pd.DataFrame([
        {"source_file": "CO-001.pdf", "project_id": "P1", "gc_proposed_amount": "50000", "owner_approved_amount": "40000", "negotiation_delta": "10000", "change_reason": "Design Change", "disputed": "No", "markup_applied": "15"},
        {"source_file": "CO-002.pdf", "project_id": "P1", "gc_proposed_amount": "30000", "owner_approved_amount": "25000", "negotiation_delta": "5000", "change_reason": "Field Condition", "disputed": "Yes", "markup_applied": "12"},
        {"source_file": "CO-003.pdf", "project_id": "P1", "gc_proposed_amount": "20000", "owner_approved_amount": "20000", "negotiation_delta": "0", "change_reason": "Owner Request", "disputed": "No", "markup_applied": "15"},
    ])


def prod_fixture():
    return pd.DataFrame([
        {"source_file": "PROD-001.xlsx", "production_rate": "2.5", "total_labor_hours": "400", "activity_type": "Rough-In", "crew_composition": "3 Journeyman 1 Apprentice", "rework_cost": "5000", "rework_cause": "Design", "rework_labor_hours": "40", "disruption_cost": "3000", "total_disruption_hours": "20", "disruption_cause_categories": "Design Change", "responsible_party": "GC", "overtime_shift": "Regular", "estimated_production_rate": "2.0", "cumulative_production_efficiency": "95"},
        {"source_file": "PROD-002.xlsx", "production_rate": "1.8", "total_labor_hours": "600", "activity_type": "Finish", "crew_composition": "2 Journeyman 2 Apprentice", "rework_cost": "2000", "rework_cause": "Coordination", "rework_labor_hours": "20", "disruption_cost": "1000", "total_disruption_hours": "10", "disruption_cause_categories": "Coordination", "responsible_party": "Sub", "overtime_shift": "OT", "estimated_production_rate": "2.2", "cumulative_production_efficiency": "85"},
    ])


def admin_fixture():
    return pd.DataFrame([{
        "source_file": "ADMIN-001.xlsx",
        "project_id": "P1",
        "retainage_held": "50000",
        "days_to_complete_punch_list": "15",
        "total_punch_items": "12",
        "days_to_payment": "45",
        "billed_this_period": "200000",
        "disputed_held_items": "10000",
        "warranty_items": "3",
        "notice_timeliness": "On Time",
        "back_charges_issued": "No",
    }])


def estimate_fixture():
    return pd.DataFrame([
        {"source_file": "EST-001.xlsx", "project_id": "P1", "total_bid_amount": "1400000", "contract_amount": "1390000", "project_type": "Commercial", "building_type": "Office", "bid_result": "Won", "fee_markup_structure": "12", "market_condition": "Normal", "design_completeness": "Complete", "gross_square_footage": "50000"},
        {"source_file": "EST-002.xlsx", "project_id": "P2", "total_bid_amount": "800000", "contract_amount": "", "project_type": "Healthcare", "building_type": "Hospital", "bid_result": "Lost", "fee_markup_structure": "8", "market_condition": "Hot", "design_completeness": "Incomplete", "gross_square_footage": "25000"},
    ])


def contract_fixture():
    return pd.DataFrame([
        {"source_file": "CTR-001.pdf", "project_id": "P1", "risk_score": "3", "clause_category": "LD", "historical_dispute_flag": "Yes"},
        {"source_file": "CTR-002.pdf", "project_id": "P2", "risk_score": "2", "clause_category": "Standard", "historical_dispute_flag": "No"},
    ])


def dc_fixture():
    return pd.DataFrame([
        {"source_file": "DC-001.pdf", "approval_status": "Approved", "cost_impact": "15000", "asi_type": "Correction", "conversion_rate_flag": "true", "estimated_missed_revenue": "0", "rework_required": "Yes", "proposed_amount": "15000", "schedule_impact": "5 days"},
        {"source_file": "DC-002.pdf", "approval_status": "Pending", "cost_impact": "8000", "asi_type": "VE Enhancement", "conversion_rate_flag": "false", "estimated_missed_revenue": "8000", "rework_required": "No", "proposed_amount": "8000", "schedule_impact": "None"},
    ])


def rfi_fixture():
    return pd.DataFrame([
        {"source_file": "RFI-001.pdf", "root_cause_level_1": "Design Conflict", "csi_division": "26", "response_time": "5", "schedule_impact": "3-5 days"},
        {"source_file": "RFI-002.pdf", "root_cause_level_1": "Field Condition", "csi_division": "26", "response_time": "2", "schedule_impact": "None"},
    ])


def daily_fixture():
    return pd.DataFrame([
        {"source_file": "DR-001.pdf", "delay_cause_category": "Weather", "issues_delays": "Rain delay 4 hours"},
        {"source_file": "DR-002.pdf", "delay_cause_category": "GC Coordination", "issues_delays": "Waiting for ceiling grid"},
    ])


# ── Tests ───────────────────────────────────────────────────────

class TestCommon(unittest.TestCase):
    def test_safe_numeric_dollar(self):
        self.assertAlmostEqual(safe_numeric("$1,234.56"), 1234.56)

    def test_safe_numeric_negative_parens(self):
        self.assertAlmostEqual(safe_numeric("($500)"), -500.0)

    def test_safe_numeric_none(self):
        self.assertEqual(safe_numeric(None), 0.0)

    def test_safe_numeric_na(self):
        self.assertEqual(safe_numeric("N/A"), 0.0)

    def test_safe_numeric_int(self):
        self.assertEqual(safe_numeric(42), 42.0)

    def test_safe_currency_positive(self):
        self.assertEqual(safe_currency(1234), "$1,234")

    def test_safe_currency_negative(self):
        self.assertEqual(safe_currency(-1234), "($1,234)")

    def test_pct_normal(self):
        self.assertAlmostEqual(pct(25, 100), 25.0)

    def test_pct_zero_div(self):
        self.assertEqual(pct(10, 0), 0.0)

    def test_delta(self):
        self.assertEqual(delta(100, 60), 40.0)

    def test_delta_none(self):
        self.assertEqual(delta(None, 60), -60.0)

    def test_confidence_level_high(self):
        cov = {"a": {"has_data": True}, "b": {"has_data": True}, "c": {"has_data": True}}
        self.assertEqual(confidence_level(cov), "high")

    def test_confidence_level_low(self):
        cov = {"a": {"has_data": False}, "b": {"has_data": False}, "c": {"has_data": True}}
        self.assertEqual(confidence_level(cov), "low")

    def test_make_result_structure(self):
        r = make_result({"x": 1}, "formula")
        self.assertIn("result", r)
        self.assertIn("formula", r)
        self.assertIn("warnings", r)
        self.assertEqual(r["confidence"], "medium")


class TestFinancial(unittest.TestCase):
    def test_project_profitability(self):
        r = project_profitability(jcr_fixture(), co_df=co_fixture(), prod_df=prod_fixture())
        self.assertEqual(r["result"]["headline_margin"], 300000)
        self.assertEqual(r["result"]["co_shrinkage"], 15000)
        self.assertGreater(r["result"]["true_profit"], 0)
        self.assertIn("formula", r)

    def test_project_profitability_no_data(self):
        r = project_profitability(pd.DataFrame())
        self.assertEqual(r["confidence"], "low")

    def test_gc_profitability_score(self):
        r = gc_profitability_score(co_fixture(), admin_fixture())
        self.assertIn("gc_scores", r["result"])


class TestCashFlow(unittest.TestCase):
    def test_cash_flow_bottleneck(self):
        r = cash_flow_bottleneck(admin_fixture(), co_fixture(), dc_fixture())
        self.assertGreater(r["result"]["retainage_held"], 0)
        self.assertGreater(r["result"]["total_cash_stuck"], 0)

    def test_retention_readiness(self):
        r = retention_readiness(admin_fixture(), dc_fixture())
        self.assertIn("projects", r["result"])
        self.assertGreater(r["result"]["total_retainage"], 0)

    def test_payment_velocity(self):
        r = payment_velocity_score(admin_fixture())
        self.assertIn("gc_velocity", r["result"])

    def test_invoice_rejection(self):
        r = invoice_rejection_rate(admin_fixture())
        self.assertEqual(r["result"]["overall_rejection_rate_pct"], 5.0)


class TestVariance(unittest.TestCase):
    def test_labor_hour_variance(self):
        r = labor_hour_variance(prod_fixture())
        self.assertIn("by_activity", r["result"])

    def test_material_escalation_no_col(self):
        r = material_escalation(estimate_fixture(), jcr_fixture())
        self.assertEqual(r["confidence"], "low")


class TestChangeOrders(unittest.TestCase):
    def test_unbilled_recovery(self):
        r = unbilled_recovery(co_fixture(), dc_fixture())
        self.assertEqual(r["result"]["total_shrinkage"], 15000)
        self.assertEqual(r["result"]["unconverted_design_changes"], 1)
        self.assertEqual(r["result"]["estimated_missed_revenue"], 8000)

    def test_co_approval_rate(self):
        r = co_approval_rate(co_fixture())
        self.assertGreater(r["result"]["overall_approval_rate_pct"], 0)


class TestProductivity(unittest.TestCase):
    def test_foreman_gap(self):
        r = foreman_gap(prod_fixture())
        self.assertIn("crews", r["result"])

    def test_overtime_impact(self):
        r = overtime_impact(prod_fixture())
        self.assertGreater(r["result"]["total_hours"], 0)

    def test_crew_optimization(self):
        r = crew_optimization(prod_fixture())
        self.assertIn("compositions", r["result"])

    def test_mobilization_cost(self):
        r = mobilization_cost(prod_fixture(), estimate_fixture())
        self.assertGreater(r["result"]["total_labor_cost"], 0)


class TestRiskAndScoring(unittest.TestCase):
    def test_risk_concentration(self):
        r = risk_concentration(contract_fixture())
        self.assertIn("gc_risk", r["result"])

    def test_back_charge_score(self):
        r = back_charge_score(co_fixture(), contract_fixture(), admin_fixture())
        self.assertIn("defense_score", r["result"])
        self.assertGreaterEqual(r["result"]["defense_score"], 0)
        self.assertLessEqual(r["result"]["defense_score"], 100)

    def test_bid_sweet_spot(self):
        r = bid_sweet_spot(estimate_fixture())
        self.assertEqual(r["result"]["total_bids"], 2)
        self.assertEqual(r["result"]["total_wins"], 1)


class TestDesignAndRework(unittest.TestCase):
    def test_design_change_cost_rollup(self):
        r = design_change_cost_rollup(dc_fixture(), co_fixture(), prod_fixture())
        self.assertGreater(r["result"]["total_design_impact"], 0)

    def test_coordination_rework_total(self):
        r = coordination_rework_total(prod_fixture(), rfi_fixture())
        self.assertGreater(r["result"]["total_rework_cost"], 0)
        self.assertGreater(r["result"]["coordination_rework_cost"], 0)

    def test_ve_net_value(self):
        r = ve_net_value(dc_fixture(), prod_df=prod_fixture())
        self.assertIn("net_ve_value", r["result"])

    def test_punch_list_cost(self):
        r = punch_list_cost(admin_fixture(), prod_fixture())
        self.assertEqual(r["result"]["total_punch_items"], 12)


class TestSchedule(unittest.TestCase):
    def test_delay_cost_attribution(self):
        r = delay_cost_attribution(prod_fixture(), daily_fixture(), rfi_fixture(), dc_fixture())
        self.assertGreater(r["result"]["total_disruption_cost"], 0)
        self.assertEqual(r["result"]["rfis_with_schedule_impact"], 1)


class TestBilling(unittest.TestCase):
    def test_tm_underbilling(self):
        r = tm_underbilling(co_fixture(), prod_fixture())
        self.assertIn("tm_billed_total", r["result"])

    def test_warranty_callback_cost(self):
        r = warranty_callback_cost(admin_fixture(), prod_fixture(), dc_fixture())
        self.assertGreater(r["result"]["warranty_item_count"], 0)
        self.assertGreater(r["result"]["estimated_warranty_callback_cost"], 0)


class TestEmptyDataFrames(unittest.TestCase):
    """All functions must handle empty DataFrames gracefully."""

    def test_financial_empty(self):
        r = project_profitability(pd.DataFrame())
        self.assertEqual(r["confidence"], "low")

    def test_cash_flow_empty(self):
        r = cash_flow_bottleneck(pd.DataFrame())
        self.assertEqual(r["confidence"], "low")

    def test_variance_empty(self):
        r = labor_hour_variance(pd.DataFrame())
        self.assertEqual(r["confidence"], "low")

    def test_change_orders_empty(self):
        r = unbilled_recovery(pd.DataFrame())
        self.assertEqual(r["confidence"], "low")

    def test_productivity_empty(self):
        r = foreman_gap(pd.DataFrame())
        self.assertEqual(r["confidence"], "low")

    def test_risk_empty(self):
        r = risk_concentration(pd.DataFrame())
        self.assertEqual(r["confidence"], "low")

    def test_design_empty(self):
        r = design_change_cost_rollup(pd.DataFrame())
        self.assertEqual(r["confidence"], "low")

    def test_schedule_empty(self):
        r = delay_cost_attribution(pd.DataFrame())
        self.assertEqual(r["confidence"], "low")

    def test_billing_empty(self):
        r = tm_underbilling(pd.DataFrame())
        self.assertEqual(r["confidence"], "low")


if __name__ == "__main__":
    unittest.main()

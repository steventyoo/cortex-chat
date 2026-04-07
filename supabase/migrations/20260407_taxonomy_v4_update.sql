-- Migration: taxonomy_v4_backfill_importance
-- Backfill importance labels on all existing skills from v4 taxonomy spreadsheet
-- Also add 6 missing safety_inspection fields, create job_cost_report skill,
-- and fix classifier_hints keywords on all skills.

BEGIN;

-- ============================================================
-- PART 1: Backfill importance on all existing field_definitions
-- ============================================================

-- change_order
UPDATE document_skills SET field_definitions = (
  SELECT jsonb_agg(
    CASE
      WHEN (ordinality - 1) = 0 THEN elem || '{ "importance": "E" }'::jsonb
      WHEN (ordinality - 1) = 1 THEN elem || '{ "importance": "E" }'::jsonb
      WHEN (ordinality - 1) = 2 THEN elem || '{ "importance": "P" }'::jsonb
      WHEN (ordinality - 1) = 3 THEN elem || '{ "importance": "P" }'::jsonb
      WHEN (ordinality - 1) = 4 THEN elem || '{ "importance": "P" }'::jsonb
      WHEN (ordinality - 1) = 5 THEN elem || '{ "importance": "P" }'::jsonb
      WHEN (ordinality - 1) = 6 THEN elem || '{ "importance": "S" }'::jsonb
      WHEN (ordinality - 1) = 7 THEN elem || '{ "importance": "S" }'::jsonb
      WHEN (ordinality - 1) = 8 THEN elem || '{ "importance": "S" }'::jsonb
      WHEN (ordinality - 1) = 9 THEN elem || '{ "importance": "P" }'::jsonb
      WHEN (ordinality - 1) = 10 THEN elem || '{ "importance": "S" }'::jsonb
      WHEN (ordinality - 1) = 11 THEN elem || '{ "importance": "P" }'::jsonb
      WHEN (ordinality - 1) = 12 THEN elem || '{ "importance": "S" }'::jsonb
      WHEN (ordinality - 1) = 13 THEN elem || '{ "importance": "P" }'::jsonb
      WHEN (ordinality - 1) = 14 THEN elem || '{ "importance": "P" }'::jsonb
      WHEN (ordinality - 1) = 15 THEN elem || '{ "importance": "S" }'::jsonb
      WHEN (ordinality - 1) = 16 THEN elem || '{ "importance": "S" }'::jsonb
      WHEN (ordinality - 1) = 17 THEN elem || '{ "importance": "S" }'::jsonb
      ELSE elem
    END
    ORDER BY ordinality
  )
  FROM jsonb_array_elements(field_definitions) WITH ORDINALITY AS t(elem, ordinality)
) WHERE skill_id = 'change_order';

-- rfi
UPDATE document_skills SET field_definitions = (
  SELECT jsonb_agg(
    CASE
      WHEN (ordinality - 1) = 0 THEN elem || '{ "importance": "E" }'::jsonb
      WHEN (ordinality - 1) = 1 THEN elem || '{ "importance": "E" }'::jsonb
      WHEN (ordinality - 1) = 2 THEN elem || '{ "importance": "P" }'::jsonb
      WHEN (ordinality - 1) = 3 THEN elem || '{ "importance": "P" }'::jsonb
      WHEN (ordinality - 1) = 4 THEN elem || '{ "importance": "S" }'::jsonb
      WHEN (ordinality - 1) = 5 THEN elem || '{ "importance": "S" }'::jsonb
      WHEN (ordinality - 1) = 6 THEN elem || '{ "importance": "S" }'::jsonb
      WHEN (ordinality - 1) = 7 THEN elem || '{ "importance": "P" }'::jsonb
      WHEN (ordinality - 1) = 8 THEN elem || '{ "importance": "E" }'::jsonb
      WHEN (ordinality - 1) = 9 THEN elem || '{ "importance": "S" }'::jsonb
      WHEN (ordinality - 1) = 10 THEN elem || '{ "importance": "S" }'::jsonb
      WHEN (ordinality - 1) = 11 THEN elem || '{ "importance": "S" }'::jsonb
      WHEN (ordinality - 1) = 12 THEN elem || '{ "importance": "S" }'::jsonb
      WHEN (ordinality - 1) = 13 THEN elem || '{ "importance": "P" }'::jsonb
      WHEN (ordinality - 1) = 14 THEN elem || '{ "importance": "P" }'::jsonb
      WHEN (ordinality - 1) = 15 THEN elem || '{ "importance": "S" }'::jsonb
      WHEN (ordinality - 1) = 16 THEN elem || '{ "importance": "S" }'::jsonb
      WHEN (ordinality - 1) = 17 THEN elem || '{ "importance": "P" }'::jsonb
      WHEN (ordinality - 1) = 18 THEN elem || '{ "importance": "S" }'::jsonb
      WHEN (ordinality - 1) = 19 THEN elem || '{ "importance": "S" }'::jsonb
      WHEN (ordinality - 1) = 20 THEN elem || '{ "importance": "P" }'::jsonb
      WHEN (ordinality - 1) = 21 THEN elem || '{ "importance": "P" }'::jsonb
      WHEN (ordinality - 1) = 22 THEN elem || '{ "importance": "S" }'::jsonb
      ELSE elem
    END
    ORDER BY ordinality
  )
  FROM jsonb_array_elements(field_definitions) WITH ORDINALITY AS t(elem, ordinality)
) WHERE skill_id = 'rfi';

-- contract
UPDATE document_skills SET field_definitions = (
  SELECT jsonb_agg(
    CASE
      WHEN (ordinality - 1) = 0 THEN elem || '{ "importance": "A" }'::jsonb
      WHEN (ordinality - 1) = 1 THEN elem || '{ "importance": "E" }'::jsonb
      WHEN (ordinality - 1) = 2 THEN elem || '{ "importance": "E" }'::jsonb
      WHEN (ordinality - 1) = 3 THEN elem || '{ "importance": "S" }'::jsonb
      WHEN (ordinality - 1) = 4 THEN elem || '{ "importance": "S" }'::jsonb
      WHEN (ordinality - 1) = 5 THEN elem || '{ "importance": "P" }'::jsonb
      WHEN (ordinality - 1) = 6 THEN elem || '{ "importance": "P" }'::jsonb
      WHEN (ordinality - 1) = 7 THEN elem || '{ "importance": "P" }'::jsonb
      WHEN (ordinality - 1) = 8 THEN elem || '{ "importance": "S" }'::jsonb
      WHEN (ordinality - 1) = 9 THEN elem || '{ "importance": "P" }'::jsonb
      WHEN (ordinality - 1) = 10 THEN elem || '{ "importance": "S" }'::jsonb
      WHEN (ordinality - 1) = 11 THEN elem || '{ "importance": "P" }'::jsonb
      WHEN (ordinality - 1) = 12 THEN elem || '{ "importance": "S" }'::jsonb
      WHEN (ordinality - 1) = 13 THEN elem || '{ "importance": "S" }'::jsonb
      ELSE elem
    END
    ORDER BY ordinality
  )
  FROM jsonb_array_elements(field_definitions) WITH ORDINALITY AS t(elem, ordinality)
) WHERE skill_id = 'contract';

-- design_change
UPDATE document_skills SET field_definitions = (
  SELECT jsonb_agg(
    CASE
      WHEN (ordinality - 1) = 0 THEN elem || '{ "importance": "A" }'::jsonb
      WHEN (ordinality - 1) = 1 THEN elem || '{ "importance": "E" }'::jsonb
      WHEN (ordinality - 1) = 2 THEN elem || '{ "importance": "P" }'::jsonb
      WHEN (ordinality - 1) = 3 THEN elem || '{ "importance": "S" }'::jsonb
      WHEN (ordinality - 1) = 4 THEN elem || '{ "importance": "P" }'::jsonb
      WHEN (ordinality - 1) = 5 THEN elem || '{ "importance": "S" }'::jsonb
      WHEN (ordinality - 1) = 6 THEN elem || '{ "importance": "P" }'::jsonb
      WHEN (ordinality - 1) = 7 THEN elem || '{ "importance": "P" }'::jsonb
      WHEN (ordinality - 1) = 8 THEN elem || '{ "importance": "S" }'::jsonb
      WHEN (ordinality - 1) = 9 THEN elem || '{ "importance": "P" }'::jsonb
      WHEN (ordinality - 1) = 10 THEN elem || '{ "importance": "P" }'::jsonb
      WHEN (ordinality - 1) = 11 THEN elem || '{ "importance": "P" }'::jsonb
      WHEN (ordinality - 1) = 12 THEN elem || '{ "importance": "P" }'::jsonb
      WHEN (ordinality - 1) = 13 THEN elem || '{ "importance": "S" }'::jsonb
      WHEN (ordinality - 1) = 14 THEN elem || '{ "importance": "A" }'::jsonb
      WHEN (ordinality - 1) = 15 THEN elem || '{ "importance": "P" }'::jsonb
      WHEN (ordinality - 1) = 16 THEN elem || '{ "importance": "S" }'::jsonb
      WHEN (ordinality - 1) = 17 THEN elem || '{ "importance": "S" }'::jsonb
      WHEN (ordinality - 1) = 18 THEN elem || '{ "importance": "S" }'::jsonb
      WHEN (ordinality - 1) = 19 THEN elem || '{ "importance": "S" }'::jsonb
      WHEN (ordinality - 1) = 20 THEN elem || '{ "importance": "S" }'::jsonb
      WHEN (ordinality - 1) = 21 THEN elem || '{ "importance": "P" }'::jsonb
      WHEN (ordinality - 1) = 22 THEN elem || '{ "importance": "S" }'::jsonb
      WHEN (ordinality - 1) = 23 THEN elem || '{ "importance": "S" }'::jsonb
      WHEN (ordinality - 1) = 24 THEN elem || '{ "importance": "A" }'::jsonb
      WHEN (ordinality - 1) = 25 THEN elem || '{ "importance": "P" }'::jsonb
      WHEN (ordinality - 1) = 26 THEN elem || '{ "importance": "P" }'::jsonb
      WHEN (ordinality - 1) = 27 THEN elem || '{ "importance": "S" }'::jsonb
      WHEN (ordinality - 1) = 28 THEN elem || '{ "importance": "S" }'::jsonb
      WHEN (ordinality - 1) = 29 THEN elem || '{ "importance": "P" }'::jsonb
      WHEN (ordinality - 1) = 30 THEN elem || '{ "importance": "P" }'::jsonb
      WHEN (ordinality - 1) = 31 THEN elem || '{ "importance": "P" }'::jsonb
      WHEN (ordinality - 1) = 32 THEN elem || '{ "importance": "P" }'::jsonb
      WHEN (ordinality - 1) = 33 THEN elem || '{ "importance": "P" }'::jsonb
      WHEN (ordinality - 1) = 34 THEN elem || '{ "importance": "S" }'::jsonb
      WHEN (ordinality - 1) = 35 THEN elem || '{ "importance": "P" }'::jsonb
      WHEN (ordinality - 1) = 36 THEN elem || '{ "importance": "A" }'::jsonb
      WHEN (ordinality - 1) = 37 THEN elem || '{ "importance": "S" }'::jsonb
      WHEN (ordinality - 1) = 38 THEN elem || '{ "importance": "P" }'::jsonb
      WHEN (ordinality - 1) = 39 THEN elem || '{ "importance": "P" }'::jsonb
      WHEN (ordinality - 1) = 40 THEN elem || '{ "importance": "P" }'::jsonb
      ELSE elem
    END
    ORDER BY ordinality
  )
  FROM jsonb_array_elements(field_definitions) WITH ORDINALITY AS t(elem, ordinality)
) WHERE skill_id = 'design_change';

-- estimate
UPDATE document_skills SET field_definitions = (
  SELECT jsonb_agg(
    CASE
      WHEN (ordinality - 1) = 0 THEN elem || '{ "importance": "A" }'::jsonb
      WHEN (ordinality - 1) = 1 THEN elem || '{ "importance": "E" }'::jsonb
      WHEN (ordinality - 1) = 2 THEN elem || '{ "importance": "E" }'::jsonb
      WHEN (ordinality - 1) = 3 THEN elem || '{ "importance": "S" }'::jsonb
      WHEN (ordinality - 1) = 4 THEN elem || '{ "importance": "P" }'::jsonb
      WHEN (ordinality - 1) = 5 THEN elem || '{ "importance": "P" }'::jsonb
      WHEN (ordinality - 1) = 6 THEN elem || '{ "importance": "P" }'::jsonb
      WHEN (ordinality - 1) = 7 THEN elem || '{ "importance": "P" }'::jsonb
      WHEN (ordinality - 1) = 8 THEN elem || '{ "importance": "P" }'::jsonb
      WHEN (ordinality - 1) = 9 THEN elem || '{ "importance": "S" }'::jsonb
      WHEN (ordinality - 1) = 10 THEN elem || '{ "importance": "P" }'::jsonb
      WHEN (ordinality - 1) = 11 THEN elem || '{ "importance": "P" }'::jsonb
      WHEN (ordinality - 1) = 12 THEN elem || '{ "importance": "S" }'::jsonb
      WHEN (ordinality - 1) = 13 THEN elem || '{ "importance": "S" }'::jsonb
      WHEN (ordinality - 1) = 14 THEN elem || '{ "importance": "S" }'::jsonb
      WHEN (ordinality - 1) = 15 THEN elem || '{ "importance": "S" }'::jsonb
      WHEN (ordinality - 1) = 16 THEN elem || '{ "importance": "P" }'::jsonb
      WHEN (ordinality - 1) = 17 THEN elem || '{ "importance": "P" }'::jsonb
      WHEN (ordinality - 1) = 18 THEN elem || '{ "importance": "P" }'::jsonb
      WHEN (ordinality - 1) = 19 THEN elem || '{ "importance": "S" }'::jsonb
      WHEN (ordinality - 1) = 20 THEN elem || '{ "importance": "P" }'::jsonb
      WHEN (ordinality - 1) = 21 THEN elem || '{ "importance": "P" }'::jsonb
      WHEN (ordinality - 1) = 22 THEN elem || '{ "importance": "S" }'::jsonb
      WHEN (ordinality - 1) = 23 THEN elem || '{ "importance": "S" }'::jsonb
      WHEN (ordinality - 1) = 24 THEN elem || '{ "importance": "S" }'::jsonb
      WHEN (ordinality - 1) = 25 THEN elem || '{ "importance": "P" }'::jsonb
      WHEN (ordinality - 1) = 26 THEN elem || '{ "importance": "P" }'::jsonb
      WHEN (ordinality - 1) = 27 THEN elem || '{ "importance": "S" }'::jsonb
      WHEN (ordinality - 1) = 28 THEN elem || '{ "importance": "P" }'::jsonb
      WHEN (ordinality - 1) = 29 THEN elem || '{ "importance": "P" }'::jsonb
      WHEN (ordinality - 1) = 30 THEN elem || '{ "importance": "P" }'::jsonb
      WHEN (ordinality - 1) = 31 THEN elem || '{ "importance": "P" }'::jsonb
      WHEN (ordinality - 1) = 32 THEN elem || '{ "importance": "S" }'::jsonb
      ELSE elem
    END
    ORDER BY ordinality
  )
  FROM jsonb_array_elements(field_definitions) WITH ORDINALITY AS t(elem, ordinality)
) WHERE skill_id = 'estimate';

-- sub_bid
UPDATE document_skills SET field_definitions = (
  SELECT jsonb_agg(
    CASE
      WHEN (ordinality - 1) = 0 THEN elem || '{ "importance": "A" }'::jsonb
      WHEN (ordinality - 1) = 1 THEN elem || '{ "importance": "E" }'::jsonb
      WHEN (ordinality - 1) = 2 THEN elem || '{ "importance": "S" }'::jsonb
      WHEN (ordinality - 1) = 3 THEN elem || '{ "importance": "S" }'::jsonb
      WHEN (ordinality - 1) = 4 THEN elem || '{ "importance": "S" }'::jsonb
      WHEN (ordinality - 1) = 5 THEN elem || '{ "importance": "S" }'::jsonb
      WHEN (ordinality - 1) = 6 THEN elem || '{ "importance": "S" }'::jsonb
      WHEN (ordinality - 1) = 7 THEN elem || '{ "importance": "S" }'::jsonb
      WHEN (ordinality - 1) = 8 THEN elem || '{ "importance": "E" }'::jsonb
      WHEN (ordinality - 1) = 9 THEN elem || '{ "importance": "P" }'::jsonb
      WHEN (ordinality - 1) = 10 THEN elem || '{ "importance": "S" }'::jsonb
      WHEN (ordinality - 1) = 11 THEN elem || '{ "importance": "P" }'::jsonb
      WHEN (ordinality - 1) = 12 THEN elem || '{ "importance": "S" }'::jsonb
      WHEN (ordinality - 1) = 13 THEN elem || '{ "importance": "S" }'::jsonb
      WHEN (ordinality - 1) = 14 THEN elem || '{ "importance": "S" }'::jsonb
      WHEN (ordinality - 1) = 15 THEN elem || '{ "importance": "E" }'::jsonb
      WHEN (ordinality - 1) = 16 THEN elem || '{ "importance": "S" }'::jsonb
      WHEN (ordinality - 1) = 17 THEN elem || '{ "importance": "P" }'::jsonb
      WHEN (ordinality - 1) = 18 THEN elem || '{ "importance": "P" }'::jsonb
      WHEN (ordinality - 1) = 19 THEN elem || '{ "importance": "P" }'::jsonb
      WHEN (ordinality - 1) = 20 THEN elem || '{ "importance": "P" }'::jsonb
      WHEN (ordinality - 1) = 21 THEN elem || '{ "importance": "P" }'::jsonb
      WHEN (ordinality - 1) = 22 THEN elem || '{ "importance": "P" }'::jsonb
      WHEN (ordinality - 1) = 23 THEN elem || '{ "importance": "S" }'::jsonb
      WHEN (ordinality - 1) = 24 THEN elem || '{ "importance": "S" }'::jsonb
      WHEN (ordinality - 1) = 25 THEN elem || '{ "importance": "S" }'::jsonb
      WHEN (ordinality - 1) = 26 THEN elem || '{ "importance": "S" }'::jsonb
      WHEN (ordinality - 1) = 27 THEN elem || '{ "importance": "P" }'::jsonb
      WHEN (ordinality - 1) = 28 THEN elem || '{ "importance": "S" }'::jsonb
      ELSE elem
    END
    ORDER BY ordinality
  )
  FROM jsonb_array_elements(field_definitions) WITH ORDINALITY AS t(elem, ordinality)
) WHERE skill_id = 'sub_bid';

-- submittal
UPDATE document_skills SET field_definitions = (
  SELECT jsonb_agg(
    CASE
      WHEN (ordinality - 1) = 0 THEN elem || '{ "importance": "A" }'::jsonb
      WHEN (ordinality - 1) = 1 THEN elem || '{ "importance": "E" }'::jsonb
      WHEN (ordinality - 1) = 2 THEN elem || '{ "importance": "E" }'::jsonb
      WHEN (ordinality - 1) = 3 THEN elem || '{ "importance": "S" }'::jsonb
      WHEN (ordinality - 1) = 4 THEN elem || '{ "importance": "S" }'::jsonb
      WHEN (ordinality - 1) = 5 THEN elem || '{ "importance": "P" }'::jsonb
      WHEN (ordinality - 1) = 6 THEN elem || '{ "importance": "P" }'::jsonb
      WHEN (ordinality - 1) = 7 THEN elem || '{ "importance": "S" }'::jsonb
      WHEN (ordinality - 1) = 8 THEN elem || '{ "importance": "S" }'::jsonb
      WHEN (ordinality - 1) = 9 THEN elem || '{ "importance": "S" }'::jsonb
      WHEN (ordinality - 1) = 10 THEN elem || '{ "importance": "S" }'::jsonb
      WHEN (ordinality - 1) = 11 THEN elem || '{ "importance": "P" }'::jsonb
      WHEN (ordinality - 1) = 12 THEN elem || '{ "importance": "P" }'::jsonb
      WHEN (ordinality - 1) = 13 THEN elem || '{ "importance": "S" }'::jsonb
      WHEN (ordinality - 1) = 14 THEN elem || '{ "importance": "S" }'::jsonb
      WHEN (ordinality - 1) = 15 THEN elem || '{ "importance": "S" }'::jsonb
      WHEN (ordinality - 1) = 16 THEN elem || '{ "importance": "S" }'::jsonb
      WHEN (ordinality - 1) = 17 THEN elem || '{ "importance": "S" }'::jsonb
      ELSE elem
    END
    ORDER BY ordinality
  )
  FROM jsonb_array_elements(field_definitions) WITH ORDINALITY AS t(elem, ordinality)
) WHERE skill_id = 'submittal';

-- daily_report
UPDATE document_skills SET field_definitions = (
  SELECT jsonb_agg(
    CASE
      WHEN (ordinality - 1) = 0 THEN elem || '{ "importance": "A" }'::jsonb
      WHEN (ordinality - 1) = 1 THEN elem || '{ "importance": "S" }'::jsonb
      WHEN (ordinality - 1) = 2 THEN elem || '{ "importance": "S" }'::jsonb
      WHEN (ordinality - 1) = 3 THEN elem || '{ "importance": "P" }'::jsonb
      WHEN (ordinality - 1) = 4 THEN elem || '{ "importance": "P" }'::jsonb
      WHEN (ordinality - 1) = 5 THEN elem || '{ "importance": "S" }'::jsonb
      WHEN (ordinality - 1) = 6 THEN elem || '{ "importance": "P" }'::jsonb
      WHEN (ordinality - 1) = 7 THEN elem || '{ "importance": "P" }'::jsonb
      WHEN (ordinality - 1) = 8 THEN elem || '{ "importance": "S" }'::jsonb
      WHEN (ordinality - 1) = 9 THEN elem || '{ "importance": "P" }'::jsonb
      WHEN (ordinality - 1) = 10 THEN elem || '{ "importance": "P" }'::jsonb
      WHEN (ordinality - 1) = 11 THEN elem || '{ "importance": "S" }'::jsonb
      ELSE elem
    END
    ORDER BY ordinality
  )
  FROM jsonb_array_elements(field_definitions) WITH ORDINALITY AS t(elem, ordinality)
) WHERE skill_id = 'daily_report';

-- production_activity
UPDATE document_skills SET field_definitions = (
  SELECT jsonb_agg(
    CASE
      WHEN (ordinality - 1) = 0 THEN elem || '{ "importance": "A" }'::jsonb
      WHEN (ordinality - 1) = 1 THEN elem || '{ "importance": "E" }'::jsonb
      WHEN (ordinality - 1) = 2 THEN elem || '{ "importance": "S" }'::jsonb
      WHEN (ordinality - 1) = 3 THEN elem || '{ "importance": "P" }'::jsonb
      WHEN (ordinality - 1) = 4 THEN elem || '{ "importance": "P" }'::jsonb
      WHEN (ordinality - 1) = 5 THEN elem || '{ "importance": "S" }'::jsonb
      WHEN (ordinality - 1) = 6 THEN elem || '{ "importance": "S" }'::jsonb
      WHEN (ordinality - 1) = 7 THEN elem || '{ "importance": "E" }'::jsonb
      WHEN (ordinality - 1) = 8 THEN elem || '{ "importance": "P" }'::jsonb
      WHEN (ordinality - 1) = 9 THEN elem || '{ "importance": "P" }'::jsonb
      WHEN (ordinality - 1) = 10 THEN elem || '{ "importance": "S" }'::jsonb
      WHEN (ordinality - 1) = 11 THEN elem || '{ "importance": "P" }'::jsonb
      WHEN (ordinality - 1) = 12 THEN elem || '{ "importance": "S" }'::jsonb
      WHEN (ordinality - 1) = 13 THEN elem || '{ "importance": "P" }'::jsonb
      WHEN (ordinality - 1) = 14 THEN elem || '{ "importance": "P" }'::jsonb
      WHEN (ordinality - 1) = 15 THEN elem || '{ "importance": "P" }'::jsonb
      WHEN (ordinality - 1) = 16 THEN elem || '{ "importance": "P" }'::jsonb
      WHEN (ordinality - 1) = 17 THEN elem || '{ "importance": "P" }'::jsonb
      WHEN (ordinality - 1) = 18 THEN elem || '{ "importance": "P" }'::jsonb
      WHEN (ordinality - 1) = 19 THEN elem || '{ "importance": "P" }'::jsonb
      WHEN (ordinality - 1) = 20 THEN elem || '{ "importance": "S" }'::jsonb
      WHEN (ordinality - 1) = 21 THEN elem || '{ "importance": "S" }'::jsonb
      WHEN (ordinality - 1) = 22 THEN elem || '{ "importance": "S" }'::jsonb
      WHEN (ordinality - 1) = 23 THEN elem || '{ "importance": "S" }'::jsonb
      WHEN (ordinality - 1) = 24 THEN elem || '{ "importance": "P" }'::jsonb
      WHEN (ordinality - 1) = 25 THEN elem || '{ "importance": "P" }'::jsonb
      WHEN (ordinality - 1) = 26 THEN elem || '{ "importance": "P" }'::jsonb
      WHEN (ordinality - 1) = 27 THEN elem || '{ "importance": "P" }'::jsonb
      WHEN (ordinality - 1) = 28 THEN elem || '{ "importance": "P" }'::jsonb
      WHEN (ordinality - 1) = 29 THEN elem || '{ "importance": "P" }'::jsonb
      WHEN (ordinality - 1) = 30 THEN elem || '{ "importance": "S" }'::jsonb
      WHEN (ordinality - 1) = 31 THEN elem || '{ "importance": "S" }'::jsonb
      WHEN (ordinality - 1) = 32 THEN elem || '{ "importance": "P" }'::jsonb
      WHEN (ordinality - 1) = 33 THEN elem || '{ "importance": "P" }'::jsonb
      WHEN (ordinality - 1) = 34 THEN elem || '{ "importance": "P" }'::jsonb
      WHEN (ordinality - 1) = 35 THEN elem || '{ "importance": "P" }'::jsonb
      WHEN (ordinality - 1) = 36 THEN elem || '{ "importance": "P" }'::jsonb
      ELSE elem
    END
    ORDER BY ordinality
  )
  FROM jsonb_array_elements(field_definitions) WITH ORDINALITY AS t(elem, ordinality)
) WHERE skill_id = 'production_activity';

-- safety_inspection
UPDATE document_skills SET field_definitions = (
  SELECT jsonb_agg(
    CASE
      WHEN (ordinality - 1) = 0 THEN elem || '{ "importance": "A" }'::jsonb
      WHEN (ordinality - 1) = 1 THEN elem || '{ "importance": "E" }'::jsonb
      WHEN (ordinality - 1) = 2 THEN elem || '{ "importance": "S" }'::jsonb
      WHEN (ordinality - 1) = 3 THEN elem || '{ "importance": "S" }'::jsonb
      WHEN (ordinality - 1) = 4 THEN elem || '{ "importance": "S" }'::jsonb
      WHEN (ordinality - 1) = 5 THEN elem || '{ "importance": "S" }'::jsonb
      WHEN (ordinality - 1) = 6 THEN elem || '{ "importance": "S" }'::jsonb
      WHEN (ordinality - 1) = 7 THEN elem || '{ "importance": "S" }'::jsonb
      WHEN (ordinality - 1) = 8 THEN elem || '{ "importance": "S" }'::jsonb
      WHEN (ordinality - 1) = 9 THEN elem || '{ "importance": "S" }'::jsonb
      WHEN (ordinality - 1) = 10 THEN elem || '{ "importance": "S" }'::jsonb
      WHEN (ordinality - 1) = 11 THEN elem || '{ "importance": "S" }'::jsonb
      WHEN (ordinality - 1) = 12 THEN elem || '{ "importance": "S" }'::jsonb
      WHEN (ordinality - 1) = 13 THEN elem || '{ "importance": "S" }'::jsonb
      WHEN (ordinality - 1) = 14 THEN elem || '{ "importance": "P" }'::jsonb
      WHEN (ordinality - 1) = 15 THEN elem || '{ "importance": "S" }'::jsonb
      WHEN (ordinality - 1) = 16 THEN elem || '{ "importance": "S" }'::jsonb
      ELSE elem
    END
    ORDER BY ordinality
  )
  FROM jsonb_array_elements(field_definitions) WITH ORDINALITY AS t(elem, ordinality)
) WHERE skill_id = 'safety_inspection';

-- project_admin
UPDATE document_skills SET field_definitions = (
  SELECT jsonb_agg(
    CASE
      WHEN (ordinality - 1) = 0 THEN elem || '{ "importance": "A" }'::jsonb
      WHEN (ordinality - 1) = 1 THEN elem || '{ "importance": "S" }'::jsonb
      WHEN (ordinality - 1) = 2 THEN elem || '{ "importance": "S" }'::jsonb
      WHEN (ordinality - 1) = 3 THEN elem || '{ "importance": "S" }'::jsonb
      WHEN (ordinality - 1) = 4 THEN elem || '{ "importance": "S" }'::jsonb
      WHEN (ordinality - 1) = 5 THEN elem || '{ "importance": "S" }'::jsonb
      WHEN (ordinality - 1) = 6 THEN elem || '{ "importance": "S" }'::jsonb
      WHEN (ordinality - 1) = 7 THEN elem || '{ "importance": "S" }'::jsonb
      WHEN (ordinality - 1) = 8 THEN elem || '{ "importance": "A" }'::jsonb
      WHEN (ordinality - 1) = 9 THEN elem || '{ "importance": "P" }'::jsonb
      WHEN (ordinality - 1) = 10 THEN elem || '{ "importance": "P" }'::jsonb
      WHEN (ordinality - 1) = 11 THEN elem || '{ "importance": "P" }'::jsonb
      WHEN (ordinality - 1) = 12 THEN elem || '{ "importance": "S" }'::jsonb
      WHEN (ordinality - 1) = 13 THEN elem || '{ "importance": "P" }'::jsonb
      WHEN (ordinality - 1) = 14 THEN elem || '{ "importance": "P" }'::jsonb
      WHEN (ordinality - 1) = 15 THEN elem || '{ "importance": "P" }'::jsonb
      WHEN (ordinality - 1) = 16 THEN elem || '{ "importance": "S" }'::jsonb
      WHEN (ordinality - 1) = 17 THEN elem || '{ "importance": "P" }'::jsonb
      WHEN (ordinality - 1) = 18 THEN elem || '{ "importance": "A" }'::jsonb
      WHEN (ordinality - 1) = 19 THEN elem || '{ "importance": "S" }'::jsonb
      WHEN (ordinality - 1) = 20 THEN elem || '{ "importance": "S" }'::jsonb
      WHEN (ordinality - 1) = 21 THEN elem || '{ "importance": "P" }'::jsonb
      WHEN (ordinality - 1) = 22 THEN elem || '{ "importance": "P" }'::jsonb
      WHEN (ordinality - 1) = 23 THEN elem || '{ "importance": "S" }'::jsonb
      WHEN (ordinality - 1) = 24 THEN elem || '{ "importance": "A" }'::jsonb
      WHEN (ordinality - 1) = 25 THEN elem || '{ "importance": "P" }'::jsonb
      WHEN (ordinality - 1) = 26 THEN elem || '{ "importance": "P" }'::jsonb
      WHEN (ordinality - 1) = 27 THEN elem || '{ "importance": "S" }'::jsonb
      WHEN (ordinality - 1) = 28 THEN elem || '{ "importance": "P" }'::jsonb
      WHEN (ordinality - 1) = 29 THEN elem || '{ "importance": "P" }'::jsonb
      WHEN (ordinality - 1) = 30 THEN elem || '{ "importance": "P" }'::jsonb
      WHEN (ordinality - 1) = 31 THEN elem || '{ "importance": "S" }'::jsonb
      ELSE elem
    END
    ORDER BY ordinality
  )
  FROM jsonb_array_elements(field_definitions) WITH ORDINALITY AS t(elem, ordinality)
) WHERE skill_id = 'project_admin';

-- ============================================================
-- PART 2: Add 6 missing fields to safety_inspection
-- ============================================================

UPDATE document_skills SET field_definitions = field_definitions || '[{"name":"Inspection Location / Area","type":"string","tier":1,"required":false,"description":"Physical location or area where inspection was conducted. Used for punch list pattern prediction by area.","importance":"S"},{"name":"Inspector / Jurisdiction","type":"string","tier":0,"required":false,"description":"Inspector name or jurisdiction authority. Different inspectors have different stringency levels.","importance":"S"},{"name":"Re-Inspection Required?","type":"boolean","tier":0,"required":false,"description":"Whether a re-inspection is needed. Re-inspection = rework = cost and schedule delay.","importance":"P"},{"name":"Days to Re-Inspection","type":"number","tier":0,"required":false,"description":"Calendar days until re-inspection. Measures re-inspection velocity and scheduling impact.","importance":"S"},{"name":"Corrective Action Deadline","type":"date","tier":0,"required":false,"description":"Deadline for completing corrective action before re-inspection. Critical for compliance timeline management.","importance":"S"},{"name":"Related Punch List Items","type":"array","tier":3,"required":false,"description":"Linked punch list item IDs. Connects inspection failures to punch list items for traceability.","importance":"S"}]'::jsonb
WHERE skill_id = 'safety_inspection';

-- ============================================================
-- PART 3: Create job_cost_report skill (37 fields)
-- ============================================================

INSERT INTO document_skills (skill_id, display_name, version, status, system_prompt, field_definitions, target_table, multi_record_config, column_mapping, sample_extractions, classifier_hints, extraction_instructions, reference_doc_ids)
VALUES (
  'job_cost_report',
  'Job Cost Report',
  1,
  'active',
  'You are a construction document data extraction AI specializing in job cost reports and financial documents from accounting/ERP systems like Sage, QuickBooks, and Procore. Extract all structured data including summary-level totals and line-item detail. Pay special attention to budget vs actual variance, change order allocations, and cost code classifications.',
  '[{"name":"Report ID","type":"string","tier":0,"required":false,"description":"Unique identifier for the job cost report.","importance":"A"},{"name":"Company / Entity","type":"string","tier":0,"required":false,"description":"Company or entity the report belongs to.","importance":"E"},{"name":"Job Number","type":"string","tier":0,"required":true,"description":"Job number from the accounting/ERP system.","importance":"E"},{"name":"Project Name / Description","type":"string","tier":0,"required":true,"description":"Project name or description as shown in the accounting system.","importance":"E"},{"name":"Report Period","type":"string","tier":0,"required":true,"description":"The time period this report covers (e.g., month, quarter).","importance":"P"},{"name":"Report Date","type":"date","tier":0,"required":false,"description":"Date the report was generated.","importance":"E"},{"name":"Report Category / Filter","type":"string","tier":0,"required":false,"description":"Category or filter applied to the report (e.g., cost type, division).","importance":"S"},{"name":"Total Revised Budget","type":"number","tier":0,"required":true,"description":"Total revised budget amount including all approved change orders.","importance":"P"},{"name":"Total Job-to-Date Cost","type":"number","tier":0,"required":true,"description":"Total costs incurred on the job from inception to the report date.","importance":"P"},{"name":"Total Change Orders","type":"number","tier":0,"required":false,"description":"Total dollar amount of all approved change orders.","importance":"P"},{"name":"Overall % Budget Consumed","type":"number","tier":0,"required":false,"description":"Percentage of revised budget that has been spent (JTD / Revised Budget).","importance":"P"},{"name":"Total Over/Under Budget","type":"number","tier":0,"required":false,"description":"Total dollar variance — positive means over budget, negative means under.","importance":"P"},{"name":"Project Type","type":"string","tier":1,"required":false,"description":"Classification of project type for cross-project comparison.","importance":"P"},{"name":"Trade / Scope","type":"string","tier":1,"required":false,"description":"Primary trade or scope of work for the project.","importance":"P"},{"name":"Cost-to-Complete Estimate","type":"number","tier":2,"required":false,"description":"Estimated cost to complete the remaining work. Used for EAC calculations.","importance":"P"},{"name":"Estimated Margin at Completion","type":"number","tier":2,"required":false,"description":"Projected final margin based on current spend rate and remaining work.","importance":"P"},{"name":"Line Item Number / Cost Code","type":"string","tier":0,"required":false,"description":"Cost code or line item identifier from the ERP system.","importance":"E"},{"name":"Line Item Description","type":"string","tier":0,"required":false,"description":"Description of the cost code or line item.","importance":"E"},{"name":"Revised Budget (line)","type":"number","tier":0,"required":false,"description":"Revised budget for this specific line item.","importance":"P"},{"name":"Change Orders (line)","type":"number","tier":0,"required":false,"description":"Change order amount allocated to this line item.","importance":"P"},{"name":"Job-to-Date Cost (line)","type":"number","tier":0,"required":false,"description":"Job-to-date actual cost for this line item.","importance":"P"},{"name":"Quantity (labor hours or units)","type":"number","tier":0,"required":false,"description":"Labor hours or physical units consumed for this line item.","importance":"P"},{"name":"% Budget Consumed (line)","type":"number","tier":0,"required":false,"description":"Percentage of this line items budget that has been consumed.","importance":"P"},{"name":"Over/Under Budget — $ (line)","type":"number","tier":0,"required":false,"description":"Dollar variance for this line item vs its budget.","importance":"P"},{"name":"Cost Category","type":"string","tier":1,"required":false,"description":"High-level cost category (Labor, Material, Equipment, Subcontract, Other).","importance":"P"},{"name":"Work Phase / Activity","type":"string","tier":1,"required":false,"description":"Work phase or activity the cost code maps to (rough-in, trim, etc).","importance":"P"},{"name":"CSI Division (Primary)","type":"string","tier":1,"required":false,"description":"Primary CSI division this cost code belongs to.","importance":"P"},{"name":"UniFormat Equivalent","type":"string","tier":0,"required":false,"description":"UniFormat classification equivalent for cross-project benchmarking.","importance":"S"},{"name":"Variance Trend (vs prior period)","type":"string","tier":2,"required":false,"description":"Whether variance is improving, stable, or worsening vs prior period.","importance":"P"},{"name":"Labor Productivity Rate ($/hr)","type":"number","tier":0,"required":false,"description":"Effective labor rate calculated from cost and hours.","importance":"P"},{"name":"Estimated Labor Rate (from bid)","type":"number","tier":2,"required":false,"description":"Labor rate assumed in the original bid/estimate. Used for rate creep analysis.","importance":"P"},{"name":"Material Price Variance","type":"number","tier":2,"required":false,"description":"Difference between budgeted and actual material unit costs.","importance":"P"},{"name":"Labor-to-Material Ratio","type":"number","tier":0,"required":false,"description":"Ratio of labor cost to material cost for this line item.","importance":"P"},{"name":"CO Absorption Rate (line)","type":"number","tier":0,"required":false,"description":"What percentage of this line items cost is covered by change orders.","importance":"P"},{"name":"Variance Root Cause (per line)","type":"string","tier":3,"required":false,"description":"Root cause explanation for variance on this line item. Requires human judgment.","importance":"P"},{"name":"Line Item Forecast to Complete","type":"number","tier":3,"required":false,"description":"Forecasted cost to complete this specific line item.","importance":"P"},{"name":"Lessons Learned / Estimating Flag","type":"string","tier":3,"required":false,"description":"Flag for estimating feedback — whether this line item should adjust future bids.","importance":"P"}]'::jsonb,
  'extracted_records',
  NULL,
  '{}'::jsonb,
  '[]'::jsonb,
  '{"description":"Job cost reports from accounting/ERP systems (Sage, QuickBooks). Contains budget vs actual cost data at the cost-code level with revised budgets, JTD costs, change orders, and over/under variance by line item.","keywords":["job cost","cost report","budget","JTD","job to date","cost code","revised budget","over under","variance","Sage","QuickBooks","cost to complete","margin"]}'::jsonb,
  '',
  '[]'::jsonb
)
ON CONFLICT (skill_id) DO UPDATE SET
  field_definitions = EXCLUDED.field_definitions,
  classifier_hints = EXCLUDED.classifier_hints,
  system_prompt = EXCLUDED.system_prompt;

-- ============================================================
-- PART 4: Fix classifier_hints keywords on all skills
-- ============================================================

UPDATE document_skills SET classifier_hints = '{"description":"Change order requests, modifications, and amendments to construction contracts. Includes CORs, PCOs, and approved change orders with scope, cost, and schedule impacts.","keywords":["change order","CO","COR","modification","amendment","approved amount","scope change","cost impact","PCO","proposed change"]}'::jsonb WHERE skill_id = 'change_order';
UPDATE document_skills SET classifier_hints = '{"description":"Requests for Information (RFIs) seeking clarification on design documents, specifications, or construction details. Includes questions, responses, and impact assessments.","keywords":["RFI","request for information","clarification","response required","submittal question","design clarification","spec question"]}'::jsonb WHERE skill_id = 'rfi';
UPDATE document_skills SET classifier_hints = '{"description":"Construction contracts, subcontracts, and agreements including scope of work, terms and conditions, and clause analysis. AIA standard forms, custom contracts.","keywords":["contract","agreement","subcontract","scope of work","terms and conditions","AIA","indemnification","article","clause"]}'::jsonb WHERE skill_id = 'contract';
UPDATE document_skills SET classifier_hints = '{"description":"Design changes including ASIs (Architect Supplemental Instructions), CCDs (Construction Change Directives), bulletins, sketches, and proposal requests that modify the original design.","keywords":["ASI","architect supplemental instruction","CCD","construction change directive","bulletin","sketch","proposal request","PCO","design revision","addendum"]}'::jsonb WHERE skill_id = 'design_change';
UPDATE document_skills SET classifier_hints = '{"description":"Bid estimates, proposals, and pricing documents. Includes cost breakdowns, labor rates, material pricing, and bid analysis for construction projects.","keywords":["bid","estimate","proposal","quote","pricing","cost breakdown","GMP","hard bid","budget","takeoff"]}'::jsonb WHERE skill_id = 'estimate';
UPDATE document_skills SET classifier_hints = '{"description":"Subcontractor bid packages, bid tabulations, and buyout analysis. Compares multiple sub bids for scope coverage, pricing, and qualification.","keywords":["sub bid","subcontractor bid","bid tabulation","bid comparison","scope","solicited","buyout","bid package","sub quote"]}'::jsonb WHERE skill_id = 'sub_bid';
UPDATE document_skills SET classifier_hints = '{"description":"Submittals including shop drawings, product data, samples, and material approvals. Tracks review cycles, dispositions, and resubmittals.","keywords":["submittal","shop drawing","product data","sample","review","approval","resubmittal","material approval"]}'::jsonb WHERE skill_id = 'submittal';
UPDATE document_skills SET classifier_hints = '{"description":"Daily field reports documenting work performed, crews on site, weather conditions, issues, and delays. Written by superintendents or foremen.","keywords":["daily report","field report","daily log","site report","crew","work performed","weather","superintendent"]}'::jsonb WHERE skill_id = 'daily_report';
UPDATE document_skills SET classifier_hints = '{"description":"Production and labor activity tracking including quantities installed, labor hours, crew composition, productivity rates, and disruption events.","keywords":["production","labor hours","crew","quantity installed","productivity rate","foreman","disruption","overtime","man hours"]}'::jsonb WHERE skill_id = 'production_activity';
UPDATE document_skills SET classifier_hints = '{"description":"Safety observations, incident reports, near-miss reports, OSHA inspections, and trade inspections including pass/fail results and corrective actions.","keywords":["safety","inspection","incident","near miss","hazard","violation","OSHA","observation","corrective action","pass","fail"]}'::jsonb WHERE skill_id = 'safety_inspection';
UPDATE document_skills SET classifier_hints = '{"description":"Project administration documents including meeting minutes, pay applications, correspondence, punch lists, notices, closeout documents, and retainage tracking.","keywords":["meeting minutes","pay application","correspondence","punch list","notice","closeout","retainage","billing","pay app","SOV"]}'::jsonb WHERE skill_id = 'project_admin';

COMMIT;
-- Create purchase_order document skill

INSERT INTO document_skills (
  skill_id, display_name, status, version, target_table,
  column_mapping, multi_record_config, sample_extractions,
  field_definitions, classifier_hints,
  system_prompt, extraction_instructions, reference_doc_ids
)
SELECT
  'purchase_order', 'Purchase Order', 'active', 1, 'documents',
  '{}'::jsonb, '{}'::jsonb, '[]'::jsonb,
  '[
    {"name": "PO_Number", "type": "string", "tier": 1, "required": true, "description": "Purchase order number"},
    {"name": "Vendor", "type": "string", "tier": 1, "required": true, "description": "Vendor or supplier name"},
    {"name": "Total_Amount", "type": "number", "tier": 1, "required": true, "description": "Total PO value"},
    {"name": "Date_Issued", "type": "date", "tier": 1, "required": false, "description": "Date the PO was issued"},
    {"name": "Description", "type": "string", "tier": 1, "required": false, "description": "Description of goods or services"},
    {"name": "Status", "type": "string", "tier": 1, "required": false, "description": "PO status"}
  ]'::jsonb,
  '{"description": "Purchase orders for materials, equipment, or services from vendors", "keywords": ["purchase order", "PO", "vendor order", "material order", "procurement"]}'::jsonb,
  'Extract purchase order details including PO number, vendor, amounts, dates, and line items.',
  'Focus on PO number, vendor name, total amount, delivery dates, and payment terms.',
  '{}'
WHERE NOT EXISTS (SELECT 1 FROM document_skills WHERE skill_id = 'purchase_order');

-- Reclassify misidentified PO records (if any exist)
UPDATE extracted_records
SET skill_id = 'purchase_order',
    document_type = 'purchase_order'
WHERE skill_id = 'estimate'
  AND (
    source_file ~* '\bPO[-_\s]?\d' OR
    source_file ~* 'purchase.?order'
  );

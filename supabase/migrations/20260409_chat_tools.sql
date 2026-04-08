-- Migration: chat_tools + chat_prompt_templates
-- Adds operator-defined callable tools and prompt templates for the chat endpoint.

CREATE TABLE chat_tools (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  display_name TEXT NOT NULL,
  description TEXT NOT NULL,
  input_schema JSONB NOT NULL DEFAULT '{}'::jsonb,
  implementation_type TEXT NOT NULL CHECK (implementation_type IN ('sql_query', 'rag_search', 'api_call', 'composite')),
  implementation_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  sample_prompts TEXT[] DEFAULT '{}',
  is_active BOOLEAN DEFAULT true,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(org_id, tool_name)
);

CREATE INDEX idx_chat_tools_org ON chat_tools(org_id);
CREATE INDEX idx_chat_tools_active ON chat_tools(org_id, is_active) WHERE is_active = true;

ALTER TABLE chat_tools ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for chat_tools" ON chat_tools FOR ALL USING (true) WITH CHECK (true);

CREATE TABLE chat_prompt_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL,
  template_name TEXT NOT NULL,
  trigger_description TEXT NOT NULL,
  trigger_keywords TEXT[] DEFAULT '{}',
  system_instructions TEXT NOT NULL,
  response_format TEXT,
  sample_prompts TEXT[] DEFAULT '{}',
  reference_doc_ids UUID[] DEFAULT '{}',
  is_active BOOLEAN DEFAULT true,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(org_id, template_name)
);

CREATE INDEX idx_chat_templates_org ON chat_prompt_templates(org_id);
CREATE INDEX idx_chat_templates_active ON chat_prompt_templates(org_id, is_active) WHERE is_active = true;

ALTER TABLE chat_prompt_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for chat_prompt_templates" ON chat_prompt_templates FOR ALL USING (true) WITH CHECK (true);

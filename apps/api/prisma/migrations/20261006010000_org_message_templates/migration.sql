-- Plantillas de mensajes editables por organización (formulario, cuenta de banco).
ALTER TABLE "organizations" ADD COLUMN "message_templates" JSONB;

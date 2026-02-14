process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/manus_whatsapp";
process.env.MANUS_API_KEY ??= "test-manus-api-key";
process.env.MANUS_BASE_URL ??= "https://open.manus.ai";
process.env.MANUS_WEBHOOK_SECRET ??= "test-webhook-secret-1234";
process.env.MANUS_AGENT_PROFILE ??= "manus-1.6";
process.env.WHATSAPP_AUTH_DIR ??= "./.data/whatsapp-auth";
process.env.WHATSAPP_SESSION_NAME ??= "default";
process.env.INTERNAL_CLEANUP_TOKEN ??= "internal-cleanup-token-1234";

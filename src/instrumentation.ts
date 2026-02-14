/**
 * Next.js instrumentation hook — boots the Baileys WhatsApp connection on server start.
 *
 * Dynamically imports the bootstrap module only in the Node.js runtime
 * to avoid Edge runtime bundling issues with native modules (sharp, libsignal, etc.).
 */

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { bootBaileys } = await import("@/lib/channel/whatsapp-bootstrap");
    await bootBaileys();
  }
}

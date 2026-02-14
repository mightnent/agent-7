import path from "node:path";
import { fileURLToPath } from "node:url";

import type { NextConfig } from "next";

const fileName = fileURLToPath(import.meta.url);
const directory = path.dirname(fileName);

const nextConfig: NextConfig = {
  turbopack: {
    root: directory,
  },
  serverExternalPackages: ["@whiskeysockets/baileys", "pino", "qrcode-terminal"],
};

export default nextConfig;

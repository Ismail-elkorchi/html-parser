import { readdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

const REPORTS_DIR = resolve("reports");
const KEEP_ENTRY = ".gitkeep";

async function main() {
  let entries;
  try {
    entries = await readdir(REPORTS_DIR, { withFileTypes: true });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return;
    }
    throw error;
  }

  for (const entry of entries) {
    if (entry.name === KEEP_ENTRY) {
      continue;
    }
    await rm(resolve(REPORTS_DIR, entry.name), { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

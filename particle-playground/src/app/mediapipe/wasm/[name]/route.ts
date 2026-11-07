import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

const WASM_FILES = new Set([
  "vision_wasm_internal.js",
  "vision_wasm_internal.wasm",
  "vision_wasm_module_internal.js",
  "vision_wasm_module_internal.wasm",
  "vision_wasm_nosimd_internal.js",
  "vision_wasm_nosimd_internal.wasm",
]);

export async function GET(
  _request: Request,
  context: { params: Promise<{ name: string }> },
) {
  const { name } = await context.params;
  if (!WASM_FILES.has(name)) {
    return new NextResponse("Not found", { status: 404 });
  }

  const wasmDirectory = path.join(
    process.cwd(),
    "node_modules",
    "@mediapipe",
    "tasks-vision",
    "wasm",
  );
  const filePath = path.join(wasmDirectory, name);
  const contents = await readFile(filePath);
  const contentType = name.endsWith(".wasm")
    ? "application/wasm"
    : "text/javascript";

  return new NextResponse(new Uint8Array(contents), {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}

import { NextResponse } from "next/server";
import { writeFile, readFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { randomUUID } from "crypto";
import { execFile } from "child_process";
import { promisify } from "util";

export const runtime = "nodejs";
const execFileAsync = promisify(execFile);

function parsePagesFromPdfInfo(stdout: string): number | null {
  const m = stdout.match(/^Pages:\s+(\d+)\s*$/m);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get("file");

    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: "Missing file" }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const pdfPath = path.join(tmpdir(), `${randomUUID()}.pdf`);
    const txtPath = path.join(tmpdir(), `${randomUUID()}.txt`);

    await writeFile(pdfPath, Buffer.from(arrayBuffer));

    // 1) Get page count
    let pages: number | null = null;
    try {
      const { stdout } = await execFileAsync("pdfinfo", [pdfPath]);
      pages = parsePagesFromPdfInfo(String(stdout || ""));
    } catch {
      pages = null;
    }

    // 2) Extract text
    await execFileAsync("pdftotext", ["-layout", pdfPath, txtPath]);
    const text = (await readFile(txtPath, "utf8")).trim();

    // 3) Fallback: infer pages from formfeeds if pdfinfo failed
    if (!pages) {
      const ff = (text.match(/\f/g) || []).length; // page breaks
      if (ff > 0) pages = ff + 1;
    }

    return NextResponse.json({
      filename: file.name,
      pages,
      text,
      textByPage: null,
      source_quality: text.replace(/\s+/g, "").length > 50 ? "native_text" : "empty_or_scanned",
    });
  } catch (err: any) {
    console.error("PDF parse error:", err);
    return NextResponse.json(
      { error: "Failed to parse PDF", details: String(err?.message ?? err) },
      { status: 500 }
    );
  }
}

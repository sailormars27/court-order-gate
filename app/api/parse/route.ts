import { NextResponse } from "next/server";
import { writeFile, readFile, rm, stat } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { randomUUID } from "crypto";
import { execFile } from "child_process";
import { promisify } from "util";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const execFileAsync = promisify(execFile);

function parsePagesFromPdfInfo(stdout: string): number | null {
  const m = stdout.match(/^Pages:\s+(\d+)\s*$/m);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function compactLen(text: string): number {
  return text.replace(/\s+/g, "").replace(/\f/g, "").length;
}

async function safeRm(p: string) {
  try {
    await rm(p, { force: true });
  } catch {}
}

export async function POST(req: Request) {
  const id = randomUUID();
  const pdfPath = path.join(tmpdir(), `${id}.pdf`);
  const txtPath = path.join(tmpdir(), `${id}.txt`);
  const ocrPdfPath = path.join(tmpdir(), `${id}.ocr.pdf`);
  const ocrTxtPath = path.join(tmpdir(), `${id}.ocr.txt`);

  // debug bundle we’ll return so nothing is “mystery meat”
  const debug: any = {
    id,
    steps: [],
    ocr: { attempted: false, ok: false, stdout: "", stderr: "" },
    files: {},
  };

  try {
    const formData = await req.formData();
    const file = formData.get("file");

    // allow forcing OCR: /api/parse?forceOcr=1
    const url = new URL(req.url);
    const forceOcr = url.searchParams.get("forceOcr") === "1";

    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: "Missing file" }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    await writeFile(pdfPath, Buffer.from(arrayBuffer));
    debug.steps.push("wrote input pdf");

    // record input size
    debug.files.input = { path: pdfPath, size: (await stat(pdfPath)).size };

    // 1) Get page count (best effort)
    let pages: number | null = null;
    try {
      const { stdout } = await execFileAsync("pdfinfo", [pdfPath]);
      pages = parsePagesFromPdfInfo(String(stdout || ""));
      debug.steps.push("pdfinfo ok");
    } catch (e: any) {
      debug.steps.push("pdfinfo failed");
      debug.pdfinfoError = String(e?.message ?? e);
      pages = null;
    }

    // 2) Extract native text
    await execFileAsync("pdftotext", ["-layout", pdfPath, txtPath]);
    let text = (await readFile(txtPath, "utf8")).trim();
    debug.steps.push("pdftotext native ok");

    const nativeCompact = compactLen(text);
    debug.native = { chars: text.length, compact: nativeCompact };

    let source_quality:
      | "native_text"
      | "ocr_text"
      | "empty_or_scanned" =
      nativeCompact > 200 ? "native_text" : "empty_or_scanned";

    // 3) OCR decision
    // IMPORTANT CHANGE:
    // - we OCR if forceOcr=1 OR if nativeCompact is small-ish
    // - small-ish threshold is higher than before so OCR actually triggers
    const shouldOcr = true;

    let ocrApplied = false;

    if (shouldOcr) {
      debug.ocr.attempted = true;
      debug.steps.push(`ocr decided (forceOcr=${forceOcr})`);

      try {
        const { stdout, stderr } = await execFileAsync("ocrmypdf", [
          "--skip-text",
          "--deskew",
          "--rotate-pages",
          "--optimize",
          "1",
          "-l",
          "eng",
          pdfPath,
          ocrPdfPath,
        ]);

        debug.ocr.stdout = String(stdout || "");
        debug.ocr.stderr = String(stderr || "");
        debug.ocr.ok = true;
        debug.steps.push("ocrmypdf ok");

        // verify OCR PDF exists + size
        const ocrStat = await stat(ocrPdfPath);
        debug.files.ocrPdf = { path: ocrPdfPath, size: ocrStat.size };

        // extract text from OCR PDF
        await execFileAsync("pdftotext", ["-layout", ocrPdfPath, ocrTxtPath]);
        const ocrText = (await readFile(ocrTxtPath, "utf8")).trim();
        debug.steps.push("pdftotext ocr ok");

        const ocrCompact = compactLen(ocrText);
        debug.ocrText = { chars: ocrText.length, compact: ocrCompact };

        // accept OCR text if it improves meaningfully
        if (ocrCompact > nativeCompact + 300) {
          text = ocrText;
          source_quality = "ocr_text";
          ocrApplied = true;
        } else {
          // keep original if OCR didn’t help
          debug.steps.push("ocr text not better; kept native");
        }

        // retry pdfinfo on OCR pdf if pages missing
        if (!pages) {
          try {
            const { stdout } = await execFileAsync("pdfinfo", [ocrPdfPath]);
            pages = parsePagesFromPdfInfo(String(stdout || ""));
            debug.steps.push("pdfinfo on ocr pdf ok");
          } catch {
            debug.steps.push("pdfinfo on ocr pdf failed");
          }
        }
      } catch (e: any) {
        debug.steps.push("ocrmypdf failed");
        debug.ocr.error = String(e?.message ?? e);
      }
    } else {
      debug.steps.push("ocr skipped");
    }

    // 4) fallback infer pages from formfeeds if pdfinfo failed
    if (!pages) {
      const ff = (text.match(/\f/g) || []).length;
      if (ff > 0) pages = ff + 1;
      debug.steps.push("pages inferred from formfeeds");
    }

    return NextResponse.json({
      filename: file.name,
      pages,
      text,
      textByPage: null,
      source_quality: ocrApplied ? "ocr_text" : source_quality,
      meta: {
        ocrApplied,
        forceOcr,
      },
      debug, // <- KEEP THIS until it works, then remove
    });
  } catch (err: any) {
    console.error("PDF parse error:", err);
    return NextResponse.json(
      { error: "Failed to parse PDF", details: String(err?.message ?? err) },
      { status: 500 }
    );
  } finally {
    await safeRm(pdfPath);
    await safeRm(txtPath);
    await safeRm(ocrPdfPath);
    await safeRm(ocrTxtPath);
  }
}

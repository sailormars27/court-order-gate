"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";

import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

const Document = dynamic(() => import("react-pdf").then((m) => m.Document), { ssr: false });
const Page = dynamic(() => import("react-pdf").then((m) => m.Page), { ssr: false });

type ReviewItem = {
  task_id: string;
  type: "Deadline" | "Requirement" | "Hearing" | "Filing" | "Service" | "Other";
  task_text: string;
  responsible: string;
  due_date: string | null;
  due_rule: string | null;
  confidence: "Low" | "Med" | "High";
  citation_page: number | null;
  citation_excerpt: string;
  status: "Approved" | "Pending";
};

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<string>("");
  const [text, setText] = useState<string>("");
  const [pdfUrl, setPdfUrl] = useState<string>("");
  const [showAnno, setShowAnno] = useState<boolean>(true);
  const [isClient, setIsClient] = useState(false);

  // Review items (right drawer)
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const activeItem = items.find((x) => x.task_id === activeId) ?? null;

  useEffect(() => {
  if (!activeId && items.length > 0) {
    setActiveId(items[0].task_id);
  }
}, [items, activeId]);

  // pdf worker for react-pdf (you already had this)
  useEffect(() => {
    (async () => {
      const { pdfjs } = await import("react-pdf");
      pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
    })();
  }, []);

  const DRAWER_W = 420;

  useEffect(() => {
    setIsClient(true);
  }, []);

  useEffect(() => {
    if (!file) {
      setPdfUrl("");
      return;
    }

    const url = URL.createObjectURL(file);
    setPdfUrl(url);

    return () => URL.revokeObjectURL(url);
  }, [file]);

  function normalizeSpaces(s: string) {
  return s.replace(/\s+/g, " ").trim();
}

function findExplicitDate(line: string): string | null {
  // 9/15/23 or 09/15/2023
  line = normalizeSpaces(line);
  const m1 = line.match(/(\d{1,2}\/\d{1,2}\/\d{2,4})/);
  if (m1) return m1[1];

  // September 15, 2023
  const m2 = line.match(
    /\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2},\s+\d{4}\b/i
  );
  if (m2) return m2[0];

  return null;
}

function findRelativeRule(line: string): string | null {
  const m = line.match(/\b(within|no later than)\s+(\d+)\s+(day|days|week|weeks|month|months)\b/i);
  if (m) return normalizeSpaces(m[0]);
  return null;
}

function inferType(line: string): ReviewItem["type"] {
  const s = line.toLowerCase();

  // Boilerplate that should not be a "Deadline"
  if (
    s.includes("disclosure shall proceed") ||
    s.includes("it is hereby ordered") ||
    s.includes("ordered that")
  ) {
    return "Requirement";
  }

  // Hearings / conferences
  if (/(hearing|conference|appearance)/i.test(line)) return "Hearing";

  // Service / filing
  if (/(serve|service)/i.test(line)) return "Service";
  if (/(file|filing|submit|notice of)/i.test(line)) return "Filing";

  // Deadlines: ONLY call it a deadline if there's an actual date/rule signal
  if (
    /\b(on or before|no later than|within \d+|by\s+\w+|\b\d{1,2}\/\d{1,2}\/\d{2,4}\b)\b/i.test(line)
  ) {
    return "Deadline";
  }

  return "Requirement";
}


function humanizeTask(line: string): string {
  let s = line;

  // If it starts like "(1) Insurance Coverage:" keep the header title clean
  const headerMatch = s.match(/^\((\d+)\)\s*([^:]+):\s*(.*)$/);
  if (headerMatch) {
    const sectionNum = headerMatch[1];
    const sectionTitle = headerMatch[2].trim();
    const rest = headerMatch[3].trim();

    // If there's no "rest", it's just a header
    if (!rest) return `Section ${sectionNum}: ${sectionTitle}`;

    // Otherwise combine
    return normalizeSpaces(`Section ${sectionNum}: ${sectionTitle} — ${rest}`);
  }

  // fallback behavior for regular lines
  s = s.replace(/^\(?\d+\)?[.)]\s*/, "");
  s = s.replace(/^it is hereby ordered that\s*/i, "");
  s = s.replace(/^ordered that\s*/i, "");
  s = s.replace(/^shall\s+/i, "");

  return normalizeSpaces(s);
}

function isJunkLine(l: string) {
  const s = l.trim();

  if (/^appearance\s*no[:\s]/i.test(s)) return true;


  // Too short to be a real task
  if (s.length < 18) return true;

  // Court header / filing stamp junk
  if (
    /(FILED:|COUNTY CLERK|NYSCEF|INDEX NO\.?|SUPREME COURT|RECEIVED|IAS PART|PRELIMINARY CONFERENCE ORDER)/i.test(
      s
    )
  )
    return true;

  // Lines that are mostly punctuation/underscores
  if (/^[_\-\s.]+$/.test(s)) return true;

  return false;
}

function looksLikeObligation(l: string) {
  return /^\(\d+\)\s+/.test(l.trim());
}


function extractMvpItemsFromText(rawText: string): ReviewItem[] {
  const lines = rawText
    .split(/\n+/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const candidates = lines
  .filter((l) => /^\(1\)\s/.test(l)) // ONLY Section (1)
  .filter((l) => !isJunkLine(l))
  .filter((l) => looksLikeObligation(l));


 const section1Only = candidates.filter((l) =>
  /\(1\)\s*Insurance Coverage:/i.test(l)
);

const picked = candidates
  .filter((l) => /Insurance Coverage/i.test(l))
  .filter((l) => /on or before|by|within/i.test(l))
  .slice(0, 1);



  return picked.map((line, i) => {
    const due_date = findExplicitDate(line);
    const due_rule = due_date ? null : findRelativeRule(line);

    const confidence: ReviewItem["confidence"] = due_date
      ? "High"
      : due_rule
      ? "Med"
      : "Low";

    return {
      task_id: `t${i + 1}`,
      type: inferType(line),
      task_text: humanizeTask(line),
      responsible: "",
      due_date,
      due_rule,
      confidence,
      citation_page: 1, // still MVP, okay
      citation_excerpt: line.slice(0, 240),
      status: "Pending",
    };
  });
}


  async function handleProcessOrder() {
    if (!file) {
      setStatus("Pick a PDF first.");
      return;
    }

    setStatus("Uploading + parsing...");
    setText("");
    setItems([]);

    const formData = new FormData();
    formData.append("file", file);

    const res = await fetch("/api/parse", {
      method: "POST",
      body: formData,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      setStatus(`Error: ${err?.error || res.statusText}${err?.details ? " — " + err.details : ""}`);
      return;
    }

    const data = await res.json();

    const parsedText = data.text || "";
    setStatus(`Parsed ${data.filename} (${data.pages ?? "?"} pages)`);
    setText(parsedText);

    const extracted = extractMvpItemsFromText(parsedText);
    setItems(extracted);
    setActiveId(extracted[0]?.task_id ?? null);


    // Open drawer automatically so user sees the “Review” side
    setShowAnno(true);

    // If the PDF looks scanned, be honest (demo-safe)
    if (data.source_quality === "empty_or_scanned" || parsedText.trim().length < 30) {
      setStatus(`Parsed ${data.filename} (${data.pages ?? "?"} pages) — Looks scanned/low-text. Paste text or use a text-based PDF for demo.`);
    }
  }

  function buildEmailReadySummary(approvedOnly: boolean) {
    const list = approvedOnly ? items.filter((it) => it.status === "Approved") : items;

    // Deadlines first (explicit date/rule not implemented yet, so simple ordering)
    const deadlines = list.filter((it) => it.type === "Deadline");
    const others = list.filter((it) => it.type !== "Deadline");

    const lines: string[] = [];

    const all = [...deadlines, ...others];
    for (const it of all) {
      const p = it.citation_page ?? 1;
      lines.push(`- ${it.task_text} (p.${p})`);
    }

    return lines.join("\n");
  }

  const exportHeaders = [
    "task_id",
    "type",
    "task_text",
    "responsible",
    "due_date",
    "due_rule",
    "citation_page",
    "citation_excerpt",
    "status",
  ] as const;

  function downloadCsv() {
    const rows = items.map((it) =>
      exportHeaders
        .map((h) => {
          const v = (it as any)[h] ?? "";
          const s = String(v).replace(/"/g, '""');
          return `"${s}"`;
        })
        .join(",")
    );

    const csv = [exportHeaders.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "orderly_export.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main
      style={{
        padding: 12,
        fontFamily: "sans-serif",
        height: "100vh",
        boxSizing: "border-box",
        paddingRight: showAnno ? 12 + DRAWER_W + 12 : 12,
      }}
    >
      <div style={{ height: "100%" }}>
        {/* PDF */}
        <div style={{ width: "100%", border: "1px solid #ddd", borderRadius: 8, padding: 12 }}>
          {/* Upload + Process controls */}
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
            <input
              type="file"
              accept="application/pdf"
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                setFile(f);
                setStatus("");
                setText("");
                setItems([]);
                setActiveId(null);
              }}
            />

            <button onClick={handleProcessOrder} disabled={!file}>
              Process Order
            </button>

            <button
              onClick={() => setShowAnno((v) => !v)}
              disabled={!pdfUrl}
              style={{ marginLeft: 8 }}
            >
              {showAnno ? "Hide Review" : "Show Review"}
            </button>
          </div>

          {/* Status */}
          {status && <div style={{ marginBottom: 12, fontSize: 12, opacity: 0.8 }}>{status}</div>}

          {/* PDF viewport */}
          <div style={{ position: "relative", height: "calc(100vh - 120px)" }}>
            {pdfUrl ? (
              <>
                {pdfUrl && isClient ? (
                  <Document file={pdfUrl}>
                    <div style={{ position: "relative", display: "inline-block" }}>
                      <Page pageNumber={1} width={900} />
                    </div>
                  </Document>
                ) : (
                  <div style={{ padding: 12 }}>{pdfUrl ? "Loading PDF…" : "No PDF selected."}</div>
                )}

                {/* Pin button to open drawer */}
                <button
                  style={{
                    position: "absolute",
                    left: "82%",
                    top: "27%",
                    transform: "translate(-50%, -50%)",
                    width: 28,
                    height: 28,
                    borderRadius: 999,
                    border: "1px solid #ccc",
                    background: "white",
                    cursor: "pointer",
                  }}
                  onClick={() => setShowAnno(true)}
                  title="Open Review"
                >
                  💬
                </button>
              </>
            ) : (
              <div style={{ padding: 12 }}>No PDF selected.</div>
            )}
          </div>
        </div>
      </div>

      {/* RIGHT DRAWER: Review */}
      {pdfUrl && showAnno && (
        <div
          style={{
            position: "fixed",
            top: 12,
            right: 12,
            width: DRAWER_W,
            maxHeight: "calc(100vh - 24px)",
            overflowY: "auto",
            zIndex: 50,
            background: "white",
            border: "1px solid #ddd",
            borderRadius: 12,
            padding: 12,
            boxShadow: "0 10px 30px rgba(0,0,0,0.15)",
            boxSizing: "border-box",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontWeight: 700 }}>
              Review
              <span style={{ marginLeft: 6, fontSize: 11, opacity: 0.6 }}>
                ({items.length} items)
              </span>
            </div>

            <button
              onClick={() => setShowAnno(false)}
              style={{ border: "0", background: "transparent", cursor: "pointer", fontSize: 18 }}
              aria-label="Close"
            >
              ✕
            </button>
          </div>

          <div style={{ marginTop: 10 }}>
            {/* Actions row */}
            <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
              <button
                onClick={() =>
                  setItems((prev) => [
                    {
                      task_id: `t${prev.length + 1}`,
                      type: "Requirement",
                      task_text: "",
                      responsible: "",
                      due_date: null,
                      due_rule: null,
                      confidence: "Low",
                      citation_page: 1,
                      citation_excerpt: "",
                      status: "Pending",
                    },
                    ...prev,
                  ])
                }
              >
                ➕ Add item
              </button>

              <button
                disabled={!items.length}
                onClick={async () => {
                  const out = buildEmailReadySummary(true);
                  await navigator.clipboard.writeText(out);
                  setStatus("Copied email-ready summary (approved only) to clipboard.");
                }}
              >
                Copy summary
              </button>

              <button disabled={!items.length} onClick={downloadCsv}>
                Download CSV
              </button>
            </div>

            {/* Items */}
            {items.length === 0 ? (
  <div style={{ fontSize: 13, opacity: 0.75 }}>
    No extracted items yet. Click <b>Process Order</b>.
    {text.trim().length === 0 ? (
      <div style={{ marginTop: 8, opacity: 0.7 }}>
        Tip: if this PDF is a scan, text extraction will be empty today.
      </div>
    ) : null}
  </div>
) : (
  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
    {/* Compact list */}
    {/* Compact list */}
<div
  style={{
    display: "flex",
    flexDirection: "column",
    gap: 6,
    maxHeight: 360,
    overflowY: "auto",
    paddingRight: 2,
  }}
>

      {items.map((it, idx) => {
        const selected = it.task_id === activeId;
        return (
          <button
            key={it.task_id}
            onClick={() => setActiveId(it.task_id)}
            style={{
              textAlign: "left",
              padding: 10,
              borderRadius: 10,
              border: selected ? "2px solid #111" : "1px solid #ddd",
              background: selected ? "#fafafa" : "white",
              cursor: "pointer",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <div style={{ fontWeight: 700, fontSize: 13 }}>
                #{idx + 1} {it.type}{" "}
                <span style={{ marginLeft: 6, fontWeight: 400, opacity: 0.7 }}>
                  {it.status === "Approved" ? "✅" : ""}
                </span>
              </div>
              <div style={{ fontSize: 12, opacity: 0.75 }}>{it.confidence}</div>
            </div>

            <div style={{ fontSize: 12, opacity: 0.85, marginTop: 4 }}>
              {it.task_text.slice(0, 120)}
              {it.task_text.length > 120 ? "…" : ""}
            </div>
          </button>
        );
      })}
    </div>

    {/* Focused card */}
    {activeItem ? (
      <div style={{ border: "1px solid #ddd", borderRadius: 12, padding: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
          <div style={{ fontWeight: 800 }}>
  Annotation{" "}
  <span style={{ fontWeight: 400, fontSize: 11, opacity: 0.6 }}>
    (Section {items.findIndex((x) => x.task_id === activeItem.task_id) + 1})
  </span>
</div>


          <button
            onClick={() => {
              const removeId = activeItem.task_id;
              setItems((prev) => prev.filter((x) => x.task_id !== removeId));
              const remaining = items.filter((x) => x.task_id !== removeId);
              setActiveId(remaining[0]?.task_id ?? null);
            }}
            aria-label="Remove"
            title="Remove"
          >
            🗑
          </button>
        </div>

        <textarea
          value={activeItem.task_text}
          onChange={(e) =>
            setItems((prev) =>
              prev.map((x) =>
                x.task_id === activeItem.task_id ? { ...x, task_text: e.target.value } : x
              )
            )
          }
          placeholder="Task / Demand (plain English)"
          style={{ width: "100%", marginTop: 8, minHeight: 72 }}
        />

        <div style={{ marginTop: 8, fontSize: 13 }}>
          <b>Due:</b>{" "}
          {activeItem.due_date ? (
            activeItem.due_date
          ) : activeItem.due_rule ? (
            activeItem.due_rule
          ) : (
            <span style={{ opacity: 0.7 }}>Not detected</span>
          )}
        </div>

        <details style={{ marginTop: 10 }}>
          <summary style={{ cursor: "pointer", fontSize: 12, opacity: 0.85 }}>
            Citation (p.{activeItem.citation_page ?? 1})
          </summary>
          <div
            style={{
              marginTop: 6,
              fontSize: 12,
              opacity: 0.85,
              padding: 8,
              border: "1px solid #eee",
              borderRadius: 8,
              background: "#fafafa",
              whiteSpace: "pre-wrap",
            }}
          >
            “{activeItem.citation_excerpt}”
          </div>
        </details>

        <div style={{ marginTop: 10, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button
            onClick={() =>
              setItems((prev) =>
                prev.map((x) =>
                  x.task_id === activeItem.task_id
                    ? { ...x, status: x.status === "Approved" ? "Pending" : "Approved" }
                    : x
                )
              )
            }
          >
            {activeItem.status === "Approved" ? "✅ Approved" : "Approve"}
          </button>


          <button
            onClick={async () => {
  const caseLine =
    "Elizabeth Estupinan v. Wallack NYC Family Limited Partnership et al.";
  const indexLine = "Index No. 152563/2022";
  const due = activeItem.due_date || activeItem.due_rule || "DATE TBD";

  const block = `${caseLine}
${indexLine}

${activeItem.task_text} — due ${due} (p.${activeItem.citation_page ?? 1})`;

  await navigator.clipboard.writeText(block);
  setStatus("Copied docket/calendar entry to clipboard.");
}}

          >
            Export line
          </button>
        </div>
      </div>
    ) : (
      <div style={{ fontSize: 13, opacity: 0.75 }}>
        Select an item to review.
      </div>
    )}
  </div>
)}

            {/* Optional: raw text preview for debugging/demo */}
            {text && (
              <details style={{ marginTop: 12 }}>
                <summary style={{ cursor: "pointer", fontSize: 12, opacity: 0.8 }}>
                  Debug: extracted text preview
                </summary>
                <pre
                  style={{
                    whiteSpace: "pre-wrap",
                    fontSize: 11,
                    marginTop: 8,
                    padding: 10,
                    border: "1px solid #eee",
                    borderRadius: 8,
                    background: "#fafafa",
                    maxHeight: 240,
                    overflow: "auto",
                  }}
                >
                  {text.slice(0, 2000)}
                  {text.length > 2000 ? "\n\n…(truncated)" : ""}
                </pre>
              </details>
            )}
          </div>
        </div>
      )}
    </main>
  );
}

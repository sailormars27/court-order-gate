"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";

import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

const Document = dynamic(() => import("react-pdf").then((m) => m.Document), { ssr: false });
const Page = dynamic(() => import("react-pdf").then((m) => m.Page), { ssr: false });

type ReviewItem = {
  task_id: string;

  type: "Deadline" | "Requirement" | "Hearing" | "Filing" | "Service" | "Other";

  obligation_title: string; // "Section 1: Insurance Coverage"
  actor: string; // confirmed (defaults to Defendant)
  actor_raw: string | null; // extracted (often null)
  action: string; // template or extracted
  condition: string | null;

  // Store ISO only for date: YYYY-MM-DD
  due_date: string | null;
  // Store relative rule or raw extracted deadline text
  due_rule: string | null;

  confidence: "Low" | "Med" | "High";
  risk: "low" | "med" | "high";

  citation_page: number | null;
  citation_excerpt: string;

  checks: {
    applies: boolean;
    deadline: boolean;
    ready: boolean;
  };

  status: "Approved" | "Pending";
};

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<string>("");
  const [text, setText] = useState<string>("");
  const [pdfUrl, setPdfUrl] = useState<string>("");
  const [showAnno, setShowAnno] = useState<boolean>(true);
  const [isClient, setIsClient] = useState(false);

  // Case metadata for export (manual for MVP)
  const [caseCaption, setCaseCaption] = useState<string>("");
  const [indexNo, setIndexNo] = useState<string>("");

  // Review items (right drawer)
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const activeItem = items.find((x) => x.task_id === activeId) ?? null;

  useEffect(() => {
    if (!activeId && items.length > 0) setActiveId(items[0].task_id);
  }, [items, activeId]);

  // pdf worker for react-pdf
  useEffect(() => {
    (async () => {
      const { pdfjs } = await import("react-pdf");
      pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
    })();
  }, []);

  const DRAWER_W = 420;

  useEffect(() => setIsClient(true), []);

  useEffect(() => {
    if (!file) {
      setPdfUrl("");
      return;
    }
    const url = URL.createObjectURL(file);
    setPdfUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // -------------------------
  // Helpers
  // -------------------------

  function normalizeSpaces(s: string) {
    return s.replace(/\s+/g, " ").trim();
  }

  function isJunkLine(l: string) {
    const s = l.trim();
    if (/^appearance\s*no[:\s]/i.test(s)) return true;
    if (s.length < 18) return true;

    if (
      /(FILED:|COUNTY CLERK|NYSCEF|INDEX NO\.?|SUPREME COURT|RECEIVED|IAS PART|PRELIMINARY CONFERENCE ORDER)/i.test(
        s
      )
    )
      return true;

    if (/^[_\-\s.]+$/.test(s)) return true;
    return false;
  }

  function findExplicitDateRaw(line: string): string | null {
    line = normalizeSpaces(line);

    // 9/15/23 or 09/15/2023
    const m1 = line.match(/(\d{1,2}\/\d{1,2}\/\d{2,4})/);
    if (m1) return m1[1];

    // September 15, 2023
    const m2 = line.match(
      /\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2},\s+\d{4}\b/i
    );
    if (m2) return m2[0];

    return null;
  }

  function inferType(line: string): ReviewItem["type"] {
    const s = line.toLowerCase();

    if (
      s.includes("disclosure shall proceed") ||
      s.includes("it is hereby ordered") ||
      s.includes("ordered that")
    ) {
      return "Requirement";
    }

    if (/(hearing|conference|appearance)/i.test(line)) return "Hearing";
    if (/(serve|service)/i.test(line)) return "Service";
    if (/(file|filing|submit|notice of)/i.test(line)) return "Filing";

    if (/\b(on or before|no later than|within \d+|by\b|\b\d{1,2}\/\d{1,2}\/\d{2,4}\b)\b/i.test(line)) {
      return "Deadline";
    }

    return "Requirement";
  }

  function formatISODate(iso: string) {
    const d = new Date(iso + "T00:00:00");
    return d.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
  }

  function isISODate(s: string) {
    return /^\d{4}-\d{2}-\d{2}$/.test(s);
  }

  function parseDateToISO(input: string): string | null {
    const t = input.trim();

    if (isISODate(t)) return t;

    const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!m) return null;

    const mm = m[1].padStart(2, "0");
    const dd = m[2].padStart(2, "0");
    const yyyy = m[3];

    const monthN = Number(mm);
    const dayN = Number(dd);
    const yearN = Number(yyyy);
    if (monthN < 1 || monthN > 12) return null;
    if (dayN < 1 || dayN > 31) return null;
    if (yearN < 1900 || yearN > 2100) return null;

    return `${yyyy}-${mm}-${dd}`;
  }

  function findRelativeRule(line: string): string | null {
    const s = line.replace(/\s+/g, " ").trim();

    // within 45 days / no later than 45 days
    const m1 = s.match(/\b(within|no later than)\s+(\d+)\s+(day|days|week|weeks|month|months)\b/i);
    if (m1) return m1[0];

    // forty-five (45) days -> normalize to "45 days"
    const m2 = s.match(/\b([a-z]+(?:-[a-z]+)?)\s*\((\d+)\)\s*(day|days|week|weeks|month|months)\b/i);
    if (m2) return `${m2[2]} ${m2[3]}`;

    return null;
  }

  // -------------------------
  // Extraction (Section 1)
  // -------------------------
  function extractMvpItemsFromText(rawText: string): ReviewItem[] {
    const lines = rawText
      .split(/\n+/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
      .filter((l) => !isJunkLine(l));

    const s1Line =
      lines.find((l) => /^\(1\)\s*/.test(l) && /Insurance Coverage/i.test(l)) ?? null;

    if (!s1Line) return [];

    const deadlineRaw = findExplicitDateRaw(s1Line); // often null when handwritten
    const relRule = findRelativeRule(s1Line); // catches "within 45 days" when printed

    const confidence: ReviewItem["confidence"] = deadlineRaw ? "High" : relRule ? "Med" : "Low";

    return [
      {
        task_id: "t1",
        type: inferType(s1Line),

        obligation_title: "Section 1: Insurance Coverage",
        actor: "Defendant",
        actor_raw: null,

        action: "furnish insurance coverage information",
        condition: "if not already provided",

        due_date: null, // user enters ISO via text input
        due_rule: deadlineRaw ?? relRule, // shows any printed/parsed rule if present

        confidence,
        risk: "high",

        citation_page: 1,
        citation_excerpt: s1Line.slice(0, 240),

        checks: { applies: false, deadline: false, ready: false },
        status: "Pending",
      },
    ];
  }

  // -------------------------
  // API call
  // -------------------------
  async function handleProcessOrder() {
    if (!file) {
      setStatus("Pick a PDF first.");
      return;
    }

    setStatus("Uploading + parsing...");
    setText("");
    setItems([]);
    setActiveId(null);

    const formData = new FormData();
    formData.append("file", file);

    const res = await fetch("/api/parse", { method: "POST", body: formData });

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

    setShowAnno(true);

    if (data.source_quality === "empty_or_scanned" || parsedText.trim().length < 30) {
      setStatus(
        `Parsed ${data.filename} (${data.pages ?? "?"} pages) — Looks scanned/low-text. OCR text may be needed for best results.`
      );
    }
  }

  // -------------------------
  // Export gating
  // -------------------------
  const canExportActive = useMemo(() => {
    if (!activeItem) return false;
    const actorOk = activeItem.actor.trim().length > 0;
    const deadlineOk = !!activeItem.due_date || !!activeItem.due_rule; // date OR rule
    const checksOk = activeItem.checks.applies && activeItem.checks.deadline && activeItem.checks.ready;
    const metaOk = caseCaption.trim().length > 0 && indexNo.trim().length > 0;
    return actorOk && deadlineOk && checksOk && metaOk && activeItem.status === "Approved";
  }, [activeItem, caseCaption, indexNo]);

  async function copyExportLine() {
    if (!activeItem) return;

    const duePretty = activeItem.due_date
      ? formatISODate(activeItem.due_date)
      : activeItem.due_rule
      ? activeItem.due_rule
      : "DATE TBD";

    const titleLine = `${caseCaption} | ${indexNo}`;
    const bodyLine = `Insurance coverage information due ${duePretty} (Actor: ${activeItem.actor}) (p.${activeItem.citation_page ?? 1})`;
    const block = `${titleLine}\n\n${bodyLine}`;

    try {
      await navigator.clipboard.writeText(block);
      setStatus("Copied docket/calendar entry to clipboard.");
    } catch {
      window.prompt("Copy this docket entry:", block);
      setStatus("Clipboard blocked; used fallback copy prompt.");
    }
  }

  // -------------------------
  // Demo-style card
  // -------------------------
  function DemoStyleAnnotationCard({
    item,
    onPatch,
  }: {
    item: ReviewItem;
    onPatch: (patch: Partial<ReviewItem>) => void;
  }) {
    const deadlineOk = !!item.due_date || !!item.due_rule;

    const canApprove =
      item.actor.trim().length > 0 &&
      deadlineOk &&
      item.checks.applies &&
      item.checks.deadline &&
      item.checks.ready;

    // local UI state for deadline entry
    const [deadlineMode, setDeadlineMode] = useState<"date" | "rule">(
      item.due_date ? "date" : item.due_rule ? "rule" : "date"
    );
    const [dateInput, setDateInput] = useState<string>(item.due_date ?? "");
    const [ruleInput, setRuleInput] = useState<string>(item.due_rule ?? "");

    useEffect(() => {
      setDeadlineMode(item.due_date ? "date" : item.due_rule ? "rule" : "date");
      setDateInput(item.due_date ?? "");
      setRuleInput(item.due_rule ?? "");
    }, [item.task_id]);

    return (
      <div style={{ border: "1px solid #e5e5e5", borderRadius: 14, padding: 14, background: "white" }}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 14 }}>Annotation</div>
            <div style={{ fontSize: 11, opacity: 0.65 }}>{item.obligation_title}</div>
          </div>
          <div
            style={{
              fontSize: 11,
              padding: "4px 10px",
              borderRadius: 999,
              border: "1px solid #f3b1b1",
              background: "#fff5f5",
              color: "#b42318",
              whiteSpace: "nowrap",
            }}
          >
            Risk: {item.risk}
          </div>
        </div>

        <div style={{ height: 1, background: "#eee", margin: "12px 0" }} />

        <div style={{ fontSize: 12, opacity: 0.75 }}>Obligation</div>
        <div style={{ fontWeight: 800, marginTop: 2 }}>Insurance Coverage</div>

        {/* Fields */}
        <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 10, fontSize: 13 }}>
          <div>
            <div style={{ fontSize: 11, opacity: 0.65, marginBottom: 4 }}>Actor</div>
            <select
              value={item.actor}
              onChange={(e) => onPatch({ actor: e.target.value })}
              style={{ padding: 8, borderRadius: 10, border: "1px solid #ddd", width: "100%" }}
            >
              <option value="">Select…</option>
              <option value="Plaintiff">Plaintiff</option>
              <option value="Defendant">Defendant</option>
              <option value="All Parties">All Parties</option>
            </select>
            <div style={{ fontSize: 11, opacity: 0.6, marginTop: 4 }}>raw: {item.actor_raw ? item.actor_raw : "—"}</div>
          </div>

          <div>
            <div style={{ fontSize: 11, opacity: 0.65, marginBottom: 4 }}>Action</div>
            <div>{item.action}</div>
          </div>

          {item.condition ? (
            <div>
              <div style={{ fontSize: 11, opacity: 0.65, marginBottom: 4 }}>Condition</div>
              <div>{item.condition}</div>
            </div>
          ) : null}

          {/* Deadline with Date/Rule */}
          <div>
            <div style={{ fontSize: 11, opacity: 0.65, marginBottom: 6 }}>Deadline</div>

            <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
              <button
                type="button"
                onClick={() => {
                  setDeadlineMode("date");
                  setRuleInput("");
                  onPatch({ due_rule: null });
                }}
                style={{
                  padding: "6px 10px",
                  borderRadius: 999,
                  border: "1px solid #ddd",
                  background: deadlineMode === "date" ? "#111" : "white",
                  color: deadlineMode === "date" ? "white" : "#111",
                  fontSize: 12,
                  cursor: "pointer",
                }}
              >
                Date
              </button>

              <button
                type="button"
                onClick={() => {
                  setDeadlineMode("rule");
                  setDateInput("");
                  onPatch({ due_date: null });
                }}
                style={{
                  padding: "6px 10px",
                  borderRadius: 999,
                  border: "1px solid #ddd",
                  background: deadlineMode === "rule" ? "#111" : "white",
                  color: deadlineMode === "rule" ? "white" : "#111",
                  fontSize: 12,
                  cursor: "pointer",
                }}
              >
                Rule (e.g., within 45 days)
              </button>
            </div>

            {deadlineMode === "date" ? (
              <>
                <input
                  type="text"
                  inputMode="numeric"
                  value={dateInput}
                  onChange={(e) => {
                    const v = e.target.value;
                    setDateInput(v);
                    const iso = parseDateToISO(v);
                    onPatch({ due_date: iso }); // store ISO only if valid
                  }}
                  onBlur={() => {
                    const iso = parseDateToISO(dateInput);
                    if (!iso) {
                      setDateInput("");
                      onPatch({ due_date: null });
                      return;
                    }
                    // Normalize display to MM/DD/YYYY
                    const [yyyy, mm, dd] = iso.split("-");
                    setDateInput(`${mm}/${dd}/${yyyy}`);
                    onPatch({ due_date: iso });
                  }}
                  placeholder="MM/DD/YYYY"
                  style={{ padding: 8, borderRadius: 10, border: "1px solid #ddd", width: "100%" }}
                />
                <div style={{ fontSize: 11, opacity: 0.6, marginTop: 6 }}>
                  stored: {item.due_date ? item.due_date : "—"} &nbsp;•&nbsp; raw: {item.due_rule ? item.due_rule : "—"}
                </div>
              </>
            ) : (
              <>
                <input
                  type="text"
                  value={ruleInput}
                  onChange={(e) => {
                    const v = e.target.value;
                    setRuleInput(v);
                    onPatch({ due_rule: v.trim().length ? v.trim() : null });
                  }}
                  onBlur={() => {
                    const v = ruleInput.trim();
                    if (!v) onPatch({ due_rule: null });
                  }}
                  placeholder="within 45 days / no later than 45 days"
                  style={{ padding: 8, borderRadius: 10, border: "1px solid #ddd", width: "100%" }}
                />
                <div style={{ fontSize: 11, opacity: 0.6, marginTop: 6 }}>raw: {item.due_rule ? item.due_rule : "—"}</div>
              </>
            )}
          </div>
        </div>

        {/* Citation */}
        <div style={{ marginTop: 12, border: "1px solid #eee", borderRadius: 12, padding: 10, background: "#fafafa" }}>
          <div style={{ fontSize: 11, fontWeight: 700, opacity: 0.75 }}>Citation (p.{item.citation_page ?? 1})</div>
          <div style={{ fontSize: 12, marginTop: 6, opacity: 0.9 }}>{item.citation_excerpt}</div>
        </div>

        {/* Checks */}
        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8, fontSize: 13 }}>
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="checkbox"
              checked={item.checks.applies}
              onChange={(e) => onPatch({ checks: { ...item.checks, applies: e.target.checked } })}
            />
            1. Obligation applies to {item.actor || "…"}
          </label>

          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="checkbox"
              checked={item.checks.deadline}
              onChange={(e) => onPatch({ checks: { ...item.checks, deadline: e.target.checked } })}
            />
            2. Deadline is confirmed
          </label>

          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="checkbox"
              checked={item.checks.ready}
              onChange={(e) => onPatch({ checks: { ...item.checks, ready: e.target.checked } })}
            />
            3. Ready to docket this entry
          </label>
        </div>

        {/* Approve */}
        <button
          disabled={!canApprove}
          onClick={() => onPatch({ status: "Approved" })}
          style={{
            marginTop: 14,
            width: "100%",
            padding: "10px 12px",
            borderRadius: 12,
            border: "1px solid #d1fadf",
            background: canApprove ? "#dcfce7" : "#f3f4f6",
            color: canApprove ? "#166534" : "#6b7280",
            fontWeight: 800,
            cursor: canApprove ? "pointer" : "not-allowed",
          }}
        >
          ✓ Obligation Approved
        </button>

        {!canApprove ? (
          <div style={{ marginTop: 10, fontSize: 11, opacity: 0.65 }}>
            Required: confirm actor + deadline (date or rule) and check all three boxes.
          </div>
        ) : null}
      </div>
    );
  }

  // -------------------------
  // Render
  // -------------------------
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
        <div style={{ width: "100%", border: "1px solid #ddd", borderRadius: 8, padding: 12 }}>
          {/* Controls */}
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

            <button onClick={() => setShowAnno((v) => !v)} disabled={!pdfUrl} style={{ marginLeft: 8 }}>
              {showAnno ? "Hide Review" : "Show Review"}
            </button>
          </div>

          {status && <div style={{ marginBottom: 12, fontSize: 12, opacity: 0.8 }}>{status}</div>}

          {/* PDF viewport */}
          <div style={{ position: "relative", height: "calc(100vh - 120px)" }}>
            {pdfUrl ? (
              <>
                {isClient ? (
                  <Document file={pdfUrl}>
                    <div style={{ position: "relative", display: "inline-block" }}>
                      <Page pageNumber={1} width={900} />
                    </div>
                  </Document>
                ) : (
                  <div style={{ padding: 12 }}>Loading PDF…</div>
                )}

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

      {/* RIGHT DRAWER */}
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
              Review <span style={{ marginLeft: 6, fontSize: 11, opacity: 0.6 }}>({items.length} items)</span>
            </div>

            <button
              onClick={() => setShowAnno(false)}
              style={{ border: "0", background: "transparent", cursor: "pointer", fontSize: 18 }}
              aria-label="Close"
            >
              ✕
            </button>
          </div>

          {/* Export metadata */}
          <div style={{ marginTop: 12, border: "1px solid #eee", borderRadius: 12, padding: 10, background: "#fafafa" }}>
            <div style={{ fontSize: 11, fontWeight: 700, opacity: 0.75 }}>Export metadata</div>

            <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
              <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
                Case caption
                <input
                  value={caseCaption}
                  onChange={(e) => setCaseCaption(e.target.value)}
                  placeholder="e.g., Estupinan v. Wallack NYC Family Limited Partnership et al."
                  style={{ padding: 8, borderRadius: 10, border: "1px solid #ddd" }}
                />
              </label>

              <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
                Index no.
                <input
                  value={indexNo}
                  onChange={(e) => setIndexNo(e.target.value)}
                  placeholder="e.g., 152563/2022"
                  style={{ padding: 8, borderRadius: 10, border: "1px solid #ddd" }}
                />
              </label>

              <div style={{ fontSize: 11, opacity: 0.65 }}>Required for export. Manual for MVP.</div>
            </div>
          </div>

          <div style={{ marginTop: 12 }}>
            {items.length === 0 ? (
              <div style={{ fontSize: 13, opacity: 0.75 }}>
                No extracted items yet. Click <b>Process Order</b>.
                {text.trim().length === 0 ? (
                  <div style={{ marginTop: 8, opacity: 0.7 }}>
                    Tip: if this PDF is a scan, extracted text may be empty. OCR text may be needed.
                  </div>
                ) : null}
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {/* Compact list */}
                <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 220, overflowY: "auto", paddingRight: 2 }}>
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
                            #{idx + 1} {it.obligation_title}
                            <span style={{ marginLeft: 6, fontWeight: 400, opacity: 0.7 }}>
                              {it.status === "Approved" ? "✅" : ""}
                            </span>
                          </div>
                          <div style={{ fontSize: 12, opacity: 0.75 }}>{it.confidence}</div>
                        </div>

                        <div style={{ fontSize: 12, opacity: 0.85, marginTop: 4 }}>{it.action}</div>
                      </button>
                    );
                  })}
                </div>

                {/* Focused card */}
                {activeItem ? (
                  <DemoStyleAnnotationCard
                    item={activeItem}
                    onPatch={(patch) => {
                      setItems((prev) =>
                        prev.map((x) => (x.task_id === activeItem.task_id ? { ...x, ...patch } : x))
                      );
                    }}
                  />
                ) : null}

                {/* Export preview */}
                {activeItem ? (
                  <div style={{ border: "1px solid #e5e5e5", borderRadius: 14, padding: 14, background: "white" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div>
                        <div style={{ fontSize: 12, opacity: 0.75 }}>Export Preview</div>
                        <div style={{ fontWeight: 800 }}>Docket entry + ticklers</div>
                      </div>
                      <div style={{ fontSize: 11, padding: "4px 10px", borderRadius: 999, border: "1px solid #eee", background: "#fafafa" }}>
                        Firm format: caption + index
                      </div>
                    </div>

                    <div style={{ marginTop: 10, border: "1px solid #eee", borderRadius: 12, padding: 10, background: "#fafafa" }}>
                      <div style={{ fontWeight: 700, fontSize: 12 }}>
                        {caseCaption.trim() ? caseCaption.trim() : "Case caption (required)"}
                      </div>
                      <div style={{ fontSize: 12, opacity: 0.85, marginTop: 4 }}>
                        Index No. {indexNo.trim() ? indexNo.trim() : "Index no. (required)"}
                      </div>

                      <div style={{ marginTop: 10, fontSize: 12 }}>
                        {activeItem.action} due{" "}
                        {activeItem.due_date
                          ? formatISODate(activeItem.due_date)
                          : activeItem.due_rule
                          ? activeItem.due_rule
                          : "DEADLINE (required)"}{" "}
                        <span style={{ opacity: 0.75 }}>(Actor: {activeItem.actor || "…"})</span>
                      </div>

                      {!canExportActive ? (
                        <div style={{ marginTop: 8, fontSize: 11, opacity: 0.65 }}>
                          Export blocked until: caption + index are filled, obligation approved, checkboxes confirmed, and deadline entered (date or rule).
                        </div>
                      ) : null}
                    </div>

                    <button
                      disabled={!canExportActive}
                      onClick={copyExportLine}
                      style={{
                        marginTop: 12,
                        width: "100%",
                        padding: "10px 12px",
                        borderRadius: 12,
                        border: "1px solid #ddd",
                        background: canExportActive ? "white" : "#f3f4f6",
                        cursor: canExportActive ? "pointer" : "not-allowed",
                        fontWeight: 800,
                      }}
                    >
                      Export line
                    </button>
                  </div>
                ) : null}

                {/* Debug text preview */}
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
            )}
          </div>
        </div>
      )}
    </main>
  );
}

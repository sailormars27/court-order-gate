"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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

  // Section highlight state + ref
  const [sectionBlock, setSectionBlock] = useState<string>("");
  const pdfWrapRef = useRef<HTMLDivElement | null>(null);

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

  function normalizeActionForExport(action: string) {
    return action.replace(/^furnish\s+/i, "").replace(/^shall\s+/i, "").trim();
  }

  function normToken(w: string) {
    return (w || "").replace(/[^\w]/g, "").toLowerCase();
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

  function parseDateToISO(input: string): string | null {
    const t = input.trim();
    if (!t) return null;

    // Accept ISO already
    if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;

    // Allow digits-only: MMDDYYYY or MMDDYY
    const digits = t.replace(/[^\d]/g, "");
    if (digits.length === 8) {
      const mm = digits.slice(0, 2);
      const dd = digits.slice(2, 4);
      const yyyy = digits.slice(4, 8);
      return validateAndFormat(mm, dd, yyyy);
    }
    if (digits.length === 6) {
      const mm = digits.slice(0, 2);
      const dd = digits.slice(2, 4);
      const yy = digits.slice(4, 6);
      const yyyy = normalize2DigitYear(yy);
      return validateAndFormat(mm, dd, yyyy);
    }

    // Allow M/D/YYYY, MM/DD/YYYY, M/D/YY, MM/DD/YY
    const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
    if (!m) return null;

    const mm = m[1].padStart(2, "0");
    const dd = m[2].padStart(2, "0");
    const yyyy = m[3].length === 2 ? normalize2DigitYear(m[3]) : m[3];

    return validateAndFormat(mm, dd, yyyy);

    function normalize2DigitYear(yy: string) {
      const n = Number(yy);
      const year = n >= 70 ? 1900 + n : 2000 + n;
      return String(year);
    }

    function validateAndFormat(mm: string, dd: string, yyyy: string): string | null {
      const monthN = Number(mm);
      const dayN = Number(dd);
      const yearN = Number(yyyy);

      if (!Number.isFinite(monthN) || monthN < 1 || monthN > 12) return null;
      if (!Number.isFinite(dayN) || dayN < 1 || dayN > 31) return null;
      if (!Number.isFinite(yearN) || yearN < 1900 || yearN > 2100) return null;

      const d = new Date(`${yyyy}-${mm}-${dd}T00:00:00`);
      const ok = d.getFullYear() === yearN && d.getMonth() + 1 === monthN && d.getDate() === dayN;

      return ok ? `${yyyy}-${mm}-${dd}` : null;
    }
  }

  function findRelativeRule(line: string): string | null {
    const s = line.replace(/\s+/g, " ").trim();

    const m1 = s.match(/\b(within|no later than)\s+(\d+)\s+(day|days|week|weeks|month|months)\b/i);
    if (m1) return m1[0];

    const m2 = s.match(/\b([a-z]+(?:-[a-z]+)?)\s*\((\d+)\)\s*(day|days|week|weeks|month|months)\b/i);
    if (m2) return `${m2[2]} ${m2[3]}`;

    return null;
  }

  // -------------------------
  // Extraction (Section 1)
  // -------------------------
  function extractInsuranceSectionBlock(rawText: string): string {
    const lines = rawText
      .split(/\n+/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    const startIdx = lines.findIndex((l) => /^\(?1\)?\s*/.test(l));
    if (startIdx === -1) return "";

    const out: string[] = [];
    for (let i = startIdx; i < Math.min(lines.length, startIdx + 60); i++) {
      const l = lines[i];

      if (i > startIdx && /^\(\d+\)\s/.test(l)) break;
      if (i > startIdx && /^section\s+\d+/i.test(l)) break;

      out.push(l);
    }

    return out.join("\n");
  }

  function extractMvpItemsFromText(rawText: string): ReviewItem[] {
    const scopedText = extractInsuranceSectionBlock(rawText) || rawText;

    const lines = scopedText
      .split(/\n+/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
      .filter((l) => !isJunkLine(l));

    const windowLine = (i: number, n = 3) => lines.slice(i, i + n).join(" ").replace(/\s+/g, " ").trim();

    let s1Line: string | null = null;

    for (let i = 0; i < lines.length; i++) {
      const w = windowLine(i, 3);
      if (/(^|\s)\(?1\)?[.)]?\s*insurance\s*coverage\b/i.test(w) || /\binsurance\s*coverage\b/i.test(w)) {
        s1Line = w;
        break;
      }
    }

    if (!s1Line) {
      for (let i = 0; i < lines.length; i++) {
        const w = windowLine(i, 4);
        if (/\binsurance\b/i.test(w) && /(furnish|policy|carrier|coverage|on or before|within)\b/i.test(w)) {
          s1Line = w;
          break;
        }
      }
    }

    if (!s1Line) return [];

    const deadlineRaw = findExplicitDateRaw(s1Line);
    const relRule = findRelativeRule(s1Line);

    const confidence: ReviewItem["confidence"] = deadlineRaw ? "High" : relRule ? "Med" : "Low";

    return [
      {
        task_id: "t1",
        type: inferType(s1Line),

        obligation_title: "Section 1: Insurance Coverage",
        actor: "Defendant",
        actor_raw: null,

        // FIX (1): drop "furnish"
        action: "insurance coverage information",
        condition: "if not already provided",

        due_date: null,
        due_rule: deadlineRaw ?? relRule,

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
    setSectionBlock("");

    const formData = new FormData();
    formData.append("file", file);

    const res = await fetch("/api/parse?forceOcr=1", { method: "POST", body: formData });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      setStatus(`Error: ${err?.error || res.statusText}${err?.details ? " — " + err.details : ""}`);
      return;
    }

    const data = await res.json();
    const parsedText = data.text || "";

    setStatus(`Parsed ${data.filename} (${data.pages ?? "?"} pages)`);
    setText(parsedText);

    // FIX (3): store section block for highlight
    setSectionBlock(extractInsuranceSectionBlock(parsedText));

    const extracted = extractMvpItemsFromText(parsedText);
    setItems(extracted);
    setActiveId(extracted[0]?.task_id ?? null);

    setShowAnno(true);

    if (!extracted.length) {
      setStatus(`Parsed ${data.filename} (${data.pages ?? "?"} pages) — no Section 1 obligations detected.`);
    }
  }

  // -------------------------
  // Export gating
  // -------------------------
  const canExportActive = useMemo(() => {
    if (!activeItem) return false;
    const actorOk = activeItem.actor.trim().length > 0;
    const deadlineOk = !!activeItem.due_date || !!activeItem.due_rule;
    const checksOk = activeItem.checks.applies && activeItem.checks.deadline && activeItem.checks.ready;
    const metaOk = caseCaption.trim().length > 0 && indexNo.trim().length > 0;
    return actorOk && deadlineOk && checksOk && metaOk && activeItem.status === "Approved";
  }, [activeItem, caseCaption, indexNo]);

  async function copyExportLine() {

  setStatus("Copy button clicked.");

  if (!activeItem) return;

  const duePretty = activeItem.due_date
    ? formatISODate(activeItem.due_date)
    : activeItem.due_rule
    ? activeItem.due_rule
    : "DATE TBD";

  const titleLine = `${caseCaption} | ${indexNo}`;
  const actionClean = normalizeActionForExport(activeItem.action);
  const bodyLine = `${actionClean} due ${duePretty} (Actor: ${activeItem.actor}) (p.${activeItem.citation_page ?? 1})`;
  const block = `${titleLine}\n\n${bodyLine}`;

  setStatus("Copying…");

  // If not secure, skip straight to fallback
  if (!window.isSecureContext) {
    window.prompt("Copy this docket entry:", block);
    setStatus("Clipboard not available here; used manual copy prompt.");
    return;
  }

  try {
    await navigator.clipboard.writeText(block);
    setStatus("Copied docket/calendar entry to clipboard.");
    return;
  } catch {
    // Fallback: execCommand copy
    try {
      const ta = document.createElement("textarea");
      ta.value = block;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.top = "0";
      ta.style.left = "0";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);

      if (ok) {
        setStatus("Copied docket/calendar entry to clipboard.");
        return;
      }
    } catch {
      // ignore and drop to prompt
    }

    window.prompt("Copy this docket entry:", block);
    setStatus("Clipboard blocked; used manual copy prompt.");
  }
}

  // -------------------------
  // FIX (3): highlight Section 1 in PDF text layer (NO customTextRenderer)
  // -------------------------
  const sectionTokenSet = useMemo(() => {
    const b = normalizeSpaces(sectionBlock || "").toLowerCase();
    if (!b) return new Set<string>();

    const tokens = b
      .split(/\s+/)
      .map(normToken)
      .filter((t) => t.length >= 5);

    return new Set(tokens);
  }, [sectionBlock]);

  useEffect(() => {
    if (!pdfUrl) return;
    if (!sectionTokenSet.size) return;

    const root = pdfWrapRef.current;
    if (!root) return;

    const timer = window.setTimeout(() => {
      const spans = root.querySelectorAll(".react-pdf__Page__textContent span");

      spans.forEach((span) => {
        const raw = span.textContent || "";
        const words = raw
          .replace(/\s+/g, " ")
          .toLowerCase()
          .split(" ")
          .map(normToken)
          .filter((w) => w.length >= 5);

        const hit = words.some((w) => sectionTokenSet.has(w));

        const el = span as HTMLElement;
        if (hit) {
          el.style.background = "rgba(255, 230, 150, 0.35)";
          el.style.borderRadius = "3px";
        } else {
          el.style.background = "";
          el.style.borderRadius = "";
        }
      });
    }, 150);

    return () => window.clearTimeout(timer);
  }, [pdfUrl, sectionTokenSet]);

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
  <option value="All Defendants">All Defendants</option>
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
                  value={dateInput}
                  onChange={(e) => setDateInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
                  }}
                  onBlur={() => {
                    const iso = parseDateToISO(dateInput);
                    if (!iso) {
                      onPatch({ due_date: null });
                      return;
                    }
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
                  onChange={(e) => setRuleInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
                  }}
                  onBlur={() => {
                    const trimmed = ruleInput.trim();
                    onPatch({ due_rule: trimmed ? trimmed : null });
                  }}
                  placeholder="e.g., within 45 days"
                  style={{ padding: 8, borderRadius: 10, border: "1px solid #ddd", width: "100%" }}
                />

                <div style={{ fontSize: 11, opacity: 0.6, marginTop: 6 }}>raw: {item.due_rule ? item.due_rule : "—"}</div>
              </>
            )}
          </div>
        </div>

        <div style={{ marginTop: 12, border: "1px solid #eee", borderRadius: 12, padding: 10, background: "#fafafa" }}>
          <div style={{ fontSize: 11, fontWeight: 700, opacity: 0.75 }}>Citation (p.{item.citation_page ?? 1})</div>
          <div style={{ fontSize: 12, marginTop: 6, opacity: 0.9 }}>{item.citation_excerpt}</div>
        </div>

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
                setSectionBlock("");
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

          <div style={{ position: "relative", height: "calc(100vh - 120px)" }}>
            {pdfUrl ? (
              <>
                {isClient ? (
                  <Document file={pdfUrl}>
                    <div ref={pdfWrapRef} style={{ position: "relative", display: "inline-block" }}>
                      {/* NO customTextRenderer */}
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
                            <span style={{ marginLeft: 6, fontWeight: 400, opacity: 0.7 }}>{it.status === "Approved" ? "✅" : ""}</span>
                          </div>
                          <div style={{ fontSize: 12, opacity: 0.75 }}>{it.confidence}</div>
                        </div>

                        <div style={{ fontSize: 12, opacity: 0.85, marginTop: 4 }}>{it.action}</div>
                      </button>
                    );
                  })}
                </div>

                {activeItem ? (
                  <DemoStyleAnnotationCard
                    item={activeItem}
                    onPatch={(patch) => {
                      setItems((prev) => prev.map((x) => (x.task_id === activeItem.task_id ? { ...x, ...patch } : x)));
                    }}
                  />
                ) : null}

                {activeItem ? (
                  <div style={{ border: "1px solid #e5e5e5", borderRadius: 14, padding: 14, background: "white" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div>
                        <div style={{ fontSize: 12, opacity: 0.75 }}>Export Preview</div>
                        <div style={{ fontWeight: 800 }}>Docket entry + ticklers</div>
                      </div>
                      <div style={{ marginTop: 4, fontSize: 11, opacity: 0.65 }}>
  <strong>Standard ticklers: 30, 14, 7, 3, and 1 day(s) before the due date.</strong>
</div>

                      <div style={{ fontSize: 11, padding: "4px 10px", borderRadius: 999, border: "1px solid #eee", background: "#fafafa" }}>
                        Firm format: caption + index
                      </div>
                    </div>

                    <div style={{ marginTop: 10, border: "1px solid #eee", borderRadius: 12, padding: 10, background: "#fafafa" }}>
                      <div style={{ fontWeight: 700, fontSize: 12 }}>{caseCaption.trim() ? caseCaption.trim() : "Case caption (required)"}</div>
                      <div style={{ fontSize: 12, opacity: 0.85, marginTop: 4 }}>
                        Index No. {indexNo.trim() ? indexNo.trim() : "Index no. (required)"}
                      </div>

                      <div style={{ marginTop: 10, fontSize: 12 }}>
                        {normalizeActionForExport(activeItem.action)} due{" "}
                        {activeItem.due_date ? formatISODate(activeItem.due_date) : activeItem.due_rule ? activeItem.due_rule : "DEADLINE (required)"}{" "}
                        <span style={{ opacity: 0.75 }}>(Actor: {activeItem.actor || "…"})</span>
                      </div>

                      {!canExportActive ? (
                        <div style={{ marginTop: 8, fontSize: 11, opacity: 0.65 }}>
                          Copy blocked until: caption + index are filled, obligation approved, checkboxes confirmed, and deadline entered (date or rule).
                        </div>
                      ) : null}
                    </div>
                    
<div style={{ marginTop: 10, fontSize: 11, opacity: 0.65 }}>
  <strong>Audit trail:</strong> Docketed by Maria.
</div>

<button
  type="button"
  disabled={!canExportActive}
  onClick={() => {
    console.log("[copy] clicked");
    copyExportLine();
  }}
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
  Copy to clipboard
</button>

                  </div>
                ) : null}

                {text && (
                  <details style={{ marginTop: 12 }}>
                    <summary style={{ cursor: "pointer", fontSize: 12, opacity: 0.8 }}>Debug: extracted text preview</summary>
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

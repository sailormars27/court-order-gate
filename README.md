
# Disclosure

Pre-docket verification for court orders.

Disclosure is an early MVP that turns court orders into **defensible docket entries** by making the interpretation step explicit.

In civil litigation, the most dangerous part of docketing is not missing text. It is silently misinterpreting what a judge actually ordered. Court orders frequently contain handwritten edits, relative deadlines, conditional obligations, and OCR artifacts that look correct at a glance. Existing systems assume interpretation has already happened. Disclosure is designed to sit *before* the docket and force that judgment into the open.

---

## Quickstart (run this first)

### Requirements

- Node.js 18+
- System binaries available on PATH:
  - `pdftotext` and `pdfinfo` (from poppler-utils)
  - `ocrmypdf`

### macOS
```bash
brew install poppler ocrmypdf
````

### Ubuntu / Debian

```bash
sudo apt-get update
sudo apt-get install -y poppler-utils ocrmypdf
```

### Install and run

```bash
npm install
npm run dev
```

Open:

```
http://localhost:3000
```

---

## How to use the app

1. Upload a PDF court order
2. Click **Process Order**
3. Review the extracted obligation and its source citation
4. Confirm:

   * actor
   * deadline (date or rule)
5. Check all three confirmation boxes
6. Approve the obligation
7. Copy the generated docket entry to clipboard

Export is blocked until confirmation is complete.
Standard ticklers (30, 14, 7, 3, and 1 days before the due date) are included.
An audit trail (“Docketed by Maria”) is attached to the export.

---

## What this repo does

* Parses a court order PDF
* Attempts to extract **Section 1 (Insurance Coverage)** obligations
* Links each obligation to its source text and page
* Flags handwriting, relative deadlines, and OCR uncertainty
* Requires explicit human confirmation of actor and deadline
* Blocks export until review is complete
* Generates a source-linked, auditable docket entry

Nothing becomes a docket entry without review.

---

## Current MVP scope

The MVP intentionally focuses on **Section 1 (Insurance Coverage)** of New York Supreme Court **Preliminary Conference Orders**.

Section 1 appears in nearly every PC Order and looks standardized, but in practice often includes:

* handwritten dates or edits
* relative deadlines (e.g., “within 45 days”)
* implied actors
* OCR errors that appear plausible

Constraining scope to a single section makes ambiguity explicit rather than hiding it behind averages.

---

## How to evaluate correctness

This is **not** a demo of automation accuracy.

The system is working correctly if it:

* refuses to guess when text is ambiguous
* surfaces OCR uncertainty instead of hiding it
* requires explicit confirmation before export
* produces a source-linked, auditable docket entry

Manual confirmation is intentional.

---

## Parsing and OCR behavior

Backend endpoint:

```
POST /api/parse?forceOcr=1
```

Processing flow:

1. Extract native text using `pdftotext`
2. Run OCR using `ocrmypdf`
3. Extract OCR text
4. Compare native vs OCR output
5. Keep whichever result is meaningfully better
6. Return `source_quality` and debug metadata

OCR is treated as an uncertainty source, not a truth source.

---

## Status

* Early MVP
* Tested on real New York Supreme Court PC Orders
* Prioritizes correctness and auditability over speed
* No authentication, persistence, or multi-section coverage yet

---

## Notes for reviewers

This repository is intended to be run locally. The fastest way to evaluate it is to start the dev server, upload a real PC Order PDF, and walk through the review and approval flow. The product is intentionally conservative. Manual confirmation is required by design.

```

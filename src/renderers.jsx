import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { clipText, containsArabic, prettify } from "./utils.js";

function isRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function isPrimitive(value) {
  return value == null || typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function parseListString(value) {
  const lines = String(value || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) return null;
  const listish = lines.filter((line) => /^(\-|\*|\u2022|\d+[\).])\s+/.test(line));
  if (listish.length / lines.length < 0.6) return null;
  return lines.map((line) => line.replace(/^(\-|\*|\u2022)\s+/, "").replace(/^\d+[\).]\s+/, ""));
}

function ValueView({ value, depth = 0 }) {
  if (depth > 8) return <span className="muted">...</span>;

  if (isPrimitive(value)) {
    const text = value == null ? "" : String(value);
    const parsed = typeof value === "string" ? parseListString(value) : null;

    if (parsed) {
      return (
        <ul className="bullets">
          {parsed.map((item, index) => (
            <li key={index} dir={containsArabic(item) ? "rtl" : "auto"}>{item}</li>
          ))}
        </ul>
      );
    }

    return <span dir={containsArabic(text) ? "rtl" : "auto"}>{clipText(text, 7000)}</span>;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="muted">Empty list</span>;
    return (
      <ul className="bullets">
        {value.map((item, index) => (
          <li key={index}>
            <ValueView value={item} depth={depth + 1} />
          </li>
        ))}
      </ul>
    );
  }

  if (isRecord(value)) {
    return (
      <div className="kv">
        {Object.entries(value).map(([key, nested]) => (
          <div className="kvRow" key={key}>
            <div className="kvKey">{prettify(key)}</div>
            <div className="kvVal">
              <ValueView value={nested} depth={depth + 1} />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return <pre className="rawJson">{JSON.stringify(value, null, 2)}</pre>;
}

function SoapSection({ title, value, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className="soapSection">
      <button className="sectionToggle" type="button" onClick={() => setOpen((current) => !current)}>
        {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        <span>{title}</span>
      </button>
      {open && (
        <div className="soapBody">
          <ValueView value={value} />
        </div>
      )}
    </section>
  );
}

export function OutputViewer({ output }) {
  const payload = output?.payload || {};
  const soap = payload.medical_notes_soap || {};
  const sectionEntries = [
    ["Subjective", soap.subjective],
    ["Objective", soap.objective],
    ["Assessment", soap.assessment],
    ["Plan", soap.plan],
  ].filter(([, value]) => value != null);

  return (
    <div className="outputViewer">
      <div className="soapStack">
        {payload.conversation_summary && (
          <SoapSection title="Conversation Summary" value={payload.conversation_summary} />
        )}
        {sectionEntries.map(([title, value]) => (
          <SoapSection key={title} title={title} value={value} defaultOpen={title !== "Objective"} />
        ))}
      </div>
    </div>
  );
}

export function TextModal({ title, subtitle, text, onClose }) {
  return (
    <div className="modalOverlay" role="dialog" aria-modal="true" aria-label={title}>
      <div className="modalPanel">
        <div className="modalHeader">
          <div>
            <div className="modalTitle">{title}</div>
            {subtitle && <div className="modalSubtitle">{subtitle}</div>}
          </div>
          <button className="iconButton" type="button" onClick={onClose} aria-label="Close transcript">
            ×
          </button>
        </div>
        <pre className="transcriptText" dir={containsArabic(text) ? "rtl" : "ltr"}>{text}</pre>
      </div>
    </div>
  );
}

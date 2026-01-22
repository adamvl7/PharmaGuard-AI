"use client";

import { useMemo, useState } from "react";

type EvidenceItem = {
  chunk_id: number;
  section: string;
  chunk_index: number;
  preview: string;
};

type ChatResponse = {
  answer: string[];
  safety_note?: string;
  citations?: { chunk_id: number; section: string; chunk_index: number }[];
  evidence?: EvidenceItem[];
  label_id?: number; // from /chat-by-drug (optional but nice)
};

type ChunkResponse = {
  id: number;
  label_id: number;
  section: string;
  chunk_index: number;
  text: string;
};

type CompareResponse = {
  status: string;
  message?: string;
  label_ids?: { drug_a: number; drug_b: number };
  drug_a?: { name: string; label_id: number };
  drug_b?: { name: string; label_id: number };
  summary?: string[];
  evidence?: {
    from_drug_a_label: EvidenceItem[];
    from_drug_b_label: EvidenceItem[];
  };
};

type IngestResponse = {
  status: string;
  id: number;
  input: string;
  set_id?: string;
  chunks_stored?: number;
};

function cx(...xs: Array<string | false | undefined | null>) {
  return xs.filter(Boolean).join(" ");
}

function sectionLabel(section: string) {
  const map: Record<string, string> = {
    indications_and_usage: "Indications",
    contraindications: "Contraindications",
    warnings: "Warnings",
    warnings_and_cautions: "Warnings & Cautions",
    drug_interactions: "Drug Interactions",
    adverse_reactions: "Adverse Reactions",
    dosage_and_administration: "Dosage",
  };
  return map[section] || section;
}

function sectionBadgeClass(section: string) {
  if (section.includes("contra")) return "bg-rose-50 text-rose-700 border-rose-200";
  if (section.includes("warning")) return "bg-amber-50 text-amber-800 border-amber-200";
  if (section.includes("interaction")) return "bg-indigo-50 text-indigo-700 border-indigo-200";
  if (section.includes("dosage")) return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (section.includes("adverse")) return "bg-violet-50 text-violet-700 border-violet-200";
  return "bg-sky-50 text-sky-700 border-sky-200";
}

function TopButton({ label, onClick }: { label: string; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition active:scale-[0.99]"
    >
      {label}
    </button>
  );
}

function Pill({
  label,
  onClick,
}: {
  label: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition active:scale-[0.99]"
    >
      {label}
      <span className="text-[10px] opacity-60">⌄</span>
    </button>
  );
}

export default function Page() {
  const API = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000";

  const [mode, setMode] = useState<"chat" | "ingest" | "compare">("chat");

  // inputs
  const [drugName, setDrugName] = useState<string>("ibuprofen");
  const [question, setQuestion] = useState<string>(
    "What does the FDA label say about bleeding risk and interactions?"
  );

  const [drugA, setDrugA] = useState<string>("ibuprofen");
  const [drugB, setDrugB] = useState<string>("aspirin");

  // results
  const [busy, setBusy] = useState<boolean>(false);
  const [drawerOpen, setDrawerOpen] = useState<boolean>(true);

  const [chat, setChat] = useState<ChatResponse | null>(null);
  const [compareResult, setCompareResult] = useState<CompareResponse | null>(null);
  const [ingestStatus, setIngestStatus] = useState<string | null>(null);

  // citation viewer
  const [selectedChunkId, setSelectedChunkId] = useState<number | null>(null);
  const [chunkText, setChunkText] = useState<string>("");
  const [chunkMeta, setChunkMeta] = useState<{ section?: string; chunk_index?: number } | null>(null);

  const canRun = useMemo(() => {
    if (busy) return false;
    if (mode === "ingest") return drugName.trim().length > 0;
    if (mode === "compare") return drugA.trim().length > 0 && drugB.trim().length > 0;
    return drugName.trim().length > 0 && question.trim().length > 0;
  }, [busy, mode, drugName, question, drugA, drugB]);

  async function openChunk(ev: EvidenceItem) {
    setSelectedChunkId(ev.chunk_id);
    setChunkText("Loading excerpt…");
    setChunkMeta({ section: ev.section, chunk_index: ev.chunk_index });

    try {
      const res = await fetch(`${API}/chunks/${ev.chunk_id}`);
      if (!res.ok) throw new Error(`Chunk fetch failed: ${res.status}`);
      const data = (await res.json()) as ChunkResponse;
      setChunkText(data.text);
      setChunkMeta({ section: data.section, chunk_index: data.chunk_index });
    } catch (e: any) {
      setChunkText(`❌ ${e?.message || "Unknown error"}`);
    }
  }

  async function run() {
    setBusy(true);
    setDrawerOpen(true);
    setSelectedChunkId(null);
    setChunkText("");
    setChunkMeta(null);

    setChat(null);
    setCompareResult(null);
    setIngestStatus(null);

    try {
      if (mode === "ingest") {
        setIngestStatus("Fetching FDA label via openFDA…");
        const url = new URL(`${API}/ingest/fda-label`);
        url.searchParams.set("drug", drugName.trim());

        const res = await fetch(url.toString(), { method: "POST" });
        if (!res.ok) throw new Error(`Ingest failed: ${res.status}`);
        const data = (await res.json()) as IngestResponse;
        setIngestStatus(
          `✅ Ingested "${data.input}" • Label ID ${data.id} • Stored ${data.chunks_stored ?? 0} chunks`
        );
      } else if (mode === "compare") {
        const url = new URL(`${API}/compare`);
        url.searchParams.set("drug_a", drugA.trim());
        url.searchParams.set("drug_b", drugB.trim());

        const res = await fetch(url.toString(), { method: "POST" });
        if (!res.ok) throw new Error(`Compare failed: ${res.status}`);
        const data = (await res.json()) as CompareResponse;
        setCompareResult(data);
      } else {
        // Startup-grade flow: chat by drug name (backend resolves label_id)
        const url = new URL(`${API}/chat-by-drug`);
        url.searchParams.set("drug", drugName.trim());
        url.searchParams.set("question", question.trim());

        const res = await fetch(url.toString(), { method: "POST" });
        if (!res.ok) throw new Error(`Chat failed: ${res.status}`);
        const data = (await res.json()) as ChatResponse;
        setChat(data);
      }
    } catch (e: any) {
      if (mode === "compare") setCompareResult({ status: "error", message: e?.message || "Unknown error" });
      else if (mode === "ingest") setIngestStatus(`❌ ${e?.message || "Unknown error"}`);
      else setChat({ answer: [`❌ ${e?.message || "Unknown error"}`] });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-white text-slate-900">
      {/* NAV: always clickable */}
      <header className="sticky top-0 z-[60] border-b border-slate-200 bg-white/80 backdrop-blur">
        <div className="mx-auto max-w-7xl px-4 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-2xl bg-gradient-to-br from-indigo-500 to-sky-500 shadow-sm flex items-center justify-center text-white font-black">
              P
            </div>
            <div className="leading-tight">
              <div className="text-sm font-semibold text-slate-900">PharmaGuard AI</div>
              <div className="text-xs text-slate-500">New insight</div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <TopButton label="Share" onClick={() => alert("Share coming soon")} />
            <TopButton label="Select Project" onClick={() => alert("Projects coming soon")} />
            <button
              type="button"
              onClick={() => {
                setChat(null);
                setCompareResult(null);
                setIngestStatus(null);
                setSelectedChunkId(null);
                setChunkText("");
                setQuestion("");
                setDrawerOpen(true);
              }}
              className="rounded-xl bg-indigo-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 transition active:scale-[0.99]"
            >
              + New Chat
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6">
        <div className="relative overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
          {/* Decorative layers MUST NOT capture clicks */}
          <div
            className="pointer-events-none absolute inset-0 opacity-[0.45]"
            style={{
              backgroundImage:
                "linear-gradient(to right, rgba(15, 23, 42, 0.06) 1px, transparent 1px), linear-gradient(to bottom, rgba(15, 23, 42, 0.06) 1px, transparent 1px)",
              backgroundSize: "44px 44px",
            }}
          />
          <div className="pointer-events-none absolute -top-24 left-1/2 h-72 w-72 -translate-x-1/2 rounded-full bg-gradient-to-b from-indigo-200 to-sky-200 blur-2xl opacity-60" />

          {/* Content */}
          <div className="relative min-h-[680px]">
            {/* Canvas center */}
            <div className="flex flex-col items-center justify-center px-6 text-center pt-14 pb-48">
              {/* orb */}
              <div className="relative mb-8 pointer-events-none">
                <div className="h-44 w-44 rounded-full bg-gradient-to-b from-indigo-500 to-sky-400 opacity-90 shadow-lg" />
                <div className="absolute inset-0 rounded-full bg-[radial-gradient(circle_at_30%_30%,rgba(255,255,255,0.65),transparent_55%)]" />
                <div className="absolute left-1/2 top-1/2 w-[290px] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-slate-200 bg-white/80 backdrop-blur px-4 py-3 shadow-sm">
                  <div className="flex items-center gap-3">
                    <div className="h-8 w-8 rounded-xl bg-gradient-to-br from-indigo-500 to-sky-500" />
                    <div className="flex-1 text-left">
                      <div className="h-2.5 w-40 rounded bg-slate-200" />
                      <div className="mt-2 h-2 w-56 rounded bg-slate-100" />
                    </div>
                  </div>
                </div>
              </div>

              <h1 className="text-4xl sm:text-5xl font-semibold tracking-tight">
                Let the <span className="text-indigo-600">Label</span> Speak
              </h1>
              <p className="mt-3 max-w-2xl text-sm sm:text-base text-slate-600">
                Ask FDA-grounded questions. Get evidence with citations you can open — built for clinical-grade clarity.
              </p>

              {/* Mode switch */}
              <div className="mt-7 inline-flex rounded-2xl border border-slate-200 bg-white/80 backdrop-blur p-1 shadow-sm">
                {(["chat", "ingest", "compare"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMode(m)}
                    className={cx(
                      "px-4 py-2 text-sm font-semibold rounded-xl transition",
                      mode === m ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-50"
                    )}
                  >
                    {m === "chat" ? "Chat" : m === "ingest" ? "Ingest" : "Compare"}
                  </button>
                ))}
              </div>
            </div>

            {/* Bottom controls area (NO overlap) */}
            <div className="absolute inset-x-0 bottom-0 px-6 pb-6">
              {/* Pills row ABOVE input bar */}
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3 relative z-[40]">
                <div className="flex flex-wrap gap-2">
                  <Pill label="User Journey" onClick={() => alert("Coming soon")} />
                  <Pill label="Audience" onClick={() => alert("Coming soon")} />
                  <Pill label="Event" onClick={() => alert("Coming soon")} />
                </div>
                <button
                  type="button"
                  onClick={() => alert("Saved prompts coming soon")}
                  className="rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition active:scale-[0.99]"
                >
                  ✨ Saved Prompts
                </button>
              </div>

              {/* Input bar */}
              <div className="mx-auto max-w-4xl rounded-2xl border border-slate-200 bg-white/95 backdrop-blur shadow-sm relative z-[45]">
                <div className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center">
                  <div className="flex-1 space-y-2">
                    {mode === "compare" ? (
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        <input
                          value={drugA}
                          onChange={(e) => setDrugA(e.target.value)}
                          placeholder="Drug A (e.g., ibuprofen)"
                          className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-4 focus:ring-indigo-100 focus:border-indigo-300"
                        />
                        <input
                          value={drugB}
                          onChange={(e) => setDrugB(e.target.value)}
                          placeholder="Drug B (e.g., aspirin)"
                          className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-4 focus:ring-indigo-100 focus:border-indigo-300"
                        />
                      </div>
                    ) : (
                      <input
                        value={drugName}
                        onChange={(e) => setDrugName(e.target.value)}
                        placeholder="Drug name (e.g., ibuprofen)"
                        className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-4 focus:ring-sky-100 focus:border-sky-300"
                      />
                    )}

                    {mode === "chat" && (
                      <input
                        value={question}
                        onChange={(e) => setQuestion(e.target.value)}
                        placeholder="What's your next insight? Ask and find out."
                        className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-4 focus:ring-sky-100 focus:border-sky-300"
                      />
                    )}

                    {mode === "ingest" && (
                      <div className="text-xs text-slate-500">
                        This fetches from openFDA and stores chunks for evidence-based retrieval.
                      </div>
                    )}
                  </div>

                  <div className="flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setDrawerOpen((v) => !v)}
                      className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition active:scale-[0.99]"
                    >
                      {drawerOpen ? "Hide" : "Show"} Results
                    </button>

                    <button
                      type="button"
                      onClick={run}
                      disabled={!canRun}
                      className={cx(
                        "rounded-xl px-4 py-2 text-sm font-semibold text-white shadow-sm transition active:scale-[0.99]",
                        canRun ? "bg-indigo-600 hover:bg-indigo-700" : "bg-slate-300 cursor-not-allowed"
                      )}
                    >
                      {busy ? "Working…" : mode === "ingest" ? "Ingest" : mode === "compare" ? "Compare" : "Ask"}
                    </button>
                  </div>
                </div>

                <div className="px-4 pb-3 text-[11px] text-slate-500">
                  Data source: openFDA. Educational use only. Not medical advice.
                </div>
              </div>
            </div>

            {/* Right drawer (clickable) */}
            <div
              className={cx(
                "absolute top-0 right-0 h-full w-full sm:w-[520px] border-l border-slate-200 bg-white/95 backdrop-blur transition-transform duration-300 z-[55]",
                drawerOpen ? "translate-x-0" : "translate-x-full"
              )}
            >
              <div className="h-full flex flex-col">
                <div className="p-4 border-b border-slate-200 flex items-center justify-between">
                  <div>
                    <div className="text-sm font-semibold">Results</div>
                    <div className="text-xs text-slate-500">
                      {mode === "chat"
                        ? "Answer + citations"
                        : mode === "compare"
                        ? "Evidence across both labels"
                        : "Ingest status"}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setDrawerOpen(false)}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition active:scale-[0.99]"
                  >
                    Close
                  </button>
                </div>

                <div className="flex-1 overflow-auto p-4 space-y-4">
                  {/* Ingest */}
                  {mode === "ingest" && (
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-800">
                      {ingestStatus || "Run ingest to see status here."}
                    </div>
                  )}

                  {/* Chat */}
                  {mode === "chat" && (
                    <>
                      <div className="rounded-2xl border border-slate-200 bg-white p-4">
                        <div className="flex items-center justify-between">
                          <div className="text-sm font-semibold">Answer</div>
                          {chat?.label_id ? (
                            <div className="text-xs text-slate-500">Label ID: {chat.label_id}</div>
                          ) : null}
                        </div>

                        {chat?.answer ? (
                          <ul className="mt-3 list-disc pl-5 space-y-2 text-sm text-slate-800">
                            {chat.answer.map((a, i) => (
                              <li key={i}>{a}</li>
                            ))}
                          </ul>
                        ) : (
                          <div className="mt-3 text-sm text-slate-500">Ask a question to generate an answer.</div>
                        )}

                        {chat?.safety_note && (
                          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
                            {chat.safety_note}
                          </div>
                        )}
                      </div>

                      <div className="rounded-2xl border border-slate-200 bg-white p-4">
                        <div className="text-sm font-semibold">Citations</div>
                        <div className="mt-3 space-y-2">
                          {(chat?.evidence || []).length === 0 ? (
                            <div className="text-sm text-slate-500">No citations yet.</div>
                          ) : (
                            chat!.evidence!.map((ev) => (
                              <button
                                type="button"
                                key={ev.chunk_id}
                                onClick={() => openChunk(ev)}
                                className="w-full text-left rounded-xl border border-slate-200 bg-white px-4 py-3 hover:bg-slate-50 transition active:scale-[0.99]"
                              >
                                <div className="flex flex-wrap items-center gap-2">
                                  <span
                                    className={cx(
                                      "rounded-full border px-2.5 py-1 text-[11px] font-semibold",
                                      sectionBadgeClass(ev.section)
                                    )}
                                  >
                                    {sectionLabel(ev.section)}
                                  </span>
                                  <span className="text-[11px] text-slate-500">
                                    Chunk {ev.chunk_id} • #{ev.chunk_index}
                                  </span>
                                </div>
                                <div className="mt-2 text-xs text-slate-600 line-clamp-2">{ev.preview}</div>
                              </button>
                            ))
                          )}
                        </div>
                      </div>
                    </>
                  )}

                  {/* Compare */}
                  {mode === "compare" && (
                    <div className="rounded-2xl border border-slate-200 bg-white p-4">
                      {compareResult ? (
                        <>
                          {compareResult.status === "error" && (
                            <div className="text-sm text-slate-800">❌ {compareResult.message}</div>
                          )}

                          {compareResult.status === "needs_embeddings" && (
                            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                              {compareResult.message}
                              {compareResult.label_ids && (
                                <div className="mt-2 text-xs text-amber-900/80">
                                  Label IDs: A={compareResult.label_ids.drug_a}, B={compareResult.label_ids.drug_b}
                                </div>
                              )}
                            </div>
                          )}

                          {compareResult.status === "ok" && (
                            <>
                              <div className="text-sm font-semibold">
                                {compareResult.drug_a?.name} vs {compareResult.drug_b?.name}
                              </div>

                              {compareResult.summary && (
                                <ul className="mt-2 list-disc pl-5 text-xs text-slate-600 space-y-1">
                                  {compareResult.summary.map((s, i) => (
                                    <li key={i}>{s}</li>
                                  ))}
                                </ul>
                              )}
                            </>
                          )}
                        </>
                      ) : (
                        <div className="text-sm text-slate-500">Run a comparison to see evidence here.</div>
                      )}
                    </div>
                  )}

                  {/* Citation viewer */}
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="flex items-center justify-between">
                      <div className="text-sm font-semibold">Selected Citation</div>
                      {selectedChunkId && <span className="text-xs text-slate-500">Chunk {selectedChunkId}</span>}
                    </div>

                    <div className="mt-3 rounded-2xl border border-slate-200 bg-white p-4 min-h-[180px] whitespace-pre-wrap text-sm text-slate-800">
                      {selectedChunkId ? (
                        <>
                          <div className="mb-3 flex flex-wrap items-center gap-2">
                            {chunkMeta?.section && (
                              <span
                                className={cx(
                                  "rounded-full border px-2.5 py-1 text-[11px] font-semibold",
                                  sectionBadgeClass(chunkMeta.section)
                                )}
                              >
                                {sectionLabel(chunkMeta.section)}
                              </span>
                            )}
                            {typeof chunkMeta?.chunk_index === "number" && (
                              <span className="text-[11px] text-slate-500">#{chunkMeta.chunk_index}</span>
                            )}
                          </div>
                          {chunkText}
                        </>
                      ) : (
                        <div className="text-slate-500">Click a citation card to view the excerpt.</div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="p-4 border-t border-slate-200 text-[11px] text-slate-500">
                  Educational use only. Not medical advice. Confirm with a pharmacist/clinician.
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
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
};

type ChunkResponse = {
  id: number;
  label_id: number;
  section: string;
  chunk_index: number;
  text: string;
};

type IngestResponse = {
  status: string;
  id: number;
  input: string;
  set_id?: string;
  chunks_stored?: number;
};

export default function Home() {
  const API = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000";

  // NEW: Drug loader
  const [drugName, setDrugName] = useState<string>("ibuprofen");
  const [loadStatus, setLoadStatus] = useState<string>("");

  // Keep labelId but users shouldn’t type it normally
  const [labelId, setLabelId] = useState<string>("");

  // Chat
  const [question, setQuestion] = useState<string>(
    'What does the FDA label say about drug interactions and bleeding risk?'
  );
  const [loading, setLoading] = useState<boolean>(false);
  const [chat, setChat] = useState<ChatResponse | null>(null);

  // Citation viewer
  const [selectedChunkId, setSelectedChunkId] = useState<number | null>(null);
  const [chunkText, setChunkText] = useState<string>("");

  const canLoadDrug = useMemo(() => {
    return drugName.trim().length > 0 && !loading;
  }, [drugName, loading]);

  const canAsk = useMemo(() => {
    return labelId.trim().length > 0 && question.trim().length > 0 && !loading;
  }, [labelId, question, loading]);

  async function loadDrug() {
    setLoading(true);
    setChat(null);
    setSelectedChunkId(null);
    setChunkText("");
    setLoadStatus("Loading drug…");

    try {
      // 1) Ingest label
      const ingestUrl = new URL(`${API}/ingest/fda-label`);
      ingestUrl.searchParams.set("drug", drugName.trim());

      const ingestRes = await fetch(ingestUrl.toString(), { method: "POST" });
      if (!ingestRes.ok) {
        const text = await ingestRes.text();
        throw new Error(`Ingest failed (${ingestRes.status}): ${text}`);
      }
      const ingestData = (await ingestRes.json()) as IngestResponse;

      // 2) Set label id in UI
      setLabelId(String(ingestData.id));

      // 3) Embed label (semantic search)
      const embedUrl = new URL(`${API}/embed/label`);
      embedUrl.searchParams.set("label_id", String(ingestData.id));

      const embedRes = await fetch(embedUrl.toString(), { method: "POST" });
      if (!embedRes.ok) {
        const text = await embedRes.text();
        throw new Error(`Embed failed (${embedRes.status}): ${text}`);
      }

      setLoadStatus(
        `Loaded “${drugName.trim()}” → Label ID ${ingestData.id}${
          ingestData.chunks_stored ? ` (${ingestData.chunks_stored} chunks)` : ""
        }`
      );
    } catch (e: any) {
      setLoadStatus(`Error: ${e?.message || "Unknown error"}`);
    } finally {
      setLoading(false);
    }
  }

  async function runChat() {
    setLoading(true);
    setChat(null);
    setSelectedChunkId(null);
    setChunkText("");

    try {
      const url = new URL(`${API}/chat`);
      url.searchParams.set("label_id", labelId.trim());
      url.searchParams.set("question", question.trim());

      const res = await fetch(url.toString(), { method: "POST" });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Chat failed (${res.status}): ${text}`);
      }
      const data = (await res.json()) as ChatResponse;
      setChat(data);
    } catch (e: any) {
      setChat({
        answer: [`Error: ${e?.message || "Unknown error"}`],
      });
    } finally {
      setLoading(false);
    }
  }

  async function openChunk(chunkId: number) {
    setSelectedChunkId(chunkId);
    setChunkText("Loading…");

    try {
      const res = await fetch(`${API}/chunks/${chunkId}`);
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Chunk fetch failed (${res.status}): ${text}`);
      }
      const data = (await res.json()) as ChunkResponse;
      setChunkText(data.text);
    } catch (e: any) {
      setChunkText(`Error: ${e?.message || "Unknown error"}`);
    }
  }

  return (
    <main style={{ maxWidth: 1100, margin: "0 auto", padding: 24, fontFamily: "system-ui" }}>
      <h1 style={{ fontSize: 28, fontWeight: 700 }}>PharmaGuard AI</h1>
      <p style={{ marginTop: 8, opacity: 0.85 }}>
        Ask questions grounded in official FDA label text. Responses include citations you can open.
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 20 }}>
        <section style={{ border: "1px solid #ddd", borderRadius: 12, padding: 16 }}>
          <h2 style={{ fontSize: 16, fontWeight: 600 }}>Load a drug</h2>

          <label style={{ display: "block", marginTop: 12, fontSize: 13, opacity: 0.8 }}>
            Drug name (generic or brand)
          </label>

          <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
            <input
              value={drugName}
              onChange={(e) => setDrugName(e.target.value)}
              placeholder="e.g., ibuprofen"
              style={{ flex: 1, padding: 10, borderRadius: 10, border: "1px solid #ccc" }}
            />
            <button
              onClick={loadDrug}
              disabled={!canLoadDrug}
              style={{
                padding: "10px 14px",
                borderRadius: 10,
                border: "1px solid #111",
                background: canLoadDrug ? "#111" : "#666",
                color: "white",
                cursor: canLoadDrug ? "pointer" : "not-allowed",
                fontWeight: 600,
                whiteSpace: "nowrap",
              }}
            >
              {loading ? "Loading…" : "Load"}
            </button>
          </div>

          <div style={{ marginTop: 10, fontSize: 13, opacity: 0.9 }}>
            <div>
              <strong>Active label:</strong>{" "}
              {labelId ? <span>{labelId}</span> : <span style={{ opacity: 0.7 }}>None loaded yet</span>}
            </div>
            {loadStatus ? <div style={{ marginTop: 6, opacity: 0.8 }}>{loadStatus}</div> : null}
          </div>

          <hr style={{ margin: "16px 0", border: "none", borderTop: "1px solid #eee" }} />

          <h2 style={{ fontSize: 16, fontWeight: 600 }}>Ask a question</h2>

          <label style={{ display: "block", marginTop: 12, fontSize: 13, opacity: 0.8 }}>
            Question
          </label>
          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder='Try: "What does the label say about interactions with blood thinners?"'
            rows={4}
            style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid #ccc", marginTop: 6 }}
          />

          <button
            onClick={runChat}
            disabled={!canAsk}
            style={{
              marginTop: 12,
              padding: "10px 14px",
              borderRadius: 10,
              border: "1px solid #111",
              background: canAsk ? "#111" : "#666",
              color: "white",
              cursor: canAsk ? "pointer" : "not-allowed",
              fontWeight: 600,
            }}
          >
            {loading ? "Asking…" : "Ask"}
          </button>

          <details style={{ marginTop: 12 }}>
            <summary style={{ cursor: "pointer", fontSize: 12, opacity: 0.8 }}>Advanced</summary>
            <div style={{ marginTop: 10 }}>
              <label style={{ display: "block", fontSize: 13, opacity: 0.8 }}>Label ID (override)</label>
              <input
                value={labelId}
                onChange={(e) => setLabelId(e.target.value)}
                placeholder="e.g., 12"
                style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid #ccc", marginTop: 6 }}
              />
              <p style={{ marginTop: 6, fontSize: 12, opacity: 0.7 }}>
                Normally you won’t need this. Loading a drug sets the label automatically.
              </p>
            </div>
          </details>

          {chat && (
            <div style={{ marginTop: 16 }}>
              <h3 style={{ fontSize: 14, fontWeight: 700 }}>Answer</h3>
              <ul style={{ marginTop: 8, paddingLeft: 18 }}>
                {chat.answer?.map((line, idx) => (
                  <li key={idx} style={{ marginBottom: 8 }}>
                    {line}
                  </li>
                ))}
              </ul>

              {chat.safety_note && (
                <p style={{ marginTop: 10, fontSize: 12, opacity: 0.8 }}>{chat.safety_note}</p>
              )}

              {chat.evidence && chat.evidence.length > 0 && (
                <>
                  <h3 style={{ fontSize: 14, fontWeight: 700, marginTop: 16 }}>Citations</h3>
                  <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 8 }}>
                    {chat.evidence.map((ev) => (
                      <button
                        key={ev.chunk_id}
                        onClick={() => openChunk(ev.chunk_id)}
                        style={{
                          textAlign: "left",
                          padding: 10,
                          borderRadius: 10,
                          border: "1px solid #ccc",
                          background: "white",
                          cursor: "pointer",
                        }}
                      >
                        <div style={{ fontWeight: 700, fontSize: 13 }}>
                          Chunk {ev.chunk_id} • {ev.section} • #{ev.chunk_index}
                        </div>
                        <div style={{ fontSize: 12, opacity: 0.85, marginTop: 4 }}>{ev.preview}</div>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </section>

        <section style={{ border: "1px solid #ddd", borderRadius: 12, padding: 16 }}>
          <h2 style={{ fontSize: 16, fontWeight: 600 }}>Selected Citation</h2>
          <p style={{ marginTop: 8, fontSize: 12, opacity: 0.75 }}>
            Click a citation on the left to view the full FDA label excerpt.
          </p>

          <div
            style={{
              marginTop: 12,
              padding: 12,
              borderRadius: 10,
              border: "1px solid #ccc",
              minHeight: 320,
              whiteSpace: "pre-wrap",
            }}
          >
            {selectedChunkId ? (
              <>
                <div style={{ fontWeight: 700, marginBottom: 8 }}>Chunk {selectedChunkId}</div>
                {chunkText}
              </>
            ) : (
              <span style={{ opacity: 0.7 }}>No citation selected.</span>
            )}
          </div>
        </section>
      </div>

      <footer style={{ marginTop: 24, fontSize: 12, opacity: 0.75 }}>
        Data source: openFDA. This tool is for educational use only and does not provide medical advice.
      </footer>
    </main>
  );
}
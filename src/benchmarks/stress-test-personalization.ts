/**
 * QwenProxy - 50-Request Dynamic Personalization Stress Test (10KB to 500KB)
 *
 * Dispatches 50 consecutive requests where EVERY request carries a UNIQUE
 * system prompt / personalization instruction scaling dynamically from 10KB to 480KB.
 * Forces real in-browser personalization synchronization and WAF verification on every turn.
 *
 * Usage:
 *   npm run test:stress:personalization
 *   npx tsx src/benchmarks/stress-test-personalization.ts
 */

import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";

const TOTAL_REQUESTS = 50;
const BASE_URL = "http://127.0.0.1:7936/v1";
const API_KEY = process.env.API_KEY || "sk-qwenproxy-local";
const MODEL = process.env.MODEL || "qwen3.7-plus";

function generatePersonalizationInstruction(index: number, targetBytes: number): string {
  const header = `=== DYNAMIC AGENT PERSONA #${index} [SIZE TARGET: ${Math.round(targetBytes / 1024)}KB] ===\n` +
    `Você é o Especialista de Código QwenProxy #${index}. Sua diretriz é ser conciso e preciso.\n\n` +
    `[REGRAS DE CONTEXTO E DOMÍNIO EXTENSO]:\n`;

  const fillerUnit = `Regra #${index}: Todo código deve ser validado com testes unitários rigorosos, tipagem estrita no TypeScript, concorrência segura e tolerância a falhas distribuídas. `;
  const remaining = Math.max(0, targetBytes - Buffer.byteLength(header, "utf-8"));
  const repeats = Math.ceil(remaining / Buffer.byteLength(fillerUnit, "utf-8"));
  const fullBody = (header + fillerUnit.repeat(repeats)).slice(0, targetBytes);
  return fullBody;
}

interface PersonalizationRecord {
  index: number;
  personalizationBytes: number;
  personalizationKb: number;
  account: string | null;
  reqId: string | null;
  status: number;
  ok: boolean;
  ttfbMs: number;
  totalMs: number;
  outputChars: number;
  preview: string;
  timingHeader: string | null;
  error: string | null;
  timestamp: string;
}

async function executePersonalizationRequest(index: number, targetBytes: number): Promise<PersonalizationRecord> {
  const instruction = generatePersonalizationInstruction(index, targetBytes);
  const actualBytes = Buffer.byteLength(instruction, "utf-8");
  const startedAt = performance.now();
  let ttfbMs = 0;
  let outputText = "";
  let reqId: string | null = null;
  let account: string | null = null;
  let timingHeader: string | null = null;
  let statusCode = 0;
  let errorMsg: string | null = null;

  try {
    const response = await fetch(`${BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: instruction },
          { role: "user", content: `Identifique seu ID de persona (#${index}) e diga sua diretriz principal em uma frase.` },
        ],
        stream: true,
        max_tokens: 150,
      }),
    });

    statusCode = response.status;
    reqId = response.headers.get("x-request-id");
    account = response.headers.get("x-qwenproxy-account");
    timingHeader = response.headers.get("x-qwenproxy-timing");

    if (!response.body) throw new Error("No response body received");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      if (ttfbMs === 0) {
        ttfbMs = Math.round(performance.now() - startedAt);
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const dataStr = trimmed.replace(/^data:\s*/, "").trim();
        if (dataStr === "[DONE]") break;

        try {
          const parsed = JSON.parse(dataStr);
          const delta = parsed.choices?.[0]?.delta;
          if (delta?.content) {
            outputText += delta.content;
          }
        } catch {}
      }
    }

    if (!response.ok) {
      errorMsg = `HTTP ${response.status} ${response.statusText}`;
    }
  } catch (err: any) {
    errorMsg = err.message || String(err);
  }

  const totalMs = Math.round(performance.now() - startedAt);
  if (ttfbMs === 0) ttfbMs = totalMs;
  const ok = statusCode >= 200 && statusCode < 300 && errorMsg === null;

  return {
    index,
    personalizationBytes: actualBytes,
    personalizationKb: Math.round((actualBytes / 1024) * 10) / 10,
    account,
    reqId,
    status: statusCode,
    ok,
    ttfbMs,
    totalMs,
    outputChars: outputText.length,
    preview: outputText.slice(0, 140).replace(/\s+/g, " "),
    timingHeader,
    error: errorMsg,
    timestamp: new Date().toISOString(),
  };
}

async function main() {
  console.log("==================================================================");
  console.log(`🚀 QwenProxy Dynamic Personalization Stress Test — 50 Requests (10KB to 480KB)`);
  console.log(`📡 Target Model: ${MODEL} | URL: ${BASE_URL}/chat/completions`);
  console.log("==================================================================\n");

  try {
    const health = await fetch("http://127.0.0.1:7936/health", {
      headers: { Authorization: `Bearer ${API_KEY}` },
    });
    if (!health.ok) {
      console.error("❌ Servidor QwenProxy não está online em :7936");
      process.exit(1);
    }
  } catch {
    console.error("❌ Não foi possível conectar ao QwenProxy em :7936");
    process.exit(1);
  }

  const logDir = path.resolve("data/logs");
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

  const liveLogFile = path.join(logDir, "personalization-stress-50-live.log");
  fs.writeFileSync(liveLogFile, `=== QWENPROXY DYNAMIC PERSONALIZATION TEST (50 REQS: 10KB -> 480KB) ===\n\n`, "utf8");

  const results: PersonalizationRecord[] = [];
  const startTime = performance.now();
  let successCount = 0;
  let failureCount = 0;

  for (let i = 1; i <= TOTAL_REQUESTS; i++) {
    // Scales smoothly from 10,000 bytes (10KB) up to 480,000 bytes (480KB)
    const targetBytes = Math.round(10_000 + ((i - 1) / (TOTAL_REQUESTS - 1)) * 470_000);
    const targetKb = Math.round(targetBytes / 1024);

    const record = await executePersonalizationRequest(i, targetBytes);
    results.push(record);

    if (record.ok) successCount++;
    else failureCount++;

    const statusTag = record.ok ? "✅ 200 OK" : `❌ ${record.status || "ERR"}`;
    const logLine = `[${String(i).padStart(2, "0")}/${TOTAL_REQUESTS}] ${statusTag} | Persona: ${String(targetKb).padStart(3, " ")} KB | TTFB: ${record.ttfbMs}ms | Total: ${record.totalMs}ms | ${record.outputChars} chars | acct=${record.account || "auto"} | req=${record.reqId || "none"}`;

    console.log(logLine);
    fs.appendFileSync(liveLogFile, `${logLine}\n  Preview: "${record.preview}"\n  Error: ${record.error || "none"}\n\n`, "utf8");

    // Allow 500ms for upstream settings propagation
    await new Promise((r) => setTimeout(r, 500));
  }

  const totalBenchmarkMs = Math.round(performance.now() - startTime);

  const totalTimes = results.map((r) => r.totalMs).sort((a, b) => a - b);
  const ttfbTimes = results.map((r) => r.ttfbMs).sort((a, b) => a - b);
  const min = (arr: number[]) => (arr.length ? arr[0] : 0);
  const max = (arr: number[]) => (arr.length ? arr[arr.length - 1] : 0);
  const avg = (arr: number[]) => (arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0);
  const p = (arr: number[], pct: number) => (arr.length ? arr[Math.floor((arr.length - 1) * pct)] : 0);

  const accountsSet = Array.from(new Set(results.map((r) => r.account || "auto")));

  const summary = `
==================================================================
 📊 QwenProxy Dynamic Personalization (10KB-480KB) — Final Report
==================================================================

⏱️  Tempo Total do Teste: ${(totalBenchmarkMs / 1000).toFixed(2)}s
📦 Total de Requisições: ${TOTAL_REQUESTS}
✅ Sucessos: ${successCount} (${((successCount / TOTAL_REQUESTS) * 100).toFixed(1)}%)
❌ Falhas: ${failureCount} (${((failureCount / TOTAL_REQUESTS) * 100).toFixed(1)}%)
📈 Faixa de Personalização Testada: 10 KB até 480 KB por requisição

--- Latência Total (End-to-End) ---
  Min:  ${min(totalTimes)}ms
  P50:  ${p(totalTimes, 0.5)}ms
  Avg:  ${avg(totalTimes)}ms
  P90:  ${p(totalTimes, 0.9)}ms
  P95:  ${p(totalTimes, 0.95)}ms
  Max:  ${max(totalTimes)}ms

--- Time to First Byte (TTFB) ---
  Min:  ${min(ttfbTimes)}ms
  P50:  ${p(ttfbTimes, 0.5)}ms
  Avg:  ${avg(ttfbTimes)}ms
  P90:  ${p(ttfbTimes, 0.9)}ms
  Max:  ${max(ttfbTimes)}ms

--- Distribuição por Conta (Rotação) ---
${accountsSet
  .map((acc) => {
    const accReqs = results.filter((r) => (r.account || "auto") === acc);
    const accOk = accReqs.filter((r) => r.ok).length;
    const accAvg = avg(accReqs.map((r) => r.totalMs));
    const pct = ((accReqs.length / TOTAL_REQUESTS) * 100).toFixed(1);
    return `  • ${acc.padEnd(25)}: ${String(accReqs.length).padStart(2, " ")} reqs (${pct}%) | ${accOk} ok | Latência média: ${accAvg}ms`;
  })
  .join("\n")}

==================================================================
`;

  console.log(summary);

  const jsonReportPath = path.join(logDir, "personalization-stress-50-results.json");
  const summaryReportPath = path.join(logDir, "personalization-stress-50-summary.txt");

  fs.writeFileSync(jsonReportPath, JSON.stringify(results, null, 2), "utf8");
  fs.writeFileSync(summaryReportPath, summary, "utf8");

  console.log(`📁 Relatório JSON detalhado salvo em: ${jsonReportPath}`);
  console.log(`📄 Resumo executivo salvo em: ${summaryReportPath}`);
  console.log(`📜 Log contínuo salvo em: ${liveLogFile}\n`);
}

main().catch(console.error);

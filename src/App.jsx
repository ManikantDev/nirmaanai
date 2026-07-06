import React, { useState, useMemo, useRef, useEffect } from "react";
import { PieChart, Pie, Cell, ResponsiveContainer } from "recharts";

// ─────────────────────────────────────────────────────────────
// NirmaanAI v1 — AI Construction Cost Estimator (Telangana)
// Chat-driven estimation (Claude API via /api/chat proxy)
// ─────────────────────────────────────────────────────────────

// ---------- PRICING DATA (Telangana, mid-2026 indicative) ----------
const DISTRICTS = [
  { id: "hyderabad", name: "Hyderabad", coeff: 1.12 },
  { id: "medchal", name: "Medchal-Malkajgiri", coeff: 1.08 },
  { id: "rangareddy", name: "Rangareddy", coeff: 1.06 },
  { id: "sangareddy", name: "Sangareddy", coeff: 1.02 },
  { id: "warangal", name: "Warangal", coeff: 0.96 },
  { id: "karimnagar", name: "Karimnagar", coeff: 0.94 },
  { id: "nizamabad", name: "Nizamabad", coeff: 0.93 },
  { id: "khammam", name: "Khammam", coeff: 0.94 },
  { id: "nalgonda", name: "Nalgonda", coeff: 0.92 },
  { id: "mahbubnagar", name: "Mahabubnagar", coeff: 0.91 },
  { id: "siddipet", name: "Siddipet", coeff: 0.95 },
  { id: "adilabad", name: "Adilabad", coeff: 0.90 },
];

const QUALITY = [
  { id: "low", name: "Low Budget", rate: 1450, desc: "Basic finishes, local materials" },
  { id: "standard", name: "Standard", rate: 1750, desc: "Branded cement & steel, vitrified tiles" },
  { id: "premium", name: "Premium", rate: 2250, desc: "Premium brands, designer finishes" },
  { id: "luxury", name: "Luxury", rate: 2950, desc: "Imported fittings, luxury spec" },
];

const BUILDING_TYPES = [
  { id: "independent", name: "Independent House", floors: 1 },
  { id: "duplex", name: "Duplex", floors: 2 },
  { id: "villa", name: "Villa", floors: 2 },
  { id: "g1", name: "G + 1", floors: 2 },
  { id: "g2", name: "G + 2", floors: 3 },
  { id: "g3", name: "G + 3", floors: 4 },
];

const BREAKDOWN = [
  { key: "RCC (Structure)", share: 0.39, color: "#f97316" },
  { key: "Brickwork", share: 0.15, color: "#3b82f6" },
  { key: "Finishing", share: 0.22, color: "#22c55e" },
  { key: "Plumbing & Sanitary", share: 0.08, color: "#a855f7" },
  { key: "Electrical", share: 0.07, color: "#eab308" },
  { key: "Others", share: 0.09, color: "#64748b" },
];

const GROUND_COVERAGE = 0.85;
const PARKING_COST = 180000;

// ---------- HELPERS ----------
const fmtINR = (n) => "₹ " + Math.round(n).toLocaleString("en-IN");
const sqYdToSqFt = (y) => y * 9;

function computeEstimate(s) {
  const plotSqFt = s.plotUnit === "sqyd" ? sqYdToSqFt(s.plotValue) : s.plotValue;
  const type = BUILDING_TYPES.find((t) => t.id === s.buildingType) || BUILDING_TYPES[0];
  const quality = QUALITY.find((q) => q.id === s.quality) || QUALITY[1];
  const district = DISTRICTS.find((d) => d.id === s.district) || DISTRICTS[1];

  const builtUp = plotSqFt * GROUND_COVERAGE * type.floors;
  const rate = quality.rate * district.coeff;
  let total = builtUp * rate;
  if (s.parking) total += PARKING_COST;

  const breakdown = BREAKDOWN.map((b) => ({
    name: b.key,
    value: Math.round(total * b.share),
    pct: Math.round(b.share * 100),
    color: b.color,
  }));

  return {
    total,
    perSqFt: builtUp > 0 ? total / builtUp : 0,
    builtUp: Math.round(builtUp),
    plotSqFt: Math.round(plotSqFt),
    floors: type.floors,
    typeName: type.name,
    qualityName: quality.name,
    districtName: district.name,
    breakdown,
  };
}

// ---------- CLAUDE (via serverless proxy) ----------
async function askClaude(history, userMsg, projectState) {
  const system = `You are NirmaanAI's estimation assistant for home builders in Telangana, India.
Users describe their plot in natural language (English, Telugu, or Tenglish). Extract structured project details.

Current project state: ${JSON.stringify(projectState)}

Valid values:
- plotUnit: "sqyd" or "sqft" (Indians usually say gajalu / square yards / gajam = sqyd)
- buildingType: independent, duplex, villa, g1, g2, g3
- quality: low, standard, premium, luxury
- district: ${DISTRICTS.map((d) => d.id).join(", ")}
- parking: true/false

Respond ONLY with valid JSON, no markdown fences, in this exact shape:
{"reply": "short friendly reply (2-4 sentences, confirm what you understood, you may mix simple Telugu words if user does)", "updates": {"plotValue": number or null, "plotUnit": string or null, "buildingType": string or null, "quality": string or null, "district": string or null, "parking": boolean or null}}

Only include fields in updates that the user actually mentioned or changed. Use null for everything else. If the user asks a general construction question, answer briefly in reply and set all updates to null.`;

  const messages = [
    ...history.slice(-8).map((m) => ({ role: m.role, content: m.text })),
    { role: "user", content: userMsg },
  ];

  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ system, messages }),
  });

  if (!res.ok) throw new Error("API error");
  const data = await res.json();
  const clean = (data.text || "").replace(/```json|```/g, "").trim();
  return JSON.parse(clean);
}

// ---------- UI ----------
const NAV = [
  { icon: "🏠", label: "Dashboard", active: true },
  { icon: "📁", label: "My Projects" },
  { icon: "📊", label: "Cost Estimates" },
  { icon: "🔖", label: "Saved Estimates" },
  { icon: "📈", label: "Material Rates" },
  { icon: "⚙️", label: "Settings" },
];

export default function App() {
  const [state, setState] = useState({
    plotValue: 150,
    plotUnit: "sqyd",
    buildingType: "g2",
    quality: "standard",
    district: "medchal",
    parking: false,
  });

  const [messages, setMessages] = useState([
    {
      role: "assistant",
      text:
        "Namaste! 🙏 I'm your NirmaanAI assistant. Describe your project — for example: \"150 gajala plot in Medchal, G+2 house, standard quality\" — and I'll calculate your construction cost instantly.",
    },
  ]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const chatEndRef = useRef(null);

  const est = useMemo(() => computeEstimate(state), [state]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, thinking]);

  const applyUpdates = (u) => {
    if (!u) return;
    setState((prev) => {
      const next = { ...prev };
      if (u.plotValue != null && u.plotValue > 0) next.plotValue = u.plotValue;
      if (u.plotUnit === "sqyd" || u.plotUnit === "sqft") next.plotUnit = u.plotUnit;
      if (u.buildingType && BUILDING_TYPES.some((t) => t.id === u.buildingType))
        next.buildingType = u.buildingType;
      if (u.quality && QUALITY.some((q) => q.id === u.quality)) next.quality = u.quality;
      if (u.district && DISTRICTS.some((d) => d.id === u.district)) next.district = u.district;
      if (typeof u.parking === "boolean") next.parking = u.parking;
      return next;
    });
  };

  const send = async (textOverride) => {
    const text = (textOverride || input).trim();
    if (!text || thinking) return;
    setInput("");
    const history = messages;
    setMessages((m) => [...m, { role: "user", text }]);
    setThinking(true);
    try {
      const out = await askClaude(history, text, state);
      applyUpdates(out.updates);
      setMessages((m) => [...m, { role: "assistant", text: out.reply }]);
    } catch (e) {
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          text:
            "I couldn't process that just now — but you can adjust everything using the controls on the right, and the estimate updates live.",
        },
      ]);
    } finally {
      setThinking(false);
    }
  };

  const chips = [
    { label: "Change to Premium", msg: "Change quality to premium" },
    { label: "Make it G+1", msg: "Change to a G+1 building" },
    { label: "Add parking", msg: "Add covered parking for 1 car" },
    { label: "200 sq.yds", msg: "Change plot size to 200 square yards" },
  ];

  return (
    <div className="flex h-screen bg-slate-100 font-sans text-slate-800">
      {/* ───────── Sidebar ───────── */}
      <aside className="hidden md:flex w-60 flex-col bg-slate-950 text-slate-300">
        <div className="px-5 py-5 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <span className="text-2xl">🏗️</span>
            <div>
              <div className="text-lg font-bold text-white">
                Nirmaan<span className="text-orange-500">AI</span>
              </div>
              <div className="text-[10px] tracking-wide text-slate-500">
                AI CONSTRUCTION COST ESTIMATOR
              </div>
            </div>
          </div>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-1">
          {NAV.map((n) => (
            <div
              key={n.label}
              className={
                "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm cursor-pointer " +
                (n.active
                  ? "bg-orange-500/15 text-orange-400 font-semibold"
                  : "hover:bg-slate-800/60")
              }
            >
              <span>{n.icon}</span>
              {n.label}
            </div>
          ))}
        </nav>
        <div className="m-3 rounded-xl bg-slate-900 p-4 border border-slate-800">
          <div className="text-sm font-semibold text-white mb-1">👑 Go Premium</div>
          <p className="text-xs text-slate-400 mb-3">
            Unlock detailed BOQ reports, PDF export & price alerts.
          </p>
          <button className="w-full rounded-lg bg-orange-500 py-2 text-sm font-semibold text-white hover:bg-orange-600">
            Upgrade Now
          </button>
        </div>
      </aside>

      {/* ───────── Main ───────── */}
      <main className="flex flex-1 flex-col overflow-hidden">
        <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3">
          <h1 className="text-lg font-bold">AI Estimator</h1>
          <div className="flex items-center gap-3">
            <select
              value={state.district}
              onChange={(e) => setState({ ...state, district: e.target.value })}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium"
            >
              {DISTRICTS.map((d) => (
                <option key={d.id} value={d.id}>
                  📍 {d.name}
                </option>
              ))}
            </select>
            <div className="h-9 w-9 rounded-full bg-orange-100 flex items-center justify-center text-sm font-bold text-orange-600">
              MK
            </div>
          </div>
        </header>

        <div className="flex flex-1 flex-col lg:flex-row overflow-hidden">
          {/* ── Chat panel ── */}
          <section className="flex flex-1 flex-col border-r border-slate-200 bg-white overflow-hidden">
            <div className="px-6 pt-5 pb-3">
              <h2 className="text-base font-bold">Describe your project</h2>
              <p className="text-xs text-slate-500">
                Tell us about your plot, construction type, area and preferences — English or
                Telugu.
              </p>
            </div>

            <div className="flex-1 overflow-y-auto px-6 space-y-4 pb-3">
              {messages.map((m, i) => (
                <div
                  key={i}
                  className={"flex " + (m.role === "user" ? "justify-end" : "justify-start")}
                >
                  <div
                    className={
                      "max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap " +
                      (m.role === "user"
                        ? "bg-orange-50 border border-orange-200"
                        : "bg-slate-50 border border-slate-200")
                    }
                  >
                    {m.text}
                  </div>
                </div>
              ))}
              {thinking && (
                <div className="flex justify-start">
                  <div className="rounded-2xl bg-slate-50 border border-slate-200 px-4 py-3 text-sm text-slate-400">
                    Calculating<span className="animate-pulse">…</span>
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            <div className="px-6 pb-2 flex flex-wrap gap-2">
              {chips.map((c) => (
                <button
                  key={c.label}
                  onClick={() => send(c.msg)}
                  className="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium hover:border-orange-400 hover:text-orange-600"
                >
                  {c.label}
                </button>
              ))}
            </div>

            <div className="border-t border-slate-200 p-4">
              <div className="flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2 focus-within:border-orange-400">
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && send()}
                  placeholder="Describe your project or ask something…"
                  className="flex-1 bg-transparent text-sm outline-none"
                />
                <button
                  onClick={() => send()}
                  disabled={thinking}
                  className="rounded-lg bg-orange-500 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-600 disabled:opacity-50"
                >
                  Send ➤
                </button>
              </div>
              <p className="mt-2 text-[10px] text-slate-400">
                AI estimates are indicative. Final cost may vary based on design, site conditions &
                material prices.
              </p>
            </div>
          </section>

          {/* ── Estimate panel ── */}
          <section className="w-full lg:w-[420px] overflow-y-auto bg-slate-50 p-5 space-y-4">
            <div className="rounded-2xl bg-white border border-slate-200 p-5 shadow-sm">
              <div className="flex items-center justify-between mb-1">
                <h3 className="text-sm font-bold">Estimated Construction Cost</h3>
                <span className="rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-semibold text-green-700">
                  ● Live Estimate
                </span>
              </div>
              <div className="flex items-center gap-4">
                <div className="flex-1">
                  <div className="text-3xl font-extrabold tracking-tight">{fmtINR(est.total)}</div>
                  <div className="text-xs text-slate-500 mt-1">
                    ({fmtINR(est.perSqFt)} / sq.ft)
                  </div>
                </div>
                <div className="h-28 w-28">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={est.breakdown}
                        dataKey="value"
                        innerRadius={32}
                        outerRadius={52}
                        paddingAngle={2}
                      >
                        {est.breakdown.map((b, i) => (
                          <Cell key={i} fill={b.color} />
                        ))}
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="mt-3 divide-y divide-slate-100">
                {est.breakdown.map((b) => (
                  <div key={b.name} className="flex items-center justify-between py-2 text-sm">
                    <div className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: b.color }} />
                      {b.name}
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="font-semibold">{fmtINR(b.value)}</span>
                      <span className="w-8 text-right text-xs text-slate-400">{b.pct}%</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-2xl bg-white border border-slate-200 p-5 shadow-sm">
              <h3 className="text-sm font-bold mb-3">Project Details</h3>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-xl bg-slate-50 p-3">
                  <div className="text-[10px] uppercase tracking-wide text-slate-400">
                    Plot Area
                  </div>
                  <div className="font-bold">
                    {state.plotValue} {state.plotUnit === "sqyd" ? "sq.yds" : "sq.ft"}
                  </div>
                  <div className="text-[11px] text-slate-500">= {est.plotSqFt} sq.ft</div>
                </div>
                <div className="rounded-xl bg-slate-50 p-3">
                  <div className="text-[10px] uppercase tracking-wide text-slate-400">
                    Built-up Area
                  </div>
                  <div className="font-bold">{est.builtUp.toLocaleString("en-IN")} sq.ft</div>
                  <div className="text-[11px] text-slate-500">{est.floors} floor slab(s)</div>
                </div>
                <div className="rounded-xl bg-slate-50 p-3">
                  <div className="text-[10px] uppercase tracking-wide text-slate-400">Type</div>
                  <div className="font-bold">{est.typeName}</div>
                </div>
                <div className="rounded-xl bg-slate-50 p-3">
                  <div className="text-[10px] uppercase tracking-wide text-slate-400">Parking</div>
                  <div className="font-bold">{state.parking ? "1 Car, Covered" : "None"}</div>
                </div>
              </div>
            </div>

            <div className="rounded-2xl bg-white border border-slate-200 p-5 shadow-sm space-y-4">
              <h3 className="text-sm font-bold">Adjust Manually</h3>

              <div>
                <label className="text-xs font-medium text-slate-500">Plot size</label>
                <div className="mt-1 flex gap-2">
                  <input
                    type="number"
                    min="10"
                    value={state.plotValue}
                    onChange={(e) => setState({ ...state, plotValue: Number(e.target.value) || 0 })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                  <select
                    value={state.plotUnit}
                    onChange={(e) => setState({ ...state, plotUnit: e.target.value })}
                    className="rounded-lg border border-slate-300 px-2 py-2 text-sm"
                  >
                    <option value="sqyd">sq.yds</option>
                    <option value="sqft">sq.ft</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="text-xs font-medium text-slate-500">Building type</label>
                <div className="mt-1 grid grid-cols-3 gap-2">
                  {BUILDING_TYPES.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => setState({ ...state, buildingType: t.id })}
                      className={
                        "rounded-lg border px-2 py-2 text-xs font-medium " +
                        (state.buildingType === t.id
                          ? "border-orange-500 bg-orange-50 text-orange-600"
                          : "border-slate-300 bg-white hover:border-slate-400")
                      }
                    >
                      {t.name}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-xs font-medium text-slate-500">Quality standard</label>
                <div className="mt-1 grid grid-cols-2 gap-2">
                  {QUALITY.map((q) => (
                    <button
                      key={q.id}
                      onClick={() => setState({ ...state, quality: q.id })}
                      className={
                        "rounded-lg border px-3 py-2 text-left " +
                        (state.quality === q.id
                          ? "border-orange-500 bg-orange-50"
                          : "border-slate-300 bg-white hover:border-slate-400")
                      }
                    >
                      <div className="text-xs font-bold">{q.name}</div>
                      <div className="text-[10px] text-slate-500">₹{q.rate}/sq.ft base</div>
                    </button>
                  ))}
                </div>
              </div>

              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={state.parking}
                  onChange={(e) => setState({ ...state, parking: e.target.checked })}
                  className="h-4 w-4 accent-orange-500"
                />
                Covered parking (1 car) — {fmtINR(PARKING_COST)}
              </label>
            </div>

            <button
              onClick={() =>
                alert("Detailed BOQ PDF is a Premium feature (₹499) — coming in v1.1 with Razorpay.")
              }
              className="w-full rounded-xl bg-orange-500 py-3 text-sm font-bold text-white hover:bg-orange-600"
            >
              ⬇ Download Detailed Estimate
            </button>
          </section>
        </div>
      </main>
    </div>
  );
}

#!/usr/bin/env bash
# Chạy trên máy chính: hỏi worker xem từng máy đang khả dụng thế nào và lần phân việc gần nhất ra sao.
# Đi đúng đường mà worker dùng (từ trong container), nên lỗi mạng/token/Tailscale hiện ra ở đây.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
compose=(docker-compose --env-file "$root/.env.selfhost" -f "$root/docker-compose.selfhost.yml")
"${compose[@]}" exec -T worker node -e '
fetch("http://127.0.0.1:8790/health").then((r) => r.json()).then(({ balancer }) => {
  const nodes = balancer?.nodes ?? [];
  if (!nodes.length) { console.log("Worker chỉ dùng máy chính (AI_NODES đang trống)."); return; }
  const label = { healthy: "SẴN SÀNG", degraded: "HẠN CHẾ", paused: "TẠM DỪNG", offline: "MẤT KẾT NỐI" };
  console.log("Chế độ:", balancer.mode);
  for (const n of nodes) {
    console.log(`\n- ${n.id}${n.role === "primary" ? " (máy chính)" : ""}: ${label[n.state]} — ${n.detail}`);
    if (n.rttMs !== null) console.log(`    độ trễ ${n.rttMs} ms`);
    for (const [lane, v] of Object.entries(n.lanes)) {
      console.log(`    ${lane.padEnd(10)} ${v.eligible ? "nhận việc" : "không nhận"}${v.avgMs ? ` (~${Math.round(v.avgMs / 1000)} giây/việc)` : ""}${v.reasons.length ? " — " + v.reasons.join("; ") : ""}`);
    }
  }
  for (const d of balancer.decisions.slice(0, 3)) console.log(`\nLần phân việc ${d.at}: ${d.reason}`);
}).catch((e) => { console.error("Không hỏi được worker:", e.message); process.exit(1); });
'

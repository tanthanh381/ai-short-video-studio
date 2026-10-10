import type { AirSetupSummary, NodeSummary } from "@studio/shared";

const clock = (iso: string) => new Date(iso).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
const gigabytes = (bytes: number) => (bytes / 1024 ** 3).toFixed(1).replace(".", ",");

export type AirSetupView = {
  title: string;
  message: string;
  percent: number;
  steps: Array<{ id: string; name: string; state: AirSetupSummary["steps"][number]["state"]; detail: string }>;
};

/** Words and numbers for the Settings page: which step the installation is at, the model download, whether the Air has been heard from. */
export function describeAirSetup(setup: AirSetupSummary, now = Date.now()): AirSetupView {
  const done = setup.steps.filter((step) => step.state === "done").length;
  const waiting = setup.active && setup.lastSeenAt === null;
  const seconds = setup.lastSeenAt ? Math.max(0, Math.round((now - new Date(setup.lastSeenAt).getTime()) / 1000)) : null;
  const message = waiting
    ? `Chưa thấy máy Air kết nối. Mở Terminal trên máy Air và dán dòng lệnh cài (hết hạn lúc ${clock(setup.expiresAt)}).`
    : setup.failed
      ? "Cài dừng ở bước đã đánh dấu đỏ. Sửa theo lời nhắn ở bước đó rồi dán lại dòng lệnh cài (chạy lại không làm mất phần đã tải)."
      : setup.finished
        ? "Máy Air đã báo xong; mục \"Máy cùng xử lý video\" bên dưới cho biết nó có nhận việc được chưa."
        : `${done}/${setup.steps.length} bước${seconds !== null ? ` · máy Air liên lạc ${seconds} giây trước` : ""} · phiên cài hết hạn lúc ${clock(setup.expiresAt)}`;
  return {
    title: setup.failed ? "Cài máy Air gặp lỗi" : setup.finished ? "Máy Air đã cài xong" : "Đang cài máy Air",
    message,
    percent: setup.finished && !setup.failed ? 100 : Math.round((done / Math.max(1, setup.steps.length)) * 100),
    steps: setup.steps.map((step) => {
      const { sentBytes, totalBytes } = setup.models;
      const download = step.id === "models" && totalBytes > 0 && step.state !== "pending"
        ? `Đã tải ${gigabytes(Math.min(sentBytes, totalBytes))} / ${gigabytes(totalBytes)} GB (${Math.min(100, Math.round((sentBytes / totalBytes) * 100))}%)`
        : "";
      return { id: step.id, name: step.name, state: step.state, detail: download || step.detail };
    }),
  };
}

/** What a machine is making right now and has made since the worker started: "đang vẽ 1 ảnh · đã xong 12 ảnh, 12 giọng". */
export function nodeActivity(node: NodeSummary): string {
  const kinds: Array<[string, string, string]> = [["image", "ảnh", "vẽ"], ["tts", "giọng", "đọc"], ["whiteboard", "cảnh vẽ tay", "vẽ"], ["llm", "kịch bản", "viết"]];
  const running = kinds.filter(([lane]) => (node.lanes[lane]?.running ?? 0) > 0).map(([lane, noun, verb]) => `đang ${verb} ${node.lanes[lane]!.running} ${noun}`);
  const done = kinds.filter(([lane]) => (node.lanes[lane]?.done ?? 0) > 0).map(([lane, noun]) => `${node.lanes[lane]!.done} ${noun}`);
  return [...running, ...(done.length ? [`đã xong ${done.join(", ")}`] : [])].join(" · ");
}

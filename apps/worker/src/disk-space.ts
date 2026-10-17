import { statfs } from "node:fs/promises";

export type DiskSpaceSnapshot = {
  availableBytes: number;
  totalBytes: number;
  availableGb: number;
  totalGb: number;
};

export type DiskSpaceCheck = DiskSpaceSnapshot & { allowed: boolean; minimumGb: number };

/** Keep enough headroom for FFmpeg, temporary frames and a retry of the export. */
export function assessDiskSpace(availableBytes: number, totalBytes: number, minimumGb = 4): DiskSpaceCheck {
  const availableGb = availableBytes / 1_000_000_000;
  const totalGb = totalBytes / 1_000_000_000;
  return {
    availableBytes,
    totalBytes,
    availableGb,
    totalGb,
    minimumGb,
    allowed: Number.isFinite(availableGb) && availableGb >= minimumGb,
  };
}

export function insufficientDiskMessage(check: DiskSpaceCheck): string {
  return `Không đủ dung lượng tạm để tạo video: còn ${check.availableGb.toFixed(1)} GB, cần tối thiểu ${check.minimumGb} GB. Hãy dọn storage rồi thử lại.`;
}

/** Fail before an AI job spends time generating media that cannot be rendered or saved. */
export async function assertDiskSpace(path: string, minimumGb = 4): Promise<DiskSpaceCheck> {
  const info = await statfs(path);
  const check = assessDiskSpace(Number(info.bavail) * Number(info.bsize), Number(info.blocks) * Number(info.bsize), minimumGb);
  if (!check.allowed) throw new Error(insufficientDiskMessage(check));
  return check;
}

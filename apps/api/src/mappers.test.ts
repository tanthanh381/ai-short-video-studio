import { describe, expect, it } from "vitest";
import { mapProject } from "./mappers";

describe("API mappers", () => {
  it("chuẩn hóa timestamp Supabase có offset +00:00 về ISO Z", () => {
    const project = mapProject({
      id: "7a8c603c-3f46-4324-ab4f-79c88ab0f88f",
      user_id: "7a8c603c-3f46-4324-ab4f-79c88ab0f88f",
      title: "Kiểm thử",
      source_text: "Nội dung kiểm thử đủ dài",
      input_mode: "idea",
      hook: "",
      suggested_title: "",
      suggested_description: "",
      status: "draft",
      settings: {},
      created_at: "2026-10-04T02:46:09.733+00:00",
      updated_at: "2026-10-04T02:46:09.733+00:00",
    });
    expect(project.createdAt).toBe("2026-10-04T02:46:09.733Z");
    expect(project.updatedAt).toBe("2026-10-04T02:46:09.733Z");
  });
});

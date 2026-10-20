import { describe, expect, it } from "vitest";
import { looksLikeFinishedScript, splitScript } from "./script";

const words = (text: string) => text.trim().split(/\s+/u).length;

/** The opening of a real script pasted line by line (one beat per line). */
const SILENCE = `CÓ NHỮNG NGƯỜI… CÀNG IM LẶNG, VẬN CÀNG LÊN.

Giữa một thế giới ai cũng vội nói, vội khoe, vội chứng minh…
Có những người chọn cách rất khác: im lặng.
Họ không ồn ào kể về dự định.
Không phô trương từng bước tiến.
Không biến mọi thành quả thành sân khấu.
Nhưng lạ thay… chính những người ấy lại thường đi xa nhất.
Người xưa gọi đó là: “Tàng phong tụ khí.”
Tức là biết giấu bớt sắc nhọn, giữ lại năng lượng, tích lũy nội lực… thay vì phát tán mọi thứ ra ngoài.
Bởi nhiều người, chỉ vừa có một ý tưởng đã nói.
Vừa có chút kết quả đã khoe.
Vừa mới bắt đầu đã muốn cả thiên hạ công nhận.
Nói nhiều… dễ loãng chí.
Khoe sớm… dễ hao năng lượng.
Thể hiện quá mức… dễ tự đánh mất sự tập trung.
Chưa kể, đời không chỉ có người nghe bạn bằng sự chúc phúc…
Mà còn có người nhìn bạn bằng sự ganh ghét.
Thế nên, người càng từng trải càng hiểu:
Có những việc, làm được rồi hãy nói.
Có những mục tiêu, đạt tới rồi hãy chia sẻ.
Có những ước mơ, nên bảo vệ khỏi tiếng ồn.
Nên nhớ:
Đừng vội dùng miệng để kể hết tương lai…
Khi đôi tay còn chưa làm đủ.
Bởi có những người nói cả đời… vẫn đứng yên một chỗ.
Nhưng có những người lặng lẽ vài năm… rồi bỏ xa tất cả.
Cuối cùng…
Cuộc đời khôn ngoan không cần ồn ào.
Giá trị thật sự không cần quảng cáo.
Người càng hiểu chuyện… càng bớt nói về bản thân.
Và khi họ cất tiếng bằng thành tựu…
Thì mọi lời giới thiệu đều trở nên thừa.
Bạn đang tích lũy trong im lặng…
Hay đang tiêu hao năng lượng chỉ để được người khác nhìn thấy?
`;

describe("splitScript keeps every character", () => {
  it("gives the input back when the slices are joined, whatever the text", () => {
    const samples = [SILENCE, "  Ba điều nên nhớ:\n1. Bình tĩnh trước một tin nhắn lạ.\n2. Kiểm tra kỹ đường dẫn.\n3. Không chia sẻ mật khẩu.  ", "một", "Câu một. Câu hai!\n\n\nCâu ba…   ", "\t\n  Lời đọc có tab\tvà   nhiều   khoảng trắng.\n"];
    for (const sample of samples) {
      const slices = splitScript(sample);
      expect(slices.join("")).toBe(sample);
      expect(slices.every((slice) => slice.trim().length > 0)).toBe(true);
    }
  });

  it("holds for random text made of words, punctuation, quotes and line breaks", () => {
    let seed = 12345;
    const random = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const pieces = ["người", "của", "và", "nhưng", "Một", "đi", "—", "“Xin", "chào.”", "5.", "A.", "TP.HCM", "Ví", "dụ:", "thế…", "ừ,", "không?", "ạ!"];
    for (let round = 0; round < 60; round += 1) {
      const count = 1 + Math.floor(random() * 220);
      let text = "";
      for (let i = 0; i < count; i += 1) text += pieces[Math.floor(random() * pieces.length)]! + (random() < 0.12 ? "\n" : random() < 0.02 ? "\n\n" : " ");
      if (!text.trim()) continue;
      const slices = splitScript(text);
      expect(slices.join("")).toBe(text);
      expect(slices.every((slice) => slice.trim().length > 0 && slice.length <= 1900)).toBe(true);
    }
  });

  it("is quick on a script of the longest length that still fits a short video", () => {
    const long = "Đây là một câu khá dài, có dấu phẩy ở giữa, và còn nhiều ý nữa cần được kể lại cho thật rõ ràng. ".repeat(200);
    const started = Date.now();
    const slices = splitScript(long);
    expect(Date.now() - started).toBeLessThan(2000);
    expect(slices.join("")).toBe(long);
    expect(slices.length).toBeLessThanOrEqual(250);
  });

  it("rejects an empty text and a word too long for a scene", () => {
    expect(() => splitScript(" \n\t ")).toThrow();
    expect(() => splitScript("A".repeat(2001))).toThrow(/từ quá dài/);
  });
});

describe("splitScript chooses where a scene ends", () => {
  const slices = splitScript(SILENCE).map((slice) => slice.trim());

  it("gives about 17 words a scene, never a fragment and never a very long one", () => {
    const total = words(SILENCE);
    expect(slices.length).toBeGreaterThanOrEqual(Math.floor(total / 22));
    expect(slices.length).toBeLessThanOrEqual(Math.ceil(total / 12));
    for (const slice of slices) {
      expect(words(slice)).toBeGreaterThanOrEqual(9);
      expect(words(slice)).toBeLessThanOrEqual(28);
    }
  });

  it("ends scenes where the author ended a line, never in the middle of one", () => {
    const lineEnds = new Set(SILENCE.split("\n").map((line) => line.trim()).filter(Boolean));
    for (const slice of slices) {
      const last = slice.split("\n").pop()!.trim();
      expect(lineEnds.has(last), `"${last}" is not the end of one of the author's lines`).toBe(true);
    }
  });

  it("keeps the title line as its own scene and gathers short lines into one scene", () => {
    expect(slices[0]).toBe("CÓ NHỮNG NGƯỜI… CÀNG IM LẶNG, VẬN CÀNG LÊN.");
    expect(slices.find((slice) => slice.startsWith("Có những người chọn cách rất khác"))).toContain("Họ không ồn ào kể về dự định.");
  });

  it("keeps an introduction ending in a colon with what it introduces, and a lead-in with the sentence it leads", () => {
    for (const intro of ["Thế nên, người càng từng trải càng hiểu:", "Nên nhớ:"]) {
      const slice = slices.find((item) => item.includes(intro))!;
      expect(slice.trimEnd().endsWith(intro), `${intro} must not close a scene`).toBe(false);
    }
    expect(slices.some((slice) => slice.trimEnd().endsWith("Cuối cùng…"))).toBe(false);
    // a sentence that goes on after "…" at the end of a line ("Và khi họ cất tiếng bằng thành tựu…" / "Thì mọi lời…")
    const together = slices.find((slice) => slice.includes("Và khi họ cất tiếng bằng thành tựu…"))!;
    expect(together).toContain("Thì mọi lời giới thiệu đều trở nên thừa.");
    expect(slices.find((slice) => slice.includes("Bạn đang tích lũy trong im lặng…"))).toContain("Hay đang tiêu hao năng lượng");
  });
});

describe("splitScript cuts a long sentence where a thought ends", () => {
  it("cuts a sentence with no punctuation in front of a conjunction, not after a fixed number of words", () => {
    const text = "Có một người nông dân nghèo sống ở vùng quê hẻo lánh mỗi ngày anh phải đi bộ hai tiếng đồng hồ để ra đồng làm việc từ sáng sớm cho đến tối mịt mà vẫn không đủ ăn nên anh quyết định lên thành phố tìm việc làm khác để nuôi gia đình";
    const slices = splitScript(text).map((slice) => slice.trim());
    expect(slices.length).toBeGreaterThanOrEqual(2);
    for (const slice of slices.slice(1)) expect(slice.split(" ")[0]).toMatch(/^(để|mà|nên|và|nhưng|còn|rồi)$/u);
    for (const slice of slices) expect(slice.split(" ").pop()).not.toMatch(/^(của|và|là|thì|mà|những|các|một|cho|với|ở|trong|từ|đến)$/u);
  });

  it("cuts a long sentence with commas at a comma, and does not leave a lead-in word alone", () => {
    const text = "Thế nhưng, tính tình của họ lại rất khác nhau: người anh thì lười biếng, ham chơi, mọi việc nặng nhọc đều đổ lên vai người em hiền lành và siêng năng, nên người em luôn mệt mỏi.";
    const slices = splitScript(text).map((slice) => slice.trim());
    expect(slices.length).toBeGreaterThanOrEqual(2);
    expect(slices[0]).not.toMatch(/^Thế nhưng,$/u);
    expect(slices.join(" ")).toBe(text);
    expect(slices.slice(1).every((slice) => !/^(?:nhưng|mà|còn|và|nên),?\b/iu.test(slice))).toBe(true);
  });

  it("leaves a sentence of a normal length whole", () => {
    expect(splitScript("Người em mừng rỡ, hy vọng bán khế đổi lấy ít gạo.")).toHaveLength(1);
    expect(splitScript("Việc nói quá nhiều dễ làm loãng chí hướng của mình và phô trương sớm dễ tiêu hao hết năng lượng quý giá chỉ trong thoáng chốc.")).toHaveLength(1);
    // A comma in a normal-length sentence continues the same spoken beat.
    expect(splitScript("Việc nói quá nhiều dễ làm loãng chí hướng của mình, còn phô trương sớm thì dễ tiêu hao hết năng lượng quý giá chỉ trong thoáng chốc.")).toHaveLength(1);
  });

  it("does not split a continuation after a comma into a new scene", () => {
    const text = "Một câu chuyện dài cần giữ nguyên mạch ý trong phần đầu, nhưng sau đó vẫn phải chia thành một nhịp mới vì có quá nhiều thông tin nối tiếp nhau khiến người xem khó theo dõi và hình minh họa bị giữ quá lâu trên màn hình điện thoại.";
    const slices = splitScript(text).map((slice) => slice.trim());
    expect(slices.join(" ")).toBe(text);
    expect(slices[0]).not.toMatch(/,$/u);
  });
});

describe("splitScript keeps what belongs together", () => {
  it("keeps a list number with its item", () => {
    const text = "Năm thói quen giúp bạn khỏe hơn mỗi ngày. 1. Ngủ đủ tám tiếng mỗi đêm để cơ thể hồi phục. 2. Uống đủ hai lít nước, chia đều trong ngày. 3. Đi bộ ba mươi phút sau bữa tối. 4. Hạn chế đường và đồ chiên. 5. Dành mười phút thiền mỗi sáng. Hãy bắt đầu từ thói quen dễ nhất.";
    const slices = splitScript(text).map((slice) => slice.trim());
    for (const slice of slices) expect(slice).not.toMatch(/(^|\s)\d\.$/u);
  });

  it("keeps a quotation with the words that say who speaks, and a speaker's introduction with the quotation", () => {
    const text = "Bà cụ hỏi: \"Con đi đâu mà vội thế?\" Cậu bé đáp: \"Con đi tìm cha ạ.\" Bà cụ cười hiền: \"Vậy hãy mang theo ít cơm này, đường còn xa lắm.\" Cậu bé cúi đầu cảm ơn rồi lên đường.";
    for (const slice of splitScript(text)) expect(slice.trim()).not.toMatch(/:$/u);
    const tagged = "\"Con đi tìm cha ạ.\" cậu bé đáp khẽ, rồi cúi đầu chào bà cụ ở đầu làng và bước đi trên con đường đất đỏ dài hun hút phía trước.";
    expect(splitScript(tagged)[0]!.trim().startsWith("\"Con đi tìm cha ạ.\" cậu bé đáp")).toBe(true);
  });

  it("does not take an initial, a title or a number for the end of a sentence", () => {
    const text = "Năm 2024, TP.HCM đón 3.5 triệu lượt khách. Ông A. Nguyễn nói rằng đây là con số kỷ lục trong mười năm qua và sẽ còn tăng nữa.";
    const joined = splitScript(text).map((slice) => slice.trim());
    expect(joined.some((slice) => slice.endsWith("Ông A."))).toBe(false);
    expect(joined.some((slice) => slice.endsWith("TS.") || slice.endsWith("TP."))).toBe(false);
  });
});

describe("looksLikeFinishedScript", () => {
  it("recognises a script written line by line", () => {
    expect(looksLikeFinishedScript(SILENCE)).toBe(true);
    expect(looksLikeFinishedScript(SILENCE.split("\n").slice(0, 8).join("\n"))).toBe(false); // a few lines: not enough to call it a script
  });

  it("leaves a topic, a block of prose and a loose list of points to the model", () => {
    expect(looksLikeFinishedScript("Vì sao cần xác minh tin nhắn chuyển tiền trước khi bấm chuyển?")).toBe(false);
    const prose = "Ngày xửa ngày xưa, trong một ngôi làng nhỏ, có hai anh em sống nương tựa vào nhau. ".repeat(20);
    expect(looksLikeFinishedScript(prose)).toBe(false);
    const paragraphs = Array.from({ length: 10 }, () => "Một đoạn văn dài gồm nhiều câu, kể về chuyện hai anh em và cây khế trong vườn nhà, rất dài và đủ ý. ".repeat(4)).join("\n");
    expect(looksLikeFinishedScript(paragraphs)).toBe(false);
    expect(looksLikeFinishedScript(Array.from({ length: 9 }, (_, i) => `ý ${i} ngắn gọn thôi`).join("\n"))).toBe(false);
  });
});

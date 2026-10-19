"""Regression checks for local speech captions without an ASR dependency.

Run with: python3 -m unittest discover -s local-tools -p 'test_*.py'
The synthesis process is mocked; WAV sample counts remain real so the timing
assertions catch character-based or estimated-duration captions.
"""

import base64
import importlib.util
import io
import os
import json
import re
import subprocess
import unittest
import unittest.mock
import wave
from pathlib import Path
from unittest.mock import patch


import contextlib
import tempfile


@contextlib.contextmanager
def tempfile_dir():
    with tempfile.TemporaryDirectory() as directory:
        yield directory


def load_media_server():
    location = Path(__file__).with_name("media_server.py")
    spec = importlib.util.spec_from_file_location("studio_media_server", location)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def spoken_text(value):
    """Whitespace is a separator; accents, numbers and punctuation are content."""
    return re.sub(r"\s+", " ", value).strip()


class FakeSpeechProcesses:
    def __init__(self, sample_counts=None):
        self.sample_counts = sample_counts or [11025, 33075, 16537, 4410]
        self.calls = []
        self.synthesized = []
        self.rate = 22050
        self.total_samples = 0

    def __call__(self, command, **kwargs):
        command = [str(item) for item in command]
        executable = Path(command[0]).name
        self.calls.append(command)
        if executable == "ffmpeg" and "-filter:a" in command:  # pace time-stretch of a phrase already counted
            with wave.open(command[-1], "wb") as audio:
                audio.setnchannels(1)
                audio.setsampwidth(2)
                audio.setframerate(self.rate)
                audio.writeframes(b"\x80\x01" * self.synthesized[-1][1])
            return subprocess.CompletedProcess(command, 0)
        if executable == "ffmpeg":
            count = self.sample_counts[len(self.synthesized) % len(self.sample_counts)]
            self.synthesized.append(("", count))
            self.total_samples += count
            with wave.open(command[-1], "wb") as audio:
                audio.setnchannels(1)
                audio.setsampwidth(2)
                audio.setframerate(self.rate)
                audio.writeframes(b"\x80\x01" * count)
            return subprocess.CompletedProcess(command, 0)
        if executable == "ffprobe":
            seconds = self.total_samples / self.rate
            stdout = str(seconds)
            if "json" in command:
                stdout = '{"format":{"duration":"%s"}}' % seconds
            return subprocess.CompletedProcess(command, 0, stdout=stdout, stderr="")
        raise AssertionError(f"Unexpected process in aligned TTS: {executable}")


class LocalSpeechCaptionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.media = load_media_server()
        # The synthesis processes are mocked; tests must not depend on ffmpeg being installed (CI runners).
        cls.media.find_binary = lambda name, env_var: f"/usr/bin/{name}"
        cls.media.listener_pid = lambda port: None  # never inspect or restart the real model servers from tests
        cls.media.TTS_ENGINES = ["vieneu"]  # deterministic: never reach for local network services in tests
        cls.media.TTS_CONCURRENCY = 1  # keep mocked subprocess ordering deterministic

    def test_phrase_split_preserves_original_unicode_and_every_character(self):
        script = (
            "  Một ngày ở Đà Nẵng, tôi gặp Nguyễn Ánh.\n"
            "Đầu tiên: giữ bình tĩnh! Thứ hai: kiểm tra 2 lần.\n"
            "Cuối cùng, đừng chia sẻ mật khẩu — dù ai yêu cầu.  "
        )
        phrases = self.media.split_speech_phrases(script)
        self.assertGreater(len(phrases), 1)
        self.assertEqual("".join(phrases), script)
        self.assertTrue(all(phrase.strip() for phrase in phrases))

    def test_still_video_fallback_has_bounded_ken_burns_motion(self):
        with patch.object(self.media, "require_ffmpeg", return_value="ffmpeg"), \
             patch.object(self.media.subprocess, "run") as process, \
             patch.object(self.media.Path, "read_bytes", return_value=b"MP4"):
            result = self.media.still_video_fallback(base64.b64encode(b"PNG").decode(), "9:16")
        self.assertEqual(result, b"MP4")
        command = [str(item) for item in process.call_args.args[0]]
        vf = command[command.index("-vf") + 1]
        self.assertIn("zoompan", vf)
        self.assertIn("s=720x1280", vf)
        self.assertIn("fps=24", vf)

    def test_quality_without_explicit_model_prefers_comfyui_base_only_when_ready(self):
        with patch.object(self.media, "comfyui_memory_safe", return_value=True):
            self.assertEqual(
                self.media.choose_image_model(None, "quality", comfy_ready=True),
                self.media.COMFYUI_IMAGE_MODEL,
            )
        with patch.object(self.media, "comfyui_memory_safe", return_value=False):
            self.assertIsNone(self.media.choose_image_model(None, "quality", comfy_ready=True))
        self.assertIsNone(self.media.choose_image_model(None, "quality", comfy_ready=False))
        self.assertIsNone(self.media.choose_image_model(None, "balanced", comfy_ready=True))
        self.assertEqual(
            self.media.choose_image_model("sdxl-turbo", "quality", comfy_ready=True),
            "sdxl-turbo",
        )

    def test_ltx_timeout_returns_to_still_fallback(self):
        with patch.object(self.media, "ltx_state", return_value=("ready", "ok")), \
             patch.object(self.media.urllib.request, "urlopen", side_effect=TimeoutError), \
             patch.object(self.media, "still_video_fallback", return_value=b"fallback") as fallback:
            result = self.media.local_video(base64.b64encode(b"PNG").decode(), "gentle movement", model="ltxv-2b-0.9.8-distilled")
        self.assertEqual(result, b"fallback")
        fallback.assert_called_once()

    def test_ltx_parks_idle_competing_model_services_before_inference(self):
        with patch.object(self.media, "ltx_state", return_value=("ready", "ok")), \
             patch.object(self.media, "video_resources_available", return_value=(True, "")), \
             patch.object(self.media, "release_turbo_model") as turbo, \
             patch.object(self.media, "release_comfy_model") as comfy, \
             patch.object(self.media.SLEEPER, "park", return_value=["image", "vieneu"]) as park, \
             patch.object(self.media.urllib.request, "urlopen", return_value=io.BytesIO(b"\x00\x00\x00\x18ftypmp42")):
            result = self.media.local_video(base64.b64encode(b"PNG").decode(), "gentle movement", model="ltxv-2b-0.9.8-distilled")
        self.assertTrue(result.startswith(b"\x00\x00\x00"))
        turbo.assert_called_once()
        comfy.assert_called_once()
        park.assert_called_once_with(("image", "vieneu", "comfyui"), keep=("ltx",))

    def test_degraded_ltx_does_not_wait_for_wake_timeout(self):
        with patch.object(self.media, "ltx_state", return_value=("offline", "LTX needs more RAM")), \
             patch.object(self.media.SLEEPER, "asleep", return_value=False):
            self.assertEqual(self.media.services_for("/video", b"{}"), ["ltx"])

    def test_long_sentence_stays_inside_subtitle_schema_limit(self):
        script = " ".join(["giữ nguyên từng dấu tiếng Việt và thứ tự lời đọc"] * 14) + "."
        phrases = self.media.split_speech_phrases(script)
        self.assertGreater(len(phrases), 1)
        self.assertEqual("".join(phrases), script)
        self.assertTrue(all(len(phrase.strip()) <= 240 for phrase in phrases))

    def test_a_long_sentence_is_split_at_a_clause_never_leaving_a_lone_word(self):
        sentence = "Khi bước ra ngoài, ánh sáng buổi sớm giúp cơ thể tỉnh táo hơn cả một ly cà phê.\n"
        phrases = self.media.split_speech_phrases(sentence)
        self.assertEqual("".join(phrases), sentence)
        self.assertTrue(all(len(p.split()) >= 4 for p in phrases), phrases)
        self.assertTrue(phrases[-1].rstrip().endswith("cà phê."))
        long = "Đi bộ đều đặn mỗi ngày giúp tim khỏe hơn, đầu óc nhẹ nhõm hơn, giấc ngủ sâu hơn và tinh thần lúc nào cũng vui vẻ, yêu đời."
        parts = self.media.split_speech_phrases(long)
        self.assertGreater(len(parts), 1)
        self.assertTrue(all(p.rstrip().endswith((",", ".")) for p in parts), parts)  # cut at commas

    def test_sentence_boundary_is_kept_for_sentence_level_prosody(self):
        script = "Tôi mệt. Hãy nghỉ một chút. Ngày mai sẽ tốt hơn."
        phrases = self.media.split_speech_phrases(script)
        self.assertEqual(phrases, ["Tôi mệt. ", "Hãy nghỉ một chút. ", "Ngày mai sẽ tốt hơn."])

    def test_emotion_markup_preserves_the_original_script(self):
        text = "Nếu hôm nay bạn thấy mệt, hãy cho phép mình nghỉ một chút."
        marked = self.media.expressive_text(text, "tam-su")
        self.assertTrue(marked.startswith("[thở dài] "))
        self.assertEqual(marked.removeprefix("[thở dài] "), text)
        self.assertLess(self.media.emotion_profile(text, "tam-su")["speed"], 1)

    def test_timing_uses_actual_pcm_samples_and_original_phrase_text(self):
        script = "Bình tĩnh nhé. Kiểm tra địa chỉ liên kết thật kỹ. Không chia sẻ mật khẩu."
        processes = FakeSpeechProcesses()
        with patch.object(self.media, "service_up", return_value=True), patch.object(self.media, "_http_wav", return_value=b"RIFF-fake-network-audio"), patch.object(self.media.subprocess, "run", side_effect=processes):
            result = self.media.tts_aligned(script, "Linh")
        cues = result["cues"]
        self.assertEqual(len(cues), len(processes.synthesized))
        self.assertGreater(len(cues), 1)
        self.assertEqual("".join(cue["text"] for cue in cues), script)
        self.assertEqual(spoken_text("".join(cue["text"] for cue in cues)), script)
        elapsed_samples = 0
        for index, (cue, (phrase, samples)) in enumerate(zip(cues, processes.synthesized)):
            last = index == len(cues) - 1
            # a pause follows every phrase (the fake audio has no silence of its own): between sentences and, shorter, at the end
            pause = int(self.media.pause_seconds(cue["text"], "Linh") * (self.media.SCENE_END_PAUSE if last else 1.0) * processes.rate)
            self.assertEqual(cue["startMs"], round(elapsed_samples * 1000 / processes.rate))
            elapsed_samples += samples + pause
            self.assertEqual(cue["endMs"], round(elapsed_samples * 1000 / processes.rate))
            self.assertGreater(cue["endMs"], cue["startMs"])
        self.assertEqual(result["durationMs"], round(elapsed_samples * 1000 / processes.rate))
        with wave.open(io.BytesIO(base64.b64decode(result["audioBase64"])), "rb") as audio:
            self.assertEqual(audio.getnframes(), elapsed_samples)
            self.assertEqual(audio.getframerate(), processes.rate)
            self.assertEqual(audio.getnchannels(), 1)
            self.assertEqual(audio.getsampwidth(), 2)
        # Unequal audio durations prove that the cues do not use text length (the speech is 0.5 s and 1.5 s; the rest is pause).
        pauses = [int(self.media.pause_seconds(cue["text"], "Linh") * processes.rate) for cue in cues]
        self.assertEqual(cues[0]["endMs"] - cues[0]["startMs"], round((11025 + pauses[0]) * 1000 / processes.rate))
        self.assertEqual(cues[1]["endMs"] - cues[1]["startMs"], round((33075 + pauses[1]) * 1000 / processes.rate))

    def test_empty_pcm_from_a_successful_process_is_rejected(self):
        processes = FakeSpeechProcesses([0])
        with patch.object(self.media, "service_up", return_value=True), patch.object(self.media, "_http_wav", return_value=b"RIFF-fake-network-audio"), patch.object(self.media.subprocess, "run", side_effect=processes):
            with self.assertRaises((RuntimeError, ValueError)):
                self.media.tts_aligned("Không được báo thành công với audio rỗng.", "Linh")

    def test_voice_preset_selects_vieneu_voice_and_speed_and_converts_to_pcm(self):
        sent = []

        def fake_http(url, payload):
            sent.append((url, payload))
            return b"RIFF-fake-network-audio"

        def fake_run(command, **kwargs):
            command = [str(item) for item in command]
            self.assertEqual(Path(command[0]).name, "ffmpeg")
            with wave.open(command[-1], "wb") as audio:
                audio.setnchannels(1)
                audio.setsampwidth(2)
                audio.setframerate(22050)
                audio.writeframes(b"\x80\x01" * 11025)
            return subprocess.CompletedProcess(command, 0)

        with patch.object(self.media, "TTS_ENGINES", ["vieneu"]), \
             patch.object(self.media, "service_up", return_value=True), \
             patch.object(self.media, "_http_wav", side_effect=fake_http), \
             patch.object(self.media.subprocess, "run", side_effect=fake_run):
            result = self.media.tts_aligned("Trăng treo đầu núi.", "co-trang")
        self.assertEqual(sent[0][1]["voice"], "Thiền Tâm Đức")
        self.assertAlmostEqual(sent[0][1]["speed"], self.media.pace_tempo("co-trang", "vieneu"))
        # half a second of speech, then the pause a narration ends with (a sentence pause of this voice, a little shorter at the end)
        ending = self.media.pause_seconds("Trăng treo đầu núi.", "co-trang") * self.media.SCENE_END_PAUSE
        self.assertEqual(result["durationMs"], round((11025 + int(ending * 22050)) * 1000 / 22050))

    def test_vieneu_receives_sentence_emotion_but_subtitle_keeps_original_text(self):
        sent = []

        def fake_http(url, payload):
            sent.append((url, payload))
            return b"RIFF-fake-network-audio"

        def fake_run(command, **kwargs):
            command = [str(item) for item in command]
            with wave.open(command[-1], "wb") as audio:
                audio.setnchannels(1)
                audio.setsampwidth(2)
                audio.setframerate(22050)
                audio.writeframes(b"\x80\x01" * 11025)
            return subprocess.CompletedProcess(command, 0)

        script = "Nếu hôm nay bạn thấy mệt, hãy cho phép mình nghỉ một chút. Ngày mai sẽ tốt hơn."
        with patch.object(self.media, "TTS_ENGINES", ["vieneu"]), \
             patch.object(self.media, "service_up", return_value=True), \
             patch.object(self.media, "_http_wav", side_effect=fake_http), \
             patch.object(self.media.subprocess, "run", side_effect=fake_run):
            result = self.media.tts_aligned(script, "tam-su")
        self.assertIn("[thở dài]", sent[0][1]["input"])
        self.assertEqual("".join(cue["text"] for cue in result["cues"]), script)
        self.assertAlmostEqual(sent[0][1]["speed"], self.media.pace_tempo("tam-su", "vieneu", 1.0, 0.94))  # the sigh is read a little slower

    def test_every_vieneu_preset_uses_a_supported_voice_name(self):
        supported = {
            "Adam", "Adam bựa", "Hải Đăng", "Kim Thanh", "Mai Anh", "Minh Triết", "Minh Đức",
            "Mỹ Duyên", "Ngọc Huyền", "Ngọc Linh", "Ngọc Trân", "Phạm Tuyên", "Quang Sơn",
            "Quốc Tuấn", "Quỳnh Anh", "Thanh Bình", "Thiền Tâm Đức", "Thiện Minh", "Thái Sơn",
            "Thùy Dung", "Thục Đoan", "Trúc Ly", "Xuân Vĩnh", "Đoan Trang", "Đức Trí",
        }
        self.assertTrue(all(voice in supported for voice, _mood, _native in self.media.VOICE_PRESETS.values()))

    def test_unknown_engine_is_rejected_instead_of_silently_falling_back(self):
        with patch.object(self.media.subprocess, "run") as process:
            with self.assertRaises(ValueError):
                self.media.tts_aligned("Xin chào các bạn.", "Linh", "khong-co")
            process.assert_not_called()

    def test_image_prompt_drops_vietnamese_suffix_and_diacritics(self):
        prompt = "Young woman writing in a notebook, warm light. Không chữ, không logo, không watermark."
        self.assertEqual(self.media.clean_image_prompt(prompt), "Young woman writing in a notebook, warm light")
        self.assertEqual(self.media.clean_image_prompt("Đôi bàn tay buông bỏ, ánh sáng ấm"), "Doi ban tay buong bo, anh sang am")
        with self.assertRaises(ValueError):
            self.media.clean_image_prompt("Không chữ, không logo, không watermark.")

    def test_image_prompt_drops_words_that_make_the_model_paint_gibberish_text(self):
        prompt = "A man walks past a closed shop window with a neon sign, colorful posters on the walls"
        cleaned = self.media.clean_image_prompt(prompt).lower()
        for word in ("sign", "neon", "poster", "closed"):
            self.assertNotIn(word, cleaned)
        self.assertIn("shop window", cleaned)

    def test_image_quality_guard_is_enabled_for_human_prompts(self):
        with patch.object(self.media, "image_server_state", return_value="down"), \
             patch.object(self.media, "IMAGE_TIMEOUT_S", 0), \
             patch.object(self.media.subprocess, "run") as process:
            process.return_value = subprocess.CompletedProcess([], 0)
            with patch.object(self.media.Path, "read_bytes", return_value=b"PNG"):
                with patch.object(self.media.tempfile, "TemporaryDirectory") as temp:
                    temp.return_value.__enter__.return_value = Path("/tmp/studio-image-test")
                    temp.return_value.__exit__.return_value = False
                    self.media.local_image("Young woman holding a book", "9:16")
            command = [str(item) for item in process.call_args.args[0]]
            self.assertIn("anatomically correct hands", command[2])

    def test_generic_worker_prompt_suffix_does_not_turn_object_scene_into_a_person(self):
        payload = self._turbo_payload(
            "Two red running shoes on a blue wooden floor, empty room, no person, no face. "
            "Keep the same appearance and wardrobe when applicable. "
            "Do not add unrelated subjects, writing, brand marks or watermarks."
        )
        self.assertNotIn("one person only", payload["prompt"])
        self.assertNotIn("detailed face", payload["prompt"])

    def test_human_subject_detector_ignores_negative_safety_words(self):
        self.assertFalse(self.media.has_human_subject("two shoes, no person, no face, no generic portrait"))
        self.assertTrue(self.media.has_human_subject("portrait close-up of a young woman, no text"))

    def test_every_visual_preset_has_its_own_leading_style_words(self):
        prompts = {}
        for style in ("photo", "historical", "ink", "watercolor", "paper-cut", "flat"):
            with patch.object(self.media, "image_server_state", return_value="ready"), \
                 patch.object(self.media.urllib.request, "urlopen") as request:
                request.return_value.__enter__.return_value.read.return_value = b"PNG"
                self.media.local_image("Young woman sitting on a park bench at dusk", "9:16", style=style)
            image_request = next(call.args[0] for call in reversed(request.call_args_list) if hasattr(call.args[0], "data"))
            prompts[style] = json.loads(image_request.data)["prompt"]
        self.assertEqual(len(set(prompts.values())), 6)
        for style in ("historical", "ink", "watercolor", "paper-cut"):
            self.assertTrue(prompts[style].startswith(self.media.IMAGE_STYLES[style]))
        # Drawn looks must not be pulled back to photographs by skin/anatomy wording.
        for style in ("ink", "watercolor", "paper-cut", "flat"):
            self.assertNotIn("natural skin", prompts[style])
        self.assertIn("natural skin", prompts["historical"])

    def test_unknown_image_style_is_rejected(self):
        with self.assertRaises(ValueError):
            self.media.local_image("A quiet street", "9:16", style="oil-painting")

    def test_sdxl_base_and_turbo_take_turns_with_memory(self):
        calls = []

        def fake_urlopen(request, timeout=None):
            url = request if isinstance(request, str) else request.full_url
            calls.append(url)
            response = unittest.mock.MagicMock()
            response.__enter__.return_value.read.return_value = b"PNG"
            response.__enter__.return_value.status = 200
            return response

        with patch.object(self.media, "available_image_models", return_value={"sdxl-turbo": "t", self.media.COMFYUI_IMAGE_MODEL: "b"}), \
             patch.object(self.media, "comfyui_image", return_value=b"PNG") as comfy, \
             patch.object(self.media, "image_server_state", return_value="ready"), \
             patch.object(self.media.urllib.request, "urlopen", side_effect=fake_urlopen), \
             patch.object(self.media, "COMFYUI_FREE_AFTER_RENDER", False):
            self.media.local_image("A young woman sits on a bench", "9:16", model=self.media.COMFYUI_IMAGE_MODEL)
            self.assertTrue(any(url.endswith("/unload") for url in calls))  # Turbo released for SDXL Base
            self.assertIn("crowd", comfy.call_args.args[1])  # real CFG: negative prompt keeps the cast small
            calls.clear()
            self.media.local_image("A young woman sits on a bench", "9:16", model="sdxl-turbo")
            self.assertTrue(any(url.endswith("/free") for url in calls))  # SDXL Base released for Turbo
            calls.clear()
            self.media.local_image("A quiet street at dusk", "9:16", model="sdxl-turbo")
            self.assertFalse(any(url.endswith("/free") for url in calls))  # only once after a Base run

    def test_sdxl_base_releases_comfyui_after_each_render(self):
        with patch.object(self.media, "available_image_models", return_value={self.media.COMFYUI_IMAGE_MODEL: "b"}), \
             patch.object(self.media, "comfyui_image", return_value=b"PNG"), \
             patch.object(self.media, "release_turbo_model"), \
             patch.object(self.media, "release_comfy_model") as release:
            self.media.local_image("A young woman sits on a bench", "9:16", model=self.media.COMFYUI_IMAGE_MODEL)
        release.assert_called_once_with()

    def test_trims_only_oversized_service_logs_to_their_recent_tail(self):
        import tempfile
        with tempfile.TemporaryDirectory() as folder:
            big = Path(folder) / "media.autostart.err"
            big.write_bytes(b"old line\n" * 2000 + b"recent line\n" * 50)
            small = Path(folder) / "image.autostart.log"
            small.write_bytes(b"fine\n")
            trimmed = self.media.trim_service_logs(folder, max_bytes=4096, keep_bytes=1024)
            self.assertEqual(trimmed, ["media.autostart.err"])
            self.assertLessEqual(big.stat().st_size, 1024 + 20)
            self.assertTrue(big.read_bytes().rstrip().endswith(b"recent line"))
            self.assertEqual(small.read_bytes(), b"fine\n")

    def _turbo_payload(self, prompt, **options):
        with patch.object(self.media, "image_server_state", return_value="ready"), \
             patch.object(self.media, "recycle_if_bloated", return_value=False), \
             patch.object(self.media.urllib.request, "urlopen") as request:
            request.return_value.__enter__.return_value.read.return_value = b"PNG"
            self.media.local_image(prompt, "9:16", **options)
        return json.loads(request.call_args.args[0].data)

    def test_image_quality_guard_adds_face_constraints(self):
        payload = self._turbo_payload("Portrait close-up of a young woman", preset="balanced")
        self.assertIn("symmetrical natural facial features", payload["prompt"])
        self.assertIn("fully inside the frame", payload["prompt"])

    def test_turbo_runs_without_guidance_and_with_few_steps_unless_quality_is_chosen(self):
        # A realistic person: 6 steps, no negative prompt (CFG would double the time for no visible gain).
        person = self._turbo_payload("Portrait close-up of a young woman", preset="balanced")
        self.assertEqual((person["steps"], person["negativePrompt"]), (6, ""))
        # A drawn look keeps Turbo's native 4 steps.
        drawn = self._turbo_payload("A young woman reading by a window", preset="balanced", style="flat")
        self.assertEqual((drawn["steps"], drawn["negativePrompt"]), (4, ""))
        paper = self._turbo_payload("A chibi boy in an ancient robe holding a cup", preset="balanced", style="flat")
        self.assertIn("writing", paper["negativePrompt"])
        # Choosing "quality" on the website buys the slower 8-step render with the anatomy negative.
        quality = self._turbo_payload("Portrait close-up of a young woman", preset="quality")
        self.assertEqual(quality["steps"], 8)
        self.assertIn("melted face", quality["negativePrompt"])

    def test_character_reference_is_forwarded_only_for_human_scenes(self):
        class ImageResponse:
            def __enter__(self):
                return self

            def __exit__(self, *args):
                return False

            def read(self):
                return b"PNG"

        with patch.object(self.media, "image_server_state", return_value="ready"), \
             patch.object(self.media.urllib.request, "urlopen", return_value=ImageResponse()) as request:
            self.media.local_image("Young woman reading a book", "9:16", reference_image_base64="aW1hZ2U=")
        image_request = next(call.args[0] for call in reversed(request.call_args_list) if hasattr(call.args[0], "data"))
        payload = json.loads(image_request.data)
        self.assertEqual(payload["referenceImage"], "aW1hZ2U=")

    def test_image_quality_guard_handles_vietnamese_human_prompts(self):
        with patch.object(self.media, "image_server_state", return_value="down"), \
             patch.object(self.media, "IMAGE_TIMEOUT_S", 0), \
             patch.object(self.media.subprocess, "run") as process:
            process.return_value = subprocess.CompletedProcess([], 0)
            with patch.object(self.media.Path, "read_bytes", return_value=b"PNG"):
                with patch.object(self.media.tempfile, "TemporaryDirectory") as temp:
                    temp.return_value.__enter__.return_value = Path("/tmp/studio-image-test")
                    temp.return_value.__exit__.return_value = False
                    self.media.local_image("Cô gái cầm sách", "9:16")
            command = [str(item) for item in process.call_args.args[0]]
            self.assertIn("anatomically correct hands", command[2])

    def test_non_human_scene_does_not_force_a_face(self):
        class ImageResponse:
            def __enter__(self):
                return self

            def __exit__(self, *args):
                return False

            def read(self):
                return b"PNG"

        with patch.object(self.media, "image_server_state", return_value="ready"), \
             patch.object(self.media.urllib.request, "urlopen", return_value=ImageResponse()) as request:
            self.media.local_image("An open notebook and smartphone on a wooden desk", "9:16")
        payload = json.loads(request.call_args.args[0].data)
        self.assertIn("no people", payload["prompt"])
        self.assertNotIn("detailed face", payload["prompt"])

    def test_turbo_pictures_are_drawn_at_the_size_it_was_trained_for_not_at_the_video_resolution(self):
        # At 576x1024 SDXL-Turbo drew a second man above the first (5 of 8 seeds), stretched bodies and extra limbs.
        ratios = {"9:16": 9 / 16, "1:1": 1.0, "16:9": 16 / 9, "16:10": 1.6}
        sent = []

        class ImageResponse:
            def __enter__(self):
                return self

            def __exit__(self, *args):
                return False

            def read(self):
                return b"PNG"

        def fake_urlopen(request, timeout=None):
            sent.append(json.loads(request.data))
            return ImageResponse()

        with patch.object(self.media, "image_server_state", return_value="ready"), \
             patch.object(self.media.urllib.request, "urlopen", side_effect=fake_urlopen):
            for aspect, ratio in ratios.items():
                self.media.local_image("A young woman sits on a bench", aspect, style="flat")
                width, height = sent[-1]["width"], sent[-1]["height"]
                self.assertEqual((width % 64, height % 64), (0, 0), aspect)  # the image server only takes multiples of 64
                self.assertLessEqual(width * height, 460_000, aspect)  # Turbo is distilled at 262k px
                self.assertLess(abs(width / height / ratio - 1), 0.036, aspect)  # the video crops at most 3.6% of the picture
        self.assertEqual(self.media.image_size("9:16"), (512, 896))

    def test_sdxl_base_keeps_its_larger_sizes(self):
        calls = []
        with patch.object(self.media, "available_image_models", return_value={"sdxl-turbo": "t", self.media.COMFYUI_IMAGE_MODEL: "b"}), \
             patch.object(self.media, "comfyui_image", side_effect=lambda *args: calls.append(args) or b"PNG"), \
             patch.object(self.media, "release_turbo_model"):
            self.media.local_image("A young woman sits on a bench", "9:16", model=self.media.COMFYUI_IMAGE_MODEL)
        self.assertEqual(calls[0][2:4], (704, 1216))
        # about a million pixels is what SDXL Base is trained at: 590k stacked two scenes in one picture, 856k did not
        ratios = {"9:16": 9 / 16, "1:1": 1.0, "16:9": 16 / 9, "16:10": 1.6}
        for aspect, ratio in ratios.items():
            width, height = self.media.image_size(aspect, self.media.COMFYUI_IMAGE_MODEL)
            self.assertEqual((width % 64, height % 64), (0, 0), aspect)
            self.assertTrue(700_000 <= width * height <= 1_050_000, aspect)
            self.assertLess(abs(width / height / ratio - 1), 0.036, aspect)

    def test_image_preset_forwards_quality_steps_to_warm_server(self):
        class ImageResponse:
            def __enter__(self):
                return self

            def __exit__(self, *args):
                return False

            def read(self):
                return b"PNG"

        with patch.object(self.media, "image_server_state", return_value="ready"), \
             patch.object(self.media.urllib.request, "urlopen", return_value=ImageResponse()) as request:
            self.assertEqual(self.media.local_image("Young woman holding a book", "9:16", preset="quality"), b"PNG")
        payload = json.loads(request.call_args.args[0].data)
        self.assertEqual(payload["preset"], "quality")
        self.assertEqual(payload["steps"], 8)

    def test_unknown_image_and_whisper_models_are_rejected(self):
        with self.assertRaises(ValueError):
            self.media.local_image("cảnh", "9:16", "model-la")
        with self.assertRaises(ValueError):
            self.media.transcribe(b"audio", "model-la")

    def test_missing_ffmpeg_gives_a_clear_error_instead_of_a_generic_failure(self):
        with patch.object(self.media, "find_binary", return_value=None):
            with self.assertRaisesRegex(RuntimeError, "Thiếu ffmpeg"):
                self.media.require_ffmpeg()

    def test_homebrew_tools_are_reachable_when_launched_with_a_minimal_path(self):
        # launchd / IDE agents start services with PATH=/usr/bin:/bin:/usr/sbin:/sbin
        with patch.dict(os.environ, {"PATH": "/usr/bin:/bin:/usr/sbin:/sbin"}):
            load_media_server()
            self.assertIn("/opt/homebrew/bin", os.environ["PATH"].split(os.pathsep))
            self.assertIn("/usr/local/bin", os.environ["PATH"].split(os.pathsep))

    def test_footprint_parser_understands_top_output(self):
        def fake_top(output):
            return subprocess.CompletedProcess(["top"], 0, stdout=f"MEM\n{output}\n", stderr="")
        for text, expected in (("7877M", 7877.0), ("11G", 11264.0), ("512K", 0.5), ("1228M+", 1228.0)):
            with patch.object(self.media.subprocess, "run", return_value=fake_top(text)):
                self.assertAlmostEqual(self.media.process_footprint_mb(123), expected, places=1)
        with patch.object(self.media.subprocess, "run", return_value=fake_top("n/a")):
            self.assertIsNone(self.media.process_footprint_mb(123))

    def test_bloated_supervised_service_is_restarted_but_a_lean_one_is_left_alone(self):
        calls = []

        def fake_run(command, **kwargs):
            calls.append([str(item) for item in command])
            return subprocess.CompletedProcess(command, 0, stdout="", stderr="")

        pids = iter([100, 200, 200, 200])
        with patch.object(self.media, "listener_pid", side_effect=lambda port: next(pids)), \
             patch.object(self.media, "process_footprint_mb", return_value=7877.0), \
             patch.object(self.media, "service_up", return_value=True), \
             patch.object(self.media.time, "sleep"), \
             patch.object(self.media.subprocess, "run", side_effect=fake_run):
            self.assertTrue(self.media.recycle_if_bloated("vieneu", self.media.VIENEU_URL))
        self.assertTrue(any(c[:3] == ["launchctl", "kickstart", "-k"] and c[3].endswith("com.ai-short-video.vieneu") for c in calls))

        with patch.object(self.media, "listener_pid", return_value=100), \
             patch.object(self.media, "process_footprint_mb", return_value=600.0), \
             patch.object(self.media.subprocess, "run") as process:
            self.assertFalse(self.media.recycle_if_bloated("vieneu", self.media.VIENEU_URL))
            process.assert_not_called()

    def test_unsupervised_bloated_service_is_never_killed(self):
        with patch.object(self.media, "listener_pid", return_value=100), \
             patch.object(self.media, "process_footprint_mb", return_value=9999.0), \
             patch.object(self.media.subprocess, "run",
                          return_value=subprocess.CompletedProcess(["launchctl"], 113, stdout="", stderr="")):
            self.assertFalse(self.media.recycle_if_bloated("vieneu", self.media.VIENEU_URL))

    def test_pace_is_applied_as_time_stretch_because_the_engine_ignores_speed(self):
        filters = []

        def fake_http(url, payload):
            return b"RIFF-fake"

        def fake_run(command, **kwargs):
            command = [str(item) for item in command]
            if "-filter:a" in command:
                filters.append(command[command.index("-filter:a") + 1])
            with wave.open(command[-1], "wb") as audio:
                audio.setnchannels(1)
                audio.setsampwidth(2)
                audio.setframerate(22050)
                audio.writeframes(b"\x80\x01" * 11025)
            return subprocess.CompletedProcess(command, 0)

        with patch.object(self.media, "_http_wav", side_effect=fake_http), \
             patch.object(self.media.subprocess, "run", side_effect=fake_run), \
             tempfile_dir() as workdir:
            self.media.synth_phrase("Xin chào.", workdir, 0, "doc-truyen", "vieneu", 1.3)
        self.assertTrue(any(f.startswith("atempo=1.3") or f.startswith("atempo=1.2") or f.startswith("atempo=1.4") for f in filters), filters)

    # --- natural delivery: pauses, lead-ins, levels, cues ---------------------------------------------------------------

    @staticmethod
    def tone(ms, amplitude=8000, rate=22050):
        import array as arr
        return arr.array("h", (amplitude if (i // 40) % 2 else -amplitude for i in range(int(rate * ms / 1000)))).tobytes()

    @staticmethod
    def silence(ms, rate=22050):
        return b"\x00\x00" * int(rate * ms / 1000)

    def test_the_pause_after_a_phrase_follows_its_punctuation_and_the_voice(self):
        pause, kind = self.media.pause_seconds, self.media.pause_kind
        self.assertEqual([kind(text) for text in ["Xong.", "Thật sao?", "Đợi đã…", "Một là,", "Ý này:", "đi qua rừng", "Hết.\n\n", "Nói rằng \"đi đi.\""]],
                         ["sentence", "sentence", "ellipsis", "minor", "minor", "split", "para", "sentence"])
        self.assertAlmostEqual(pause("Xong.", "thuyet-minh"), 0.50)  # what VieNeu's own join puts between sentences
        self.assertAlmostEqual(pause("Xong.\n\n", "thuyet-minh"), 0.70)  # a paragraph
        self.assertAlmostEqual(pause("Một là,", "thuyet-minh"), 0.30)
        self.assertGreater(pause("Đợi đã…", "thuyet-minh"), pause("Xong.", "thuyet-minh"))
        self.assertAlmostEqual(pause("Xong.\n", "thuyet-minh"), 0.60)  # a line the author ended on purpose is held a little
        self.assertGreater(pause("Xong.", "tam-su"), pause("Xong.", "thuyet-minh"))  # reflective voices linger
        self.assertLess(pause("Xong.", "nang-dong"), pause("Xong.", "thuyet-minh"))  # an ad does not
        self.assertLessEqual(pause("Xong.\n\n", "co-trang"), self.media.PAUSE_MAX_S)

    def test_silence_is_added_only_where_the_gap_falls_short(self):
        rate = 22050
        speech = self.tone(400) + self.silence(60)  # the phrase already ends with 60 ms of quiet
        padded = self.media.with_pause(speech, 0.5, next_lead_frames=int(0.1 * rate), rate=rate)
        self.assertAlmostEqual(self.media.edge_silence_frames(padded, rate)[1] / rate, 0.4, delta=0.02)  # 0.5 s wanted - 0.1 s next lead
        already = self.tone(400) + self.silence(600)
        self.assertEqual(self.media.with_pause(already, 0.5, 0, rate), already)  # enough of its own: untouched
        abrupt = self.tone(300)  # stops at full level: faded out before the silence so it does not click
        padded = self.media.with_pause(abrupt, 0.4, 0, rate)
        import array as arr
        samples = arr.array("h"); samples.frombytes(padded)
        self.assertLess(abs(samples[len(abrupt) // 2 - 1]), 1500)
        self.assertGreaterEqual(len(padded) // 2 - len(abrupt) // 2, int(0.39 * rate))

    def test_edges_and_levels_are_measured_on_the_real_samples(self):
        rate = 22050
        clip = self.silence(120) + self.tone(500) + self.silence(80)
        lead, tail = self.media.edge_silence_frames(clip, rate)
        self.assertAlmostEqual(lead / rate, 0.12, delta=0.015)
        self.assertAlmostEqual(tail / rate, 0.08, delta=0.015)
        self.assertEqual(self.media.edge_silence_frames(self.silence(100), rate), (int(0.1 * rate), 0))  # nothing but silence
        quiet, normal, loud = self.tone(500, 2500), self.tone(500, 8000), self.tone(500, 8000)
        loud = self.media.apply_gain_db(loud, 6)
        clips = [quiet, normal, self.tone(500, 8200), loud]
        before = [self.media.speech_level_db(pcm, rate) for pcm in clips]
        after = [self.media.speech_level_db(pcm, rate) for pcm in self.media.level_phrases(clips, rate)]
        self.assertGreater(max(before) - min(before), 15)  # it really was uneven
        # the outliers move towards the typical level by the allowed range, no further; the ones in line are left alone
        self.assertAlmostEqual(after[0] - before[0], self.media.LEVEL_RANGE_DB, delta=0.3)
        self.assertAlmostEqual(after[3] - before[3], -self.media.LEVEL_RANGE_DB, delta=0.3)
        self.assertAlmostEqual(after[1], before[1], delta=0.05)
        self.assertAlmostEqual(after[2], before[2], delta=0.05)
        original = before
        self.assertEqual(self.media.level_phrases([normal, quiet], rate), [normal, quiet])  # too few phrases to know what is typical

    def test_a_short_lead_in_is_read_together_with_the_sentence_it_leads(self):
        phrases = self.media.split_speech_phrases("Cuối cùng… Cuộc đời khôn ngoan không cần ồn ào.\nNên nhớ:\nĐừng vội kể hết tương lai khi đôi tay chưa làm đủ.\nHọ dùng kết quả.")
        self.assertEqual(len(phrases), 3, phrases)
        self.assertTrue(phrases[0].startswith("Cuối cùng… Cuộc đời"))
        self.assertTrue(phrases[1].startswith("Nên nhớ:\nĐừng vội"))
        self.assertEqual(phrases[2], "Họ dùng kết quả.")  # a short sentence of its own stays alone
        self.assertEqual("".join(phrases), "Cuối cùng… Cuộc đời khôn ngoan không cần ồn ào.\nNên nhớ:\nĐừng vội kể hết tương lai khi đôi tay chưa làm đủ.\nHọ dùng kết quả.")

    def test_a_theme_word_does_not_turn_every_line_into_a_sigh(self):
        for line in ["Có những người chọn cách rất khác: im lặng.", "Im lặng không phải yếu thế.", "Bạn đang tích lũy trong im lặng…", "Hãy nhớ điều này thật kỹ.",
                     "Đừng vội dùng miệng để kể hết tương lai.", "Mỗi người một hoàn cảnh, hay là không."]:
            for voice in ("tam-su", "triet-ly", "co-trang", "doc-truyen"):
                self.assertIsNone(self.media.emotion_profile(line, voice), (voice, line))
        # two different feelings' words in one sentence do earn the cue; one word alone does not
        self.assertEqual(self.media.emotion_profile("Hôm nay tôi thấy buồn và cô đơn.", "tam-su")["tag"], "[thở dài]")
        self.assertIsNone(self.media.emotion_profile("Hôm nay tôi thấy buồn.", "tam-su"))
        self.assertEqual(self.media.emotion_profile("Cảnh báo: điều này rất quan trọng.", "tin-tuc")["tag"], "[hắng giọng]")
        self.assertIsNone(self.media.emotion_profile("Hôm nay tôi thấy buồn và cô đơn. [cười]", "tam-su"))  # a cue typed by the author is left alone

    def test_a_narration_gets_at_most_one_cue_sound(self):
        sent = []

        def fake_http(url, payload):
            sent.append(payload["input"])
            return b"RIFF-fake-network-audio"

        def fake_run(command, **kwargs):
            command = [str(item) for item in command]
            with wave.open(command[-1], "wb") as audio:
                audio.setnchannels(1)
                audio.setsampwidth(2)
                audio.setframerate(22050)
                audio.writeframes(b"\x80\x01" * 11025)
            return subprocess.CompletedProcess(command, 0)

        script = "Hôm nay tôi thấy buồn và cô đơn. Tôi mệt, tôi đau, tôi muốn khóc. Ngày mai sẽ tốt hơn."
        with patch.object(self.media, "TTS_ENGINES", ["vieneu"]), patch.object(self.media, "service_up", return_value=True), \
             patch.object(self.media, "_http_wav", side_effect=fake_http), patch.object(self.media.subprocess, "run", side_effect=fake_run):
            self.media.tts_aligned(script, "tam-su")
        self.assertEqual([text.startswith("[thở dài]") for text in sent], [True, False, False])

    def test_a_narration_can_change_expression_once_per_distinct_emotion(self):
        sent = []

        def fake_http(url, payload):
            sent.append(payload["input"])
            return b"RIFF-fake-network-audio"

        def fake_run(command, **kwargs):
            command = [str(item) for item in command]
            with wave.open(command[-1], "wb") as audio:
                audio.setnchannels(1)
                audio.setsampwidth(2)
                audio.setframerate(22050)
                audio.writeframes(b"\x80\x01" * 11025)
            return subprocess.CompletedProcess(command, 0)

        script = "Hôm nay tôi thấy buồn và cô đơn. Tin vui, tôi rất hạnh phúc và may mắn. Cảnh báo: điều này rất quan trọng."
        with patch.object(self.media, "TTS_ENGINES", ["vieneu"]), patch.object(self.media, "service_up", return_value=True), \
             patch.object(self.media, "_http_wav", side_effect=fake_http), patch.object(self.media.subprocess, "run", side_effect=fake_run):
            self.media.tts_aligned(script, "tam-su")
        self.assertEqual([text.startswith(tag) for text, tag in zip(sent, ["[thở dài]", "[cười]", "[hắng giọng]"])], [True, True, True])

    def test_every_voice_is_stretched_only_as_far_as_sounds_natural(self):
        low, high = self.media.PACE_TEMPO_RANGE
        for voice, (_name, _mood, native) in self.media.VOICE_PRESETS.items():
            tempo = self.media.pace_tempo(voice, "vieneu", 1.0)
            spoken = native * tempo * self.media.PACE_VIDEO_FACTOR
            self.assertTrue(low <= tempo <= high, (voice, round(tempo, 2)))  # it used to be +30% and -21%
            self.assertTrue(2.6 <= spoken <= 4.1, (voice, round(spoken, 2)))
        # a naturally slow storyteller keeps to its own pace (about 3 words a second) instead of being forced to 3.7
        self.assertAlmostEqual(self.media.pace_tempo("doc-truyen", "vieneu"), high)
        self.assertLess(self.media.VOICE_PRESETS["doc-truyen"][2] * high * self.media.PACE_VIDEO_FACTOR, 3.1)
        # the video's own reading speed still counts on top of the VieNeu voice
        self.assertAlmostEqual(self.media.pace_tempo("doc-truyen", "vieneu", 1.2) / self.media.pace_tempo("doc-truyen", "vieneu", 1.0), 1.2)

    def test_the_emotional_voices_are_the_models_storytelling_voices(self):
        story_voices = {"Thiện Minh", "Thiền Tâm Đức", "Thái Sơn", "Thanh Bình", "Ngọc Linh", "Thục Đoan", "Mỹ Duyên", "Quỳnh Anh", "Đức Trí", "Kim Thanh"}  # style "doc_truyen"
        for preset in ("doc-truyen", "co-trang", "co-trang-nu", "triet-ly", "tam-su"):
            self.assertIn(self.media.VOICE_PRESETS[preset][0], story_voices, preset)

    def test_normal_pace_leaves_audio_untouched(self):
        self.assertEqual(self.media._time_stretch(Path("/tmp/x.wav"), 1.0), Path("/tmp/x.wav"))
        self.assertEqual(self.media._time_stretch(Path("/tmp/x.wav"), 1.02), Path("/tmp/x.wav"))

    def test_whitespace_only_text_never_calls_a_synthesizer(self):
        with patch.object(self.media.subprocess, "run") as process:
            with self.assertRaises((RuntimeError, ValueError)):
                self.media.tts_aligned(" \n\t ", "Linh")
            process.assert_not_called()


if __name__ == "__main__":
    unittest.main()

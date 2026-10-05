"""Regression checks for local speech captions without an ASR dependency.

Run with: python3 -m unittest discover -s local-tools -p 'test_*.py'
The synthesis process is mocked; WAV sample counts remain real so the timing
assertions catch character-based or estimated-duration captions.
"""

import base64
import importlib.util
import io
import re
import subprocess
import unittest
import wave
from pathlib import Path
from unittest.mock import patch


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
        if executable == "say":
            output = Path(command[command.index("-o") + 1])
            text = command[-1]
            if "-f" in command:
                text = Path(command[command.index("-f") + 1]).read_text()
            index = len(self.synthesized)
            count = self.sample_counts[index % len(self.sample_counts)]
            self.synthesized.append((text, count))
            self.total_samples += count
            with wave.open(str(output), "wb") as audio:
                audio.setnchannels(1)
                audio.setsampwidth(2)
                audio.setframerate(self.rate)
                # Non-silent PCM ensures the fixture represents speech energy.
                audio.writeframes(b"\x80\x01" * count)
            return subprocess.CompletedProcess(command, 0)
        if executable == "ffmpeg":
            Path(command[-1]).write_bytes(b"ID3-local-speech-test")
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
        cls.media.TTS_ENGINES = ["say"]  # deterministic: never reach for local network services in tests

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

    def test_long_sentence_stays_inside_subtitle_schema_limit(self):
        script = " ".join(["giữ nguyên từng dấu tiếng Việt và thứ tự lời đọc"] * 14) + "."
        phrases = self.media.split_speech_phrases(script)
        self.assertGreater(len(phrases), 1)
        self.assertEqual("".join(phrases), script)
        self.assertTrue(all(len(phrase.strip()) <= 240 for phrase in phrases))

    def test_timing_uses_actual_pcm_samples_and_original_phrase_text(self):
        script = "Bình tĩnh nhé. Kiểm tra địa chỉ liên kết thật kỹ. Không chia sẻ mật khẩu."
        processes = FakeSpeechProcesses()
        with patch.object(self.media.subprocess, "run", side_effect=processes):
            result = self.media.tts_aligned(script, "Linh")
        cues = result["cues"]
        self.assertEqual(len(cues), len(processes.synthesized))
        self.assertGreater(len(cues), 1)
        self.assertEqual("".join(cue["text"] for cue in cues), script)
        self.assertEqual(spoken_text("".join(cue["text"] for cue in cues)), script)
        elapsed_samples = 0
        for cue, (phrase, samples) in zip(cues, processes.synthesized):
            self.assertEqual(cue["text"], phrase)
            self.assertEqual(cue["startMs"], round(elapsed_samples * 1000 / processes.rate))
            elapsed_samples += samples
            self.assertEqual(cue["endMs"], round(elapsed_samples * 1000 / processes.rate))
            self.assertGreater(cue["endMs"], cue["startMs"])
        self.assertEqual(result["durationMs"], round(elapsed_samples * 1000 / processes.rate))
        with wave.open(io.BytesIO(base64.b64decode(result["audioBase64"])), "rb") as audio:
            self.assertEqual(audio.getnframes(), elapsed_samples)
            self.assertEqual(audio.getframerate(), processes.rate)
            self.assertEqual(audio.getnchannels(), 1)
            self.assertEqual(audio.getsampwidth(), 2)
        # Unequal audio durations prove that the cues do not use text length.
        self.assertEqual(cues[0]["endMs"] - cues[0]["startMs"], 500)
        self.assertEqual(cues[1]["endMs"] - cues[1]["startMs"], 1500)

    def test_empty_pcm_from_a_successful_process_is_rejected(self):
        processes = FakeSpeechProcesses([0])
        with patch.object(self.media.subprocess, "run", side_effect=processes):
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

        with patch.object(self.media, "TTS_ENGINES", ["vieneu", "say"]), \
             patch.object(self.media, "service_up", return_value=True), \
             patch.object(self.media, "_http_wav", side_effect=fake_http), \
             patch.object(self.media.subprocess, "run", side_effect=fake_run):
            result = self.media.tts_aligned("Trăng treo đầu núi.", "co-trang")
        self.assertEqual(sent[0][1]["voice"], "Anh Khôi")
        self.assertEqual(sent[0][1]["speed"], 0.88)
        self.assertEqual(result["durationMs"], 500)

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

    def test_unknown_image_and_whisper_models_are_rejected(self):
        with self.assertRaises(ValueError):
            self.media.local_image("cảnh", "9:16", "model-la")
        with self.assertRaises(ValueError):
            self.media.transcribe(b"audio", "model-la")

    def test_whitespace_only_text_never_calls_a_synthesizer(self):
        with patch.object(self.media.subprocess, "run") as process:
            with self.assertRaises((RuntimeError, ValueError)):
                self.media.tts_aligned(" \n\t ", "Linh")
            process.assert_not_called()


if __name__ == "__main__":
    unittest.main()

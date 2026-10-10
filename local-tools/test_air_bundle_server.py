"""The one-time bundle server and the installer that set up the MacBook Air as a media node (dry runs: nothing is installed).

Run with: python3 -m unittest discover -s local-tools -p 'test_*.py'
"""

import importlib.util
import io
import os
import subprocess
import tarfile
import tempfile
import unittest
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
spec = importlib.util.spec_from_file_location("air_bundle_server", HERE / "air_bundle_server.py")
bundle_server = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bundle_server)


def git(repo, *args):
    subprocess.run(["git", "-C", str(repo), "-c", "user.email=t@t", "-c", "user.name=t", *args], check=True, capture_output=True)


class Fixture(unittest.TestCase):
    """A tiny repository with the installer, and a local-ai folder with small stand-in models."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        root = Path(self.tmp.name)
        self.repo = root / "repo"
        (self.repo / "scripts/air-node").mkdir(parents=True)
        (self.repo / "scripts/air-node/install-air-node.sh").write_text((REPO / "scripts/air-node/install-air-node.sh").read_text())
        (self.repo / "hello.txt").write_text("committed")
        git(self.repo, "init", "-q")
        git(self.repo, "add", "-A")
        git(self.repo, "commit", "-q", "-m", "x")
        (self.repo / "untracked.txt").write_text("not committed")
        self.local_ai = root / "local-ai"
        for folder in ("whisper", "piper", "vieneu-v3-turbo", "moss-audio-tokenizer-onnx", "face", "vieneu-cache", "image/hf-cache"):
            (self.local_ai / "models" / folder).mkdir(parents=True)
        (self.local_ai / "models/whisper/ggml-base.bin").write_bytes(b"w" * 2048)
        (self.local_ai / "models/image/hf-cache/unet.safetensors").write_bytes(b"i" * 4096)
        (self.local_ai / "models/whisper/.DS_Store").write_bytes(b"junk")

    def start(self, ttl=60):
        bundle = bundle_server.Bundle(self.repo, self.local_ai, "s3cr3tpath", "node-token-123", "air", "http://127.0.0.1:0/s3cr3tpath", ttl)
        server = bundle_server.serve(bundle, "127.0.0.1", 0)
        self.addCleanup(server.server_close)
        base = f"http://127.0.0.1:{server.server_address[1]}"
        bundle.bundle_url = f"{base}/s3cr3tpath"
        return bundle, base

    def fetch(self, url, method="GET"):
        request = urllib.request.Request(url, method=method, data=b"" if method == "POST" else None)
        try:
            with urllib.request.urlopen(request, timeout=10) as response:
                return response.status, response.read()
        except urllib.error.HTTPError as error:
            return error.code, error.read()


class BundleServer(Fixture):
    def test_only_the_secret_path_answers_and_everything_else_looks_empty(self):
        _, base = self.start()
        for path in ("/install.sh", "/wrong/install.sh", "/s3cr3tpath", "/s3cr3tpath/", "/s3cr3tpath/models", "/s3cr3tpath/../etc/passwd"):
            status, body = self.fetch(base + path)
            self.assertEqual((status, body), (404, b""), path)
        self.assertEqual(self.fetch(base + "/s3cr3tpath/done", "POST")[0], 200)

    def test_the_installer_comes_with_the_nodes_address_and_access_code_filled_in(self):
        _, base = self.start()
        status, body = self.fetch(f"{base}/s3cr3tpath/install.sh")
        text = body.decode()
        self.assertEqual(status, 200)
        self.assertIn('TOKEN="node-token-123"', text)
        self.assertIn(f'BUNDLE="{base}/s3cr3tpath"', text)
        self.assertIn('NAME="air"', text)
        self.assertNotIn("@@", text)

    def test_the_repository_is_sent_as_committed_not_as_edited(self):
        _, base = self.start()
        status, body = self.fetch(f"{base}/s3cr3tpath/repo.tar.gz")
        names = tarfile.open(fileobj=io.BytesIO(body), mode="r:gz").getnames()
        self.assertEqual(status, 200)
        self.assertIn("hello.txt", names)
        self.assertNotIn("untracked.txt", names)

    def test_models_stream_as_a_tar_and_the_picture_model_only_when_asked_for(self):
        _, base = self.start()
        small = tarfile.open(fileobj=io.BytesIO(self.fetch(f"{base}/s3cr3tpath/models.tar?image=0")[1])).getnames()
        self.assertIn("models/whisper/ggml-base.bin", small)
        self.assertFalse(any(name.startswith("models/image") for name in small))
        self.assertFalse(any(name.endswith(".DS_Store") for name in small))
        full = tarfile.open(fileobj=io.BytesIO(self.fetch(f"{base}/s3cr3tpath/models.tar?image=1")[1])).getnames()
        self.assertIn("models/image/hf-cache/unet.safetensors", full)

    def test_it_stops_when_the_node_reports_in_and_remembers_what_it_said(self):
        bundle, base = self.start()
        self.fetch(f"{base}/s3cr3tpath/done?name=air&host=100.117.49.124", "POST")
        self.assertTrue(bundle.done.wait(5))
        self.assertEqual(bundle.reported, {"name": "air", "host": "100.117.49.124"})

    def test_it_refuses_after_its_time_is_up_and_never_listens_on_every_network(self):
        _, base = self.start(ttl=-1)
        self.assertEqual(self.fetch(f"{base}/s3cr3tpath/install.sh")[0], 404)
        with self.assertRaises(SystemExit):
            bundle_server.main(["--repo", ".", "--local-ai", ".", "--host", "0.0.0.0", "--secret", "x", "--token", "t"])

    def test_env_values_are_read_without_quotes_and_missing_ones_are_empty(self):
        env = "A=1\nAI_NODES=air=100.117.49.124,studio=100.1.1.1\nAI_NODES_TOKEN='abc123def'\nB=\n"
        self.assertEqual(bundle_server.env_value(env, "AI_NODES"), "air=100.117.49.124,studio=100.1.1.1")
        self.assertEqual(bundle_server.env_value(env, "AI_NODES_TOKEN"), "abc123def")
        self.assertEqual(bundle_server.env_value(env, "B"), "")
        self.assertEqual(bundle_server.env_value(env, "NOPE"), "")
        self.assertEqual(bundle_server.env_value("", "AI_NODES"), "")


class Installer(Fixture):
    def run_installer(self, **extra_env):
        home = Path(self.tmp.name) / "air-home"
        home.mkdir()
        template = (REPO / "scripts/air-node/install-air-node.sh").read_text()
        script = home / "install.sh"
        script.write_text(bundle_server.render_installer(template, "http://mini:8899/secret", "node-token-123", "air"))
        env = {**os.environ, "AIR_NODE_HOME": str(home), "AIR_NODE_DRY_RUN": "1", "AIR_NODE_TOOLKIT": str(REPO / "local-tools/toolkit"), **extra_env}
        result = subprocess.run(["bash", str(script)], capture_output=True, text=True, env=env, timeout=60)
        return home, result

    def test_a_dry_run_lays_out_local_ai_and_saves_the_token_where_mo_may_phu_reads_it(self):
        home, result = self.run_installer(NODE_IMAGE="yes")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        token_file = home / ".studio-node-token"
        self.assertEqual(token_file.read_text(), "node-token-123")  # the same code the mini wrote to AI_NODES_TOKEN
        self.assertEqual(oct(token_file.stat().st_mode & 0o777), "0o600")
        local_ai = home / "Developer/local-ai"
        for name in ("bin/start-vieneu.sh", "bin/start-tts.sh", "bin/start-whisper.sh", "bin/env.sh", "vieneu_api.py", "vieneu_tts.py", "tts_api.py"):
            self.assertTrue((local_ai / name).exists(), name)
        self.assertTrue(os.access(local_ai / "bin/start-vieneu.sh", os.X_OK))
        self.assertTrue((local_ai / "output").is_dir())  # whisper-server writes its temporary files there
        # it then starts the machine with the repository's own script, not with a second way of doing it
        self.assertIn("scripts/Mo-May-Phu.command", result.stdout)
        self.assertIn("ollama pull qwen3.5:4b", result.stdout)
        self.assertIn("models.tar?image=yes", result.stdout)
        self.assertIn("Xong. Máy 'air'", result.stdout)

    def test_a_small_machine_gets_no_picture_model_and_the_main_machine_keeps_the_pictures(self):
        _, result = self.run_installer(NODE_IMAGE="no")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("models.tar?image=no", result.stdout)
        self.assertIn("không tải model ảnh", result.stdout)
        self.assertNotIn("mlx-examples.git", result.stdout)

    def test_the_uninstaller_forgets_the_token_and_keeps_the_models(self):
        home, _ = self.run_installer(NODE_IMAGE="yes")
        result = subprocess.run(["bash", str(REPO / "scripts/air-node/uninstall-air-node.sh")], capture_output=True, text=True,
                                env={**os.environ, "AIR_NODE_HOME": str(home), "AIR_NODE_DRY_RUN": "1"}, timeout=30)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse((home / ".studio-node-token").exists())
        self.assertTrue((home / "Developer/local-ai/bin").exists())


class ServeBundleScript(unittest.TestCase):
    """The Mac mini side: it writes AI_NODES and AI_NODES_TOKEN for the worker and starts the bundle server (a fake tailscale answers)."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        root = Path(self.tmp.name)
        self.bin = root / "bin"
        self.bin.mkdir()
        fake = self.bin / "tailscale"
        fake.write_text("""#!/bin/bash
if [ "$1" = "ip" ]; then echo 127.0.0.1; exit 0; fi
if [ "$1" = "status" ]; then echo '{"Peer":{"a":{"HostName":"air","TailscaleIPs":["100.117.49.124"]},"b":{"HostName":"studio","TailscaleIPs":["100.9.9.9"]}}}'; exit 0; fi
""")
        fake.chmod(0o755)
        self.env_file = root / "env.selfhost"

    def run_script(self, *args, **extra):
        env = {**os.environ, "PATH": f"{self.bin}:{os.environ['PATH']}", "ENV_FILE": str(self.env_file), "BUNDLE_PORT": "0",
               "LOCAL_AI_ROOT": self.tmp.name, **extra}
        process = subprocess.Popen(["bash", str(REPO / "scripts/air-node/serve-bundle.sh"), *args], cwd=REPO, env=env,
                                   stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        lines = []
        try:
            for line in process.stdout:
                lines.append(line)
                if "installCommand" in line:
                    break
        finally:
            process.kill()
            process.wait()
            process.stdout.close()
        return "".join(lines)

    def test_it_writes_the_air_and_a_token_once_keeps_other_machines_and_never_prints_the_token(self):
        self.env_file.write_text("A=1\nAI_NODES=studio=100.9.9.9\nAI_NODES_TOKEN=\n")
        output = self.run_script()
        text = self.env_file.read_text()
        token = bundle_server.env_value(text, "AI_NODES_TOKEN")
        self.assertEqual(bundle_server.env_value(text, "AI_NODES"), "studio=100.9.9.9,air=100.117.49.124")
        self.assertEqual(len(token), 48)
        self.assertIn("A=1", text)
        self.assertEqual(oct(self.env_file.stat().st_mode & 0o777), "0o600")
        self.assertNotIn(token, output)  # the code goes to the Air inside the installer, never to the terminal
        self.assertIn("curl -fsSL http://127.0.0.1:", output)
        self.assertIn("/install.sh | bash", output)
        # the second run keeps the same token and does not list the air twice
        self.run_script()
        again = self.env_file.read_text()
        self.assertEqual(bundle_server.env_value(again, "AI_NODES_TOKEN"), token)
        self.assertEqual(bundle_server.env_value(again, "AI_NODES"), "studio=100.9.9.9,air=100.117.49.124")

    def test_an_unknown_machine_name_is_reported_and_nothing_is_written(self):
        output = self.run_script("nobody")
        self.assertIn("Tailscale không thấy máy tên 'nobody'", output)
        self.assertFalse(self.env_file.exists())


if __name__ == "__main__":
    unittest.main()

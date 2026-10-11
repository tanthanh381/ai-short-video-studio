"""Checks for keeping the second Mac identical to the main one: what belongs to the sync set, the server on the main Mac and the
agent on the second, run against each other over real HTTP with temporary folders standing in for the two Macs.

Run with: python3 -m unittest discover -s local-tools -p 'test_*.py'
"""

import json
import os
import shutil
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch

import node_sync_agent
import node_sync_server
import sync_manifest

TOKEN = "node-token-123"


def write(path, content=b"x", mode=None):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content if isinstance(content, bytes) else content.encode())
    if mode:
        os.chmod(path, mode)
    return path


def build_machine(base, *, unet=b"unet-weights-v1"):
    """A folder tree like a Mac that makes pictures: the repo, the local-ai toolkit and the model files (with a HuggingFace-style cache)."""
    repo, local_ai = Path(base) / "repo", Path(base) / "local-ai"
    write(repo / "local-tools/media_server.py", "print('media v1')")
    write(repo / "local-tools/image_server.py", "print('image v1')")
    write(repo / "local-tools/node_status.py", "# status v1")
    write(repo / "local-tools/whiteboard_server.py", "print('wb v1')")
    write(repo / "local-tools/whiteboard/draw.py", "# draw v1")
    write(repo / "local-tools/node_sync_agent.py", "# agent v1")
    write(repo / "local-tools/sync_manifest.py", "# manifest v1")
    write(repo / "local-tools/toolkit/requirements-venv.txt", "numpy==1.0")
    write(repo / "scripts/Mo-May-Phu.command", "#!/bin/zsh\necho start", 0o755)
    # never copied: tests, the main machine's own servers, caches
    write(repo / "local-tools/test_media_server.py", "# test")
    write(repo / "local-tools/tests/test_x.py", "# test")
    write(repo / "local-tools/air_bundle_server.py", "# bundle")
    write(repo / "local-tools/node_sync_server.py", "# sync server")
    write(repo / "local-tools/__pycache__/media_server.cpython-312.pyc", "pyc")
    write(local_ai / "bin/env.sh", "export A=1", 0o755)
    write(local_ai / "bin/start-whisper.sh", "#!/bin/zsh\nwhisper", 0o755)
    write(local_ai / "bin/generate-image.sh", "# only on the main machine")
    write(local_ai / "vieneu_api.py", "# vieneu v1")
    write(local_ai / "tts_api.py", "# tts v1")
    write(local_ai / "models/whisper/ggml-base.bin", b"whisper-weights")
    write(local_ai / "models/piper/voice.onnx", b"piper-voice")
    write(local_ai / "models/face/yunet.onnx", b"face")
    write(local_ai / "models/vieneu-cache/hub/blob", b"cache: not part of the sync set")
    hub = local_ai / "models/image/hf-cache/hub/models--stabilityai--sdxl-turbo"
    write(hub / "blobs/aaa111", unet)
    write(hub / "blobs/bbb222", b"vae-weights")
    write(hub / "refs/main", "rev1")
    (hub / "snapshots/rev1/unet").mkdir(parents=True, exist_ok=True)
    os.symlink("../../../blobs/aaa111", hub / "snapshots/rev1/unet/model.safetensors")
    os.symlink("../../../blobs/bbb222", hub / "snapshots/rev1/vae.safetensors")
    write(local_ai / "models/image/.DS_Store", "junk")
    write(local_ai / "models/image/hf-cache/xet/logs/x.log", "log")
    write(hub / "blobs/ccc333.lock", "lock")
    return {"repo": str(repo), "local_ai": str(local_ai)}


class FakeOllama:
    """Answers /api/tags like Ollama and remembers /api/pull."""

    def __init__(self, models):
        self.models = models
        self.pulled = []
        outer = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_GET(self):
                body = json.dumps({"models": [{"name": n, "digest": d, "size": 1} for n, d in outer.models.items()]}).encode()
                self.send_response(200)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def do_POST(self):
                length = int(self.headers.get("Content-Length") or 0)
                outer.pulled.append(json.loads(self.rfile.read(length))["name"])
                self.send_response(200)
                self.send_header("Content-Length", "2")
                self.end_headers()
                self.wfile.write(b"{}")

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}"

    def close(self):
        self.server.shutdown()
        self.server.server_close()


class Fixture(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.base = Path(self.tmp.name)
        self.mini = build_machine(self.base / "mini")
        self.mini_ollama = FakeOllama({"qwen3.5:4b": "sha-q35", "qwen2.5:3b": "sha-q25"})
        self.addCleanup(self.mini_ollama.close)
        self.source = node_sync_server.Source(self.mini, self.mini_ollama.url, self.base / "mini-cache.json")
        self.server = node_sync_server.serve(self.source, "127.0.0.1", 0, TOKEN, interval_s=3600, quiet=True)
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}"

    def get(self, path, token=TOKEN, headers=None):
        request = urllib.request.Request(self.url + path, headers={**({"Authorization": f"Bearer {token}"} if token else {}), **(headers or {})})
        return urllib.request.urlopen(request, timeout=10)

    def new_agent(self, *, image=True, idle=True, power=("ac", None), air_ollama=None, **over):
        self.down = {"value": []}
        self.started = []
        air_dir = self.base / "air"
        air_dir.mkdir(exist_ok=True)
        roots = {"repo": str(air_dir / "repo"), "local_ai": str(air_dir / "local-ai")}
        Path(roots["repo"]).mkdir(parents=True, exist_ok=True)
        Path(roots["local_ai"]).mkdir(parents=True, exist_ok=True)
        self.air_ollama = FakeOllama(air_ollama if air_ollama is not None else {"qwen3.5:4b": "sha-q35", "qwen2.5:3b": "sha-q25"})
        self.addCleanup(self.air_ollama.close)
        config = {"source": self.url, "node": "air", "image": image, "repo": roots["repo"], "localAi": roots["local_ai"], "ollama": self.air_ollama.url}
        self.restarts = []
        self.idle = {"value": idle}
        self.pulls = []
        agent = node_sync_agent.Agent(
            config, TOKEN, node_sync_agent.Paths(air_dir / "home"),
            restart=lambda services: self.restarts.append(sorted(services)),
            is_idle=lambda: self.idle["value"],
            power=lambda: power,
            pull=lambda name: self.pulls.append(name),
            services_down=lambda: list(self.down["value"]),
            start_services=lambda: self.started.append(1),
            log=lambda *_: None, **over,
        )
        self.air = roots
        (air_dir / "home").mkdir(exist_ok=True)
        return agent


class SyncSet(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.roots = build_machine(self.tmp.name)

    def keys(self, with_image=True):
        return [key for key, _ in sync_manifest.iter_keys(self.roots, with_image)]

    def test_it_holds_the_programs_the_toolkit_and_the_model_files_and_nothing_else(self):
        keys = self.keys()
        for expected in ["code/local-tools/media_server.py", "code/local-tools/whiteboard/draw.py", "code/local-tools/toolkit/requirements-venv.txt",
                         "code/scripts/Mo-May-Phu.command", "toolkit/bin/env.sh", "toolkit/vieneu_api.py", "models/whisper/ggml-base.bin",
                         "models/face/yunet.onnx", "models/image/hf-cache/hub/models--stabilityai--sdxl-turbo/blobs/aaa111",
                         "models/image/hf-cache/hub/models--stabilityai--sdxl-turbo/snapshots/rev1/unet/model.safetensors"]:
            self.assertIn(expected, keys)
        joined = " ".join(keys)
        for left_out in ["test_media_server", "tests/", "air_bundle_server", "node_sync_server", "__pycache__", "generate-image.sh", "vieneu-cache", ".DS_Store", "xet", ".lock"]:
            self.assertNotIn(left_out, joined)

    def test_a_mac_that_makes_no_pictures_does_not_get_the_picture_model(self):
        self.assertTrue(any(key.startswith("models/image/") for key in self.keys(True)))
        self.assertFalse(any(key.startswith("models/image/") for key in self.keys(False)))

    def test_symlinks_are_kept_as_symlinks_with_their_target(self):
        cache = sync_manifest.HashCache()
        entries = sync_manifest.scan(self.roots, True, cache)
        link = entries["models/image/hf-cache/hub/models--stabilityai--sdxl-turbo/snapshots/rev1/unet/model.safetensors"]
        self.assertEqual(link, {"kind": "symlink", "target": "../../../blobs/aaa111"})
        self.assertEqual(entries["code/scripts/Mo-May-Phu.command"]["exec"], True)
        self.assertEqual(entries["code/local-tools/media_server.py"]["exec"], False)

    def test_the_version_is_the_same_exactly_when_the_files_are(self):
        cache = sync_manifest.HashCache()
        first = sync_manifest.scan(self.roots, True, cache)
        again = sync_manifest.scan(self.roots, True, sync_manifest.HashCache())
        self.assertEqual(sync_manifest.version_of(first), sync_manifest.version_of(again))
        write(Path(self.roots["repo"]) / "local-tools/media_server.py", "print('media v2')")
        changed = sync_manifest.scan(self.roots, True, cache)
        self.assertNotEqual(sync_manifest.version_of(first), sync_manifest.version_of(changed))
        self.assertEqual(sync_manifest.diff(first, changed, True)["changed"], ["code/local-tools/media_server.py"])

    def test_the_hash_cache_reads_a_file_again_only_when_it_changed(self):
        path = write(Path(self.tmp.name) / "f.bin", b"abc")
        cache = sync_manifest.HashCache(Path(self.tmp.name) / "cache.json")
        first = cache.sha256(path)
        with patch.object(sync_manifest.hashlib, "sha256", side_effect=AssertionError("read again")):
            self.assertEqual(cache.sha256(path), first)
            cache.save()
            self.assertEqual(sync_manifest.HashCache(Path(self.tmp.name) / "cache.json").sha256(path), first)  # remembered across restarts
        write(path, b"abcd")
        self.assertNotEqual(cache.sha256(path), first)

    def test_diff_finds_what_is_missing_and_what_differs_and_ignores_extras(self):
        cache = sync_manifest.HashCache()
        expected = sync_manifest.scan(self.roots, True, cache)
        local = dict(expected)
        del local["toolkit/tts_api.py"]
        local["code/local-tools/media_server.py"] = {**local["code/local-tools/media_server.py"], "sha256": "other"}
        local["code/local-tools/only_here.py"] = {"kind": "file", "size": 1, "sha256": "z", "exec": False}
        gaps = sync_manifest.diff(expected, local, True)
        self.assertEqual(gaps["missing"], ["toolkit/tts_api.py"])
        self.assertEqual(gaps["changed"], ["code/local-tools/media_server.py"])
        # without the picture model those files are not expected
        self.assertFalse(any(key.startswith("models/image/") for key in sync_manifest.diff(expected, {}, False)["missing"]))

    def test_changed_files_say_which_programs_to_restart(self):
        services = sync_manifest.services_for
        self.assertEqual(services(["code/local-tools/media_server.py"]), {"media"})
        self.assertEqual(services(["code/local-tools/image_server.py", "models/image/hf-cache/x"]), {"image"})
        self.assertEqual(services(["code/local-tools/whiteboard/draw.py"]), {"whiteboard"})
        self.assertEqual(services(["code/local-tools/node_sync_agent.py"]), {"agent"})
        self.assertEqual(services(["toolkit/vieneu_api.py", "toolkit/tts_api.py"]), {"vieneu", "piper"})
        self.assertEqual(services(["models/face/yunet.onnx"]), {"media"})
        self.assertEqual(services(["code/scripts/Mo-May-Phu.command", "code/local-tools/toolkit/requirements-venv.txt"]), set())

    def test_a_key_cannot_reach_outside_its_folder(self):
        for bad in ["code/../../etc/passwd", "code//etc/passwd", "models/../bin/env.sh", "other/x", "code/", "/etc/passwd"]:
            self.assertIsNone(sync_manifest.resolve(self.roots, bad), bad)
        self.assertEqual(sync_manifest.resolve(self.roots, "code/local-tools/media_server.py"), Path(self.roots["repo"]) / "local-tools/media_server.py")
        self.assertEqual(sync_manifest.resolve(self.roots, "models/whisper/ggml-base.bin"), Path(self.roots["local_ai"]) / "models/whisper/ggml-base.bin")

    def test_the_models_digest_follows_the_model_files_in_use_not_leftovers(self):
        local_ai = Path(self.roots["local_ai"])
        hub = local_ai / "models/image/hf-cache/hub/models--stabilityai--sdxl-turbo"
        before = sync_manifest.models_digest(self.roots, True)
        write(local_ai / "models/whisper/ggml-base.bin", b"whisper-weights")  # same size: same digest, nothing is read
        write(hub / "blobs/old999", b"an old blob nothing points at any more")
        self.assertEqual(sync_manifest.models_digest(self.roots, True), before)
        write(hub / "blobs/aaa111", b"unet-weights-v2-is-longer")  # the model the pointer leads to changed size
        changed = sync_manifest.models_digest(self.roots, True)
        self.assertNotEqual(changed, before)
        os.remove(hub / "blobs/aaa111")  # a cut download: the pointer leads nowhere
        self.assertNotEqual(sync_manifest.models_digest(self.roots, True), changed)
        write(local_ai / "models/whisper/ggml-base.bin", b"a-much-longer-file-now")
        self.assertNotEqual(sync_manifest.models_digest(self.roots, True), before)
        self.assertNotEqual(sync_manifest.models_digest(self.roots, False), before)


class Tailscale(unittest.TestCase):
    def test_only_an_address_in_tailscales_range_counts(self):
        self.assertEqual(node_sync_server.valid_tailscale_ip("100.121.139.81\n"), "100.121.139.81")
        for bad in ["The Tailscale CLI failed to start: failed to load preferences", "", None, "192.168.1.5", "127.0.0.1", "0.0.0.0", "100.63.0.1", "fd7a:115c:a1e0::1"]:
            self.assertIsNone(node_sync_server.valid_tailscale_ip(bad), bad)

    def test_it_finds_the_address_in_ifconfig_when_the_command_line_tool_cannot_start(self):
        ifconfig = """lo0: flags=8049<UP,LOOPBACK,RUNNING,MULTICAST> mtu 16384
\tinet 127.0.0.1 netmask 0xff000000
en0: flags=8863<UP,BROADCAST,SMART,RUNNING,SIMPLEX,MULTICAST> mtu 1500
\tinet 192.168.1.20 netmask 0xffffff00 broadcast 192.168.1.255
utun4: flags=8051<UP,POINTOPOINT,RUNNING,MULTICAST> mtu 1280
\tinet 100.121.139.81 --> 100.121.139.81 netmask 0xffffffff
"""
        self.assertEqual(node_sync_server.tailscale_ip_from_ifconfig(ifconfig), "100.121.139.81")
        self.assertIsNone(node_sync_server.tailscale_ip_from_ifconfig("en0:\n\tinet 192.168.1.20 netmask 0xffffff00"))
        self.assertIsNone(node_sync_server.tailscale_ip_from_ifconfig(""))


class Server(Fixture):
    def test_every_request_needs_the_access_code(self):
        for token in (None, "wrong"):
            with self.assertRaises(urllib.error.HTTPError) as caught:
                self.get("/manifest", token=token)
            self.assertEqual(caught.exception.code, 401)
        with self.assertRaises(urllib.error.HTTPError) as caught:
            self.get("/file?key=code/local-tools/media_server.py", token="wrong")
        self.assertEqual(caught.exception.code, 401)

    def test_the_manifest_lists_files_with_hashes_the_ollama_models_and_a_short_brief(self):
        full = json.load(self.get("/manifest"))
        self.assertEqual(full["entries"]["code/local-tools/media_server.py"]["sha256"], node_sync_agent.hash_file(Path(self.mini["repo"]) / "local-tools/media_server.py"))
        self.assertEqual([m["name"] for m in full["ollama"]], ["qwen3.5:4b", "qwen2.5:3b"])
        brief = json.load(self.get("/manifest?brief=1"))
        self.assertEqual(brief["version"], full["version"])
        self.assertNotIn("entries", brief)

    def test_it_sends_a_file_and_the_rest_of_a_file_from_a_byte(self):
        key = "models/whisper/ggml-base.bin"
        self.assertEqual(self.get(f"/file?key={key}").read(), b"whisper-weights")
        part = self.get(f"/file?key={key}", headers={"Range": "bytes=8-"})
        self.assertEqual((part.status, part.read(), part.headers["Content-Range"]), (206, b"weights", "bytes 8-14/15"))
        with self.assertRaises(urllib.error.HTTPError) as caught:
            self.get(f"/file?key={key}", headers={"Range": "bytes=99-"})
        self.assertEqual(caught.exception.code, 416)

    def test_it_sends_only_what_is_in_the_sync_set(self):
        for key in ["code/local-tools/test_media_server.py", "code/../../etc/hosts", "toolkit/bin/generate-image.sh", "models/vieneu-cache/hub/blob", "code/local-tools"]:
            with self.assertRaises(urllib.error.HTTPError, msg=key) as caught:
                self.get(f"/file?key={key}")
            self.assertEqual(caught.exception.code, 404, key)

    def test_it_will_not_listen_on_every_network(self):
        env = self.base / "env"
        env.write_text(f"AI_NODES_TOKEN={TOKEN}\n")
        with self.assertRaises(SystemExit) as caught:
            node_sync_server.main(["--repo", self.mini["repo"], "--local-ai", self.mini["local_ai"], "--host", "0.0.0.0", "--port", "0", "--env-file", str(env)])
        self.assertIn("Tailscale", str(caught.exception))

    def test_it_will_not_start_without_an_access_code(self):
        env = self.base / "env-empty"
        env.write_text("SOMETHING=else\n")
        with self.assertRaises(SystemExit) as caught:
            node_sync_server.main(["--repo", self.mini["repo"], "--local-ai", self.mini["local_ai"], "--host", "127.0.0.1", "--port", "0", "--env-file", str(env)])
        self.assertIn("mã truy cập", str(caught.exception))


class Agent(Fixture):
    def test_a_machine_with_nothing_gets_everything_and_reports_it_is_in_step(self):
        agent = self.new_agent()
        state = agent.cycle()
        self.assertEqual(state["state"], "in-sync", state)
        self.assertEqual(state["behind"], {"code": 0, "toolkit": 0, "models": 0, "ollama": 0})
        air = Path(self.air["repo"])
        self.assertEqual((air / "local-tools/media_server.py").read_text(), "print('media v1')")
        self.assertTrue(os.access(air / "scripts/Mo-May-Phu.command", os.X_OK))
        self.assertEqual((Path(self.air["local_ai"]) / "models/whisper/ggml-base.bin").read_bytes(), b"whisper-weights")
        link = Path(self.air["local_ai"]) / "models/image/hf-cache/hub/models--stabilityai--sdxl-turbo/snapshots/rev1/unet/model.safetensors"
        self.assertEqual(os.readlink(link), "../../../blobs/aaa111")
        self.assertEqual(link.read_bytes(), b"unet-weights-v1")  # the symlink works: the blob is there
        self.assertFalse((air / "local-tools/test_media_server.py").exists())
        self.assertEqual(state["sourceVersion"], state["localVersion"])
        self.assertEqual(json.loads(agent.paths.state.read_text())["state"], "in-sync")

    def test_the_next_round_downloads_nothing_when_nothing_changed(self):
        agent = self.new_agent()
        agent.cycle()
        with patch.object(agent, "download", side_effect=AssertionError("nothing should be downloaded")):
            self.assertEqual(agent.cycle()["state"], "in-sync")

    def test_a_changed_program_arrives_and_only_its_service_is_restarted_once_the_machine_is_idle(self):
        agent = self.new_agent()
        agent.cycle()
        agent.pending_restart.discard("agent")  # the first fill copied the agent's own files too; a real one would have left the loop then
        self.restarts.clear()
        write(Path(self.mini["repo"]) / "local-tools/media_server.py", "print('media v2')")
        self.source.refresh()
        self.idle["value"] = False  # a picture is being made right now
        state = agent.cycle()
        self.assertEqual((Path(self.air["repo"]) / "local-tools/media_server.py").read_text(), "print('media v2')")
        self.assertEqual(self.restarts, [])
        self.assertEqual(state["restartPending"], ["media"])
        self.assertIn("Chờ máy rảnh để khởi động lại dịch vụ đã cập nhật", state["differences"])
        self.idle["value"] = True
        agent.cycle()
        self.assertEqual(self.restarts, [["media"]])
        self.assertEqual(agent.cycle()["restartPending"], [])

    def test_the_replaced_program_is_kept_aside(self):
        agent = self.new_agent()
        agent.cycle()
        write(Path(self.mini["repo"]) / "local-tools/image_server.py", "print('image v2')")
        self.source.refresh()
        agent.cycle()
        saved = list(agent.paths.backups.rglob("image_server.py"))
        self.assertEqual([p.read_text() for p in saved], ["print('image v1')"])

    def test_an_updated_agent_leaves_the_loop_so_launchd_starts_the_new_one(self):
        agent = self.new_agent()
        agent.cycle()
        write(Path(self.mini["repo"]) / "local-tools/node_sync_agent.py", "# agent v2")
        self.source.refresh()
        self.assertEqual(agent.run_forever(sleep=lambda _: None, max_ticks=5), "restart")
        self.assertEqual((Path(self.air["repo"]) / "local-tools/node_sync_agent.py").read_text(), "# agent v2")

    def test_a_cut_download_goes_on_from_where_it_stopped_and_is_checked(self):
        agent = self.new_agent()
        key = "models/image/hf-cache/hub/models--stabilityai--sdxl-turbo/blobs/aaa111"
        part = Path(self.air["local_ai"]) / "models" / key[len("models/"):]
        part.parent.mkdir(parents=True, exist_ok=True)
        Path(f"{part}.sync-part").write_bytes(b"unet-")  # the first five bytes arrived before the connection dropped
        requested = []
        real_open = agent.open

        def spy(request, timeout=None):
            requested.append(dict(request.header_items()).get("Range"))
            return real_open(request, timeout=timeout)

        agent.open = spy
        self.assertEqual(agent.cycle()["state"], "in-sync")
        self.assertEqual(part.read_bytes(), b"unet-weights-v1")
        self.assertIn("bytes=5-", requested)  # only the rest was asked for

    def test_a_download_that_arrives_damaged_is_thrown_away_and_reported(self):
        agent = self.new_agent()
        agent.cycle()
        write(Path(self.mini["repo"]) / "local-tools/media_server.py", "print('media v2')")
        manifest = self.source.refresh()
        manifest["entries"]["code/local-tools/media_server.py"]["sha256"] = "0" * 64  # the main machine's list and its file disagree
        state = agent.cycle()
        self.assertEqual(state["state"], "behind")
        self.assertIn("không khớp mã kiểm tra", state["error"])
        self.assertFalse(Path(f"{self.air['repo']}/local-tools/media_server.py.sync-part").exists())
        self.assertEqual((Path(self.air["repo"]) / "local-tools/media_server.py").read_text(), "print('media v1')")  # the old one is untouched
        self.source.refresh()
        self.assertEqual(agent.cycle()["state"], "in-sync")

    def test_on_battery_the_programs_come_but_the_models_wait(self):
        agent = self.new_agent(power=("battery", 80))
        state = agent.cycle()
        self.assertEqual(state["state"], "behind")
        self.assertEqual(state["behind"]["code"], 0)
        self.assertGreater(state["behind"]["models"], 0)
        self.assertIn("Đang dùng pin", " ".join(state["differences"]))
        self.assertTrue((Path(self.air["repo"]) / "local-tools/media_server.py").exists())
        self.assertFalse((Path(self.air["local_ai"]) / "models/whisper/ggml-base.bin").exists())

    def test_it_does_not_start_a_download_that_would_fill_the_disk(self):
        agent = self.new_agent()
        usage = shutil.disk_usage(self.air["local_ai"])
        with patch.object(node_sync_agent.shutil, "disk_usage", return_value=type(usage)(usage.total, usage.total - 1000, 1000)):
            state = agent.cycle()
        self.assertIn("Không đủ chỗ trống", state["error"])
        self.assertTrue((Path(self.air["repo"]) / "local-tools/media_server.py").exists())  # the small files still came
        self.assertFalse((Path(self.air["local_ai"]) / "models/whisper/ggml-base.bin").exists())

    def test_a_machine_without_the_picture_model_never_downloads_it(self):
        agent = self.new_agent(image=False)
        state = agent.cycle()
        self.assertEqual(state["state"], "in-sync")
        self.assertEqual(state["sourceVersion"], state["localVersion"])  # in step means the same version, even without the picture files
        self.assertFalse((Path(self.air["local_ai"]) / "models/image").exists())

    def test_missing_ollama_models_are_pulled_and_a_machine_without_ollama_is_left_alone(self):
        agent = self.new_agent(air_ollama={"qwen3.5:4b": "sha-OLD"})
        state = agent.cycle()
        self.assertEqual(sorted(self.pulls), ["qwen2.5:3b", "qwen3.5:4b"])  # one missing, one with a different digest
        self.assertEqual(state["behind"]["ollama"], 2)  # the fake does not really install them
        self.air_ollama.close()
        self.pulls.clear()
        agent.config["ollama"] = "http://127.0.0.1:9"  # nothing there
        agent.cycle()
        self.assertEqual(self.pulls, [])

    def test_files_that_only_this_machine_has_are_never_deleted(self):
        agent = self.new_agent()
        agent.cycle()
        extra = write(Path(self.air["repo"]) / "local-tools/only_on_the_air.py", "# mine")
        old = write(Path(self.air["local_ai"]) / "models/piper/old-voice.onnx", b"old")
        agent.cycle()
        self.assertTrue(extra.exists() and old.exists())

    def test_it_reports_when_the_main_machine_cannot_be_reached_or_refuses_the_code(self):
        agent = self.new_agent()
        agent.config["source"] = "http://127.0.0.1:9"
        state = agent.cycle()
        self.assertEqual(state["state"], "error")
        self.assertIn("Không liên lạc được với Mac mini", state["error"])
        agent.config["source"] = self.url
        agent.token = "wrong"
        self.assertIn("từ chối mã truy cập", agent.cycle()["error"])

    def test_pause_and_now_files_control_the_loop(self):
        agent = self.new_agent()
        agent.paths.paused.touch()
        agent.run_forever(sleep=lambda _: None, max_ticks=2)
        self.assertEqual(agent.last_state["state"], "paused")
        self.assertFalse((Path(self.air["repo"]) / "local-tools/media_server.py").exists())  # paused: nothing was fetched
        agent.paths.paused.unlink()
        agent.paths.trigger.touch()
        agent.run_forever(sleep=lambda _: None, max_ticks=1)
        self.assertEqual(agent.last_state["state"], "in-sync")
        self.assertFalse(agent.paths.trigger.exists())  # the request was consumed

    def test_a_program_that_is_down_is_started_again_but_never_in_a_loop(self):
        clock = {"t": 1_000_000.0}
        agent = self.new_agent(now=lambda: clock["t"])
        agent.cycle()
        self.down["value"] = ["Ollama", "máy vẽ ảnh"]
        agent.supervise()
        self.assertEqual(len(self.started), 1)
        self.assertEqual(agent.last_state["recovery"], {"count": 1, "lastAt": clock["t"], "down": ["Ollama", "máy vẽ ảnh"]})
        self.assertEqual(json.loads(agent.paths.state.read_text())["recovery"]["down"], ["Ollama", "máy vẽ ảnh"])  # the page can say what is missing
        clock["t"] += 100
        agent.supervise()
        self.assertEqual(len(self.started), 1)  # too soon: it is still starting
        clock["t"] += 300  # 400 s: past the 360 s that follow a first failed attempt
        agent.supervise()
        self.assertEqual(len(self.started), 2)
        clock["t"] += 700  # the wait doubled again (720 s)
        agent.supervise()
        self.assertEqual(len(self.started), 2)
        clock["t"] += 100
        agent.supervise()
        self.assertEqual(len(self.started), 3)
        self.down["value"] = []  # it came back: the count of tries starts again
        agent.supervise()
        self.assertEqual(agent.last_state["recovery"]["down"], [])
        self.assertEqual(agent.last_state["recovery"]["count"], 3)
        self.down["value"] = ["Whisper"]
        clock["t"] += 200
        agent.supervise()
        self.assertEqual(len(self.started), 4)  # a new problem is tried after the short wait, not the long one

    def test_nothing_is_started_when_everything_is_up_or_while_sync_is_paused(self):
        agent = self.new_agent()
        agent.cycle()
        agent.supervise()
        self.assertEqual(self.started, [])
        self.down["value"] = ["Ollama"]
        agent.paths.paused.touch()
        agent.supervise()
        self.assertEqual(self.started, [])  # paused by the owner: the programs are left as they are
        agent.paths.paused.unlink()
        agent.supervise()
        self.assertEqual(len(self.started), 1)

    def test_every_round_of_the_loop_also_looks_after_the_programs(self):
        agent = self.new_agent()
        self.down["value"] = ["cầu nối media"]
        agent.run_forever(sleep=lambda _: None, max_ticks=1)
        self.assertEqual(len(self.started), 1)
        self.assertEqual(agent.last_state["recovery"]["down"], ["cầu nối media"])
        self.assertEqual(agent.last_state["state"], "in-sync")

    def test_a_failing_check_of_the_programs_does_not_stop_the_sync(self):
        agent = self.new_agent()
        agent.services_down = lambda: (_ for _ in ()).throw(RuntimeError("boom"))
        agent.run_forever(sleep=lambda _: None, max_ticks=1)
        self.assertEqual(agent.last_state["state"], "in-sync")

    def test_a_crash_in_one_round_is_reported_and_does_not_stop_the_loop(self):
        agent = self.new_agent()
        with patch.object(agent, "cycle", side_effect=RuntimeError("boom")):
            agent.run_forever(sleep=lambda _: None, max_ticks=2)
        self.assertEqual(agent.last_state["state"], "error")
        self.assertIn("RuntimeError", agent.last_state["error"])


class ServiceProbe(unittest.TestCase):
    """The agent's own look at this Mac's programs, against stand-ins for the media bridge and the hand-drawing server."""

    def serve(self, body, status=200):
        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_GET(self):
                data = json.dumps(body).encode()
                self.send_response(status)
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        return f"http://127.0.0.1:{server.server_address[1]}"

    def agent(self, **config):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        base = {"source": "http://127.0.0.1:9", "node": "air", "image": False, "repo": tmp.name, "localAi": tmp.name, "ollama": "http://127.0.0.1:9"}
        return node_sync_agent.Agent({**base, **config}, TOKEN, node_sync_agent.Paths(tmp.name), log=lambda *_: None)

    def test_it_names_what_the_bridge_says_is_down(self):
        bridge = self.serve({"ok": False, "image": True, "tts": True, "transcribe": False, "ollama": False})
        self.assertEqual(self.agent(bridge=bridge).services_down(), ["Ollama", "Whisper"])
        healthy = self.serve({"ok": True, "image": True, "tts": True, "transcribe": True, "ollama": True})
        self.assertEqual(self.agent(bridge=healthy).services_down(), [])

    def test_a_bridge_that_does_not_answer_is_down_and_so_is_a_silent_hand_drawing_server(self):
        self.assertEqual(self.agent(bridge="http://127.0.0.1:9").services_down(), ["cầu nối media"])
        healthy = self.serve({"image": True, "tts": True, "transcribe": True, "ollama": True})
        self.assertEqual(self.agent(bridge=healthy, whiteboard="http://127.0.0.1:9").services_down(), ["máy vẽ tay"])
        self.assertEqual(self.agent(bridge=healthy, whiteboard=self.serve({"ok": True})).services_down(), [])

    def test_a_machine_without_a_bridge_configured_has_nothing_to_watch(self):
        self.assertEqual(self.agent().services_down(), [])


if __name__ == "__main__":
    unittest.main()

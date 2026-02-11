#!/usr/bin/env python3
"""
Kortix Sandbox E2E Test Runner

Validates the sandbox container end-to-end:
  1. Builds the Docker image
  2. Starts the container
  3. Verifies filesystem layout (/workspace, /config symlink)
  4. Verifies all services start and respond
  5. Verifies OpenCode project scanning works
  6. Verifies environment variables are set correctly
  7. Tears down

Usage:
  python3 test_sandbox_e2e.py              # Full e2e (build + run + test)
  python3 test_sandbox_e2e.py --no-build   # Skip build, use existing image
  python3 test_sandbox_e2e.py --keep       # Don't tear down container after tests

Requires: Docker
"""

import subprocess
import sys
import time
import json
import argparse
import os

IMAGE = "heyagi/sandbox:e2e-test"
# Resolve paths: build context = computer/, Dockerfile = computer/sandbox/Dockerfile
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
BUILD_CONTEXT = os.path.dirname(SCRIPT_DIR)  # computer/
DOCKERFILE = os.path.join(SCRIPT_DIR, "Dockerfile")
CONTAINER = "sandbox-e2e-test"
TIMEOUT = 120  # seconds to wait for services


class TestResult:
    def __init__(self):
        self.passed = 0
        self.failed = 0
        self.errors = []

    def ok(self, name):
        self.passed += 1
        print(f"  \033[32mPASS\033[0m {name}")

    def fail(self, name, detail=""):
        self.failed += 1
        self.errors.append((name, detail))
        print(f"  \033[31mFAIL\033[0m {name}")
        if detail:
            for line in detail.strip().split("\n"):
                print(f"       {line}")

    def summary(self):
        total = self.passed + self.failed
        print(f"\n{'='*60}")
        if self.failed == 0:
            print(f"\033[32mAll {total} tests passed.\033[0m")
        else:
            print(f"\033[31m{self.failed}/{total} tests failed:\033[0m")
            for name, detail in self.errors:
                print(f"  - {name}: {detail[:100]}")
        return self.failed == 0


def run(cmd, timeout=30):
    """Run a command and return (exit_code, stdout, stderr)."""
    try:
        result = subprocess.run(
            cmd, shell=True, capture_output=True, text=True, timeout=timeout
        )
        return result.returncode, result.stdout.strip(), result.stderr.strip()
    except subprocess.TimeoutExpired:
        return -1, "", "TIMEOUT"


def docker_exec(cmd, timeout=15):
    """Execute a command inside the running container.
    Uses list form to avoid local shell expansion of $VAR.
    The cmd string is passed directly to bash -c inside the container."""
    try:
        result = subprocess.run(
            ["docker", "exec", CONTAINER, "bash", "-c", cmd],
            capture_output=True, text=True, timeout=timeout,
        )
        return result.returncode, result.stdout.strip(), result.stderr.strip()
    except subprocess.TimeoutExpired:
        return -1, "", "TIMEOUT"


def docker_exec_as(user, cmd, timeout=15):
    """Execute a command inside the running container as a specific user."""
    try:
        result = subprocess.run(
            ["docker", "exec", "-u", user, CONTAINER, "bash", "-c", cmd],
            capture_output=True, text=True, timeout=timeout,
        )
        return result.returncode, result.stdout.strip(), result.stderr.strip()
    except subprocess.TimeoutExpired:
        return -1, "", "TIMEOUT"


def build_image():
    """Build the sandbox Docker image."""
    print("\n--- Building Docker image ---")
    code, out, err = run(
        f"docker build -t {IMAGE} -f {DOCKERFILE} {BUILD_CONTEXT}",
        timeout=600,
    )
    if code != 0:
        print(f"Build failed:\n{err}")
        sys.exit(1)
    print("Build complete.")


def start_container():
    """Start the sandbox container."""
    print("\n--- Starting container ---")
    # Kill any existing test container
    run(f"docker rm -f {CONTAINER}", timeout=10)

    code, _, err = run(
        f"docker run -d --name {CONTAINER} "
        f"--security-opt seccomp=unconfined "
        f"--shm-size 1g "
        f"-e PUID=1000 -e PGID=1000 -e TZ=Etc/UTC "
        f"-e OPENCODE_CONFIG_DIR=/opt/opencode "
        f"-e DISPLAY=:1 "
        f"-e LSS_DIR=/workspace/.lss "
        f"-e KORTIX_WORKSPACE=/workspace "
        f'-e OPENCODE_PERMISSION=\'{{"*":"allow"}}\' '
        f"{IMAGE}",
        timeout=30,
    )
    if code != 0:
        print(f"Failed to start container:\n{err}")
        sys.exit(1)

    print(f"Container {CONTAINER} started. Waiting for services...")
    time.sleep(20)  # Wait for s6-overlay to start all services


def stop_container():
    """Stop and remove the container."""
    print("\n--- Tearing down ---")
    run(f"docker rm -f {CONTAINER}", timeout=15)


# ─── Test Functions ──────────────────────────────────────────────────────────


def test_filesystem_layout(r: TestResult):
    """Verify /workspace exists and /config is a symlink to it."""
    print("\n--- Filesystem Layout ---")

    # /workspace exists and is a directory
    code, out, _ = docker_exec("test -d /workspace && echo 'yes' || echo 'no'")
    if out == "yes":
        r.ok("/workspace is a directory")
    else:
        r.fail("/workspace is a directory", f"got: {out}")

    # /config is a symlink to /workspace
    code, out, _ = docker_exec("readlink /config")
    if out == "/workspace":
        r.ok("/config is symlink to /workspace")
    else:
        r.fail("/config is symlink to /workspace", f"readlink returned: {out}")

    # WORKDIR is /workspace
    code, out, _ = docker_exec("pwd")
    if "/workspace" in out:
        r.ok("WORKDIR is /workspace")
    else:
        r.fail("WORKDIR is /workspace", f"pwd returned: {out}")

    # Key directories exist
    for d in [".kortix", ".lss", ".agent-browser", ".browser-profile", "presentations"]:
        code, out, _ = docker_exec(f"test -d /workspace/{d} && echo 'yes' || echo 'no'")
        if out == "yes":
            r.ok(f"/workspace/{d} exists")
        else:
            r.fail(f"/workspace/{d} exists")


def test_environment_variables(r: TestResult):
    """Verify key environment variables are set."""
    print("\n--- Environment Variables ---")

    expected = {
        "KORTIX_WORKSPACE": "/workspace",
        "OPENCODE_CONFIG_DIR": "/opt/opencode",
        "AGENT_BROWSER_PROFILE": "/workspace/.browser-profile",
        "AGENT_BROWSER_SOCKET_DIR": "/workspace/.agent-browser",
    }

    for var, expected_val in expected.items():
        code, out, _ = docker_exec(f"echo ${var}")
        if out == expected_val:
            r.ok(f"{var} = {expected_val}")
        else:
            r.fail(f"{var} = {expected_val}", f"got: '{out}'")


def test_services(r: TestResult):
    """Verify all services are running and responding."""
    print("\n--- Services ---")

    # OpenCode API (port 4096)
    for attempt in range(6):
        code, out, _ = docker_exec(
            "curl -sf -o /dev/null -w '%{http_code}' http://localhost:4096/project"
        )
        if out == "200":
            r.ok("OpenCode API (port 4096) responds 200")
            break
        if attempt < 5:
            time.sleep(5)
    else:
        r.fail("OpenCode API (port 4096) responds 200", f"HTTP {out}")

    # Kortix Master (port 8000)
    code, out, _ = docker_exec(
        "curl -sf http://localhost:8000/kortix/health"
    )
    if code == 0 and out:
        r.ok("Kortix Master (port 8000) health check")
    else:
        r.fail("Kortix Master (port 8000) health check", f"code={code}")

    # OpenCode Web UI (port 3111)
    code, out, _ = docker_exec(
        "curl -sf -o /dev/null -w '%{http_code}' http://localhost:3111"
    )
    if out == "200":
        r.ok("OpenCode Web UI (port 3111) responds 200")
    else:
        r.fail("OpenCode Web UI (port 3111) responds 200", f"HTTP {out}")

    # Agent Browser Viewer (port 9224)
    code, out, _ = docker_exec(
        "curl -sf -o /dev/null -w '%{http_code}' http://localhost:9224"
    )
    if out == "200":
        r.ok("Agent Browser Viewer (port 9224) responds 200")
    else:
        r.fail("Agent Browser Viewer (port 9224) responds 200", f"HTTP {out}")


def test_project_detection(r: TestResult):
    """Verify OpenCode project detection works for git repos in /workspace."""
    print("\n--- Project Detection ---")

    # Set up git config (needed for commits inside the container)
    docker_exec(
        "git config --global user.email test@test.com "
        "&& git config --global user.name Test"
    )

    # Create a test git repo inside /workspace
    docker_exec(
        "mkdir -p /workspace/test-project "
        "&& cd /workspace/test-project "
        "&& git init -q "
        "&& git commit --allow-empty -m init -q"
    )

    # Hit the project list endpoint — stock opencode returns the "global" project
    code, out, _ = docker_exec(
        "curl -sf http://localhost:4096/project"
    )
    if code != 0:
        r.fail("GET /project returns data", f"curl failed: code={code}")
        return

    try:
        data = json.loads(out)
    except json.JSONDecodeError:
        r.fail("GET /project returns valid JSON", f"got: {out[:200]}")
        return

    r.ok("GET /project returns valid JSON")

    # Verify that pointing the API at our test repo resolves it as a project
    # (uses x-opencode-directory header to tell the server which directory to use)
    code, out, _ = docker_exec(
        "curl -sf http://localhost:4096/project "
        "-H 'x-opencode-directory: /workspace/test-project'"
    )
    if code != 0:
        r.fail("GET /project with directory header", f"curl failed: code={code}")
    else:
        try:
            dir_data = json.loads(out)
            projects = dir_data if isinstance(dir_data, list) else []
            worktrees = [p.get("worktree", "") for p in projects if isinstance(p, dict)]
            if any("/workspace/test-project" in w for w in worktrees):
                r.ok("Project resolved for /workspace/test-project")
            else:
                r.fail(
                    "Project resolved for /workspace/test-project",
                    f"worktrees found: {worktrees}",
                )
        except json.JSONDecodeError:
            r.fail("GET /project with directory header returns JSON", f"got: {out[:200]}")

    # Verify the resolved project has a VCS type of "git"
    try:
        dir_data = json.loads(out)
        projects = dir_data if isinstance(dir_data, list) else []
        matched = [p for p in projects if isinstance(p, dict) and "/workspace/test-project" in p.get("worktree", "")]
        vcs_types = [p.get("vcs", "") for p in matched]
        if any(v == "git" for v in vcs_types):
            r.ok("Project detected as git repo (vcs=git)")
        elif matched:
            r.fail("Project detected as git repo (vcs=git)", f"vcs values: {vcs_types}")
        # else: already reported failure above, skip this check
    except (json.JSONDecodeError, UnboundLocalError):
        pass  # Already reported above

    # Clean up
    docker_exec("rm -rf /workspace/test-project")


def test_no_legacy_config_paths(r: TestResult):
    """Verify services aren't using /config directly (should resolve via symlink)."""
    print("\n--- Legacy Path Check ---")

    # Check that HOME is /workspace in the opencode process
    # Must read as user abc (UID 1000) since /proc/<pid>/environ is owner-readable only
    code, out, _ = docker_exec_as(
        "abc",
        "cat /proc/$(pgrep -f 'opencode serve' | head -1)/environ 2>/dev/null | tr '\\0' '\\n' | grep ^HOME="
    )
    if "HOME=/workspace" in out:
        r.ok("OpenCode process HOME=/workspace")
    elif "HOME=" in out:
        r.fail("OpenCode process HOME=/workspace", f"got: {out}")
    else:
        r.fail("OpenCode process HOME=/workspace", "could not read process env")


# ─── Main ────────────────────────────────────────────────────────────────────


def main():
    parser = argparse.ArgumentParser(description="Kortix Sandbox E2E Tests")
    parser.add_argument("--no-build", action="store_true", help="Skip Docker build")
    parser.add_argument("--keep", action="store_true", help="Don't remove container after tests")
    args = parser.parse_args()

    print("=" * 60)
    print("Kortix Sandbox E2E Test Runner")
    print("=" * 60)

    if not args.no_build:
        build_image()

    start_container()

    r = TestResult()
    try:
        test_filesystem_layout(r)
        test_environment_variables(r)
        test_services(r)
        test_project_detection(r)
        test_no_legacy_config_paths(r)
    finally:
        if not args.keep:
            stop_container()
        else:
            print(f"\n--- Container {CONTAINER} kept running ---")
            print(f"    docker exec -it {CONTAINER} bash")

    success = r.summary()
    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()

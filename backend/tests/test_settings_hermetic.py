"""The suite must not read a developer's .env.

CI never writes one, so any setting kept locally silently reconfigured the tests
away from the pipeline they exist to predict. That is the worst direction for the
error to point: the local run goes red on something CI is happy with, everyone
learns to ignore a red local suite, and a REAL local failure stops being visible.

Measured before the fix: `DIGEST_ENABLED=false` in the repo-root .env made
test_run_digests_due_gating fail locally and pass in CI.
"""
from __future__ import annotations

import os
import subprocess
import sys
import textwrap
from pathlib import Path

from app.config import Settings


def test_settings_do_not_read_a_dotenv_file():
    """The mechanism, pinned. Deleting the conftest line flips this."""
    assert os.environ.get("NEXUSBI_IGNORE_DOTENV") == "1"
    assert Settings.model_config["env_file"] is None


def test_the_opt_out_is_off_by_default():
    """The seam must not leak into normal runs — the app still reads .env.

    Asserted in a CHILD PROCESS with the variable cleared, because this one is
    a property of importing app.config afresh, and the parent already imported
    it with the opt-out on.
    """
    env = {k: v for k, v in os.environ.items() if k != "NEXUSBI_IGNORE_DOTENV"}
    script = textwrap.dedent(
        """
        from app.config import Settings
        print(Settings.model_config["env_file"])
        """
    )
    proc = subprocess.run(
        [sys.executable, "-c", script],
        capture_output=True, text=True, env=env,
        cwd=str(Path(__file__).resolve().parent.parent),
    )
    assert proc.returncode == 0, proc.stderr
    assert proc.stdout.strip() == "('.env', '../.env')"


def test_a_dotenv_value_cannot_reach_the_suite(tmp_path, monkeypatch):
    """End to end: a .env sitting where the app would find it changes nothing.

    Writes a real file with a value that differs from the code default and
    imports Settings against it, with the opt-out on. Without the opt-out this
    returns the file's value — which is exactly how the digest gate broke.
    """
    (tmp_path / ".env").write_text("DIGEST_HOUR_UTC=23\n", encoding="utf-8")
    monkeypatch.chdir(tmp_path)

    assert Settings().DIGEST_HOUR_UTC == 6, "the code default, not the file's"

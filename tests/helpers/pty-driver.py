"""PTY driver for CLI tests that need an interactive terminal.

Usage: python3 pty-driver.py <command> [args...]
Reads SR_PTY_KEYS as a JSON array of [marker, value] pairs; each value is
written to the PTY as soon as marker appears in the captured output.
Captured output is echoed verbatim on stdout. Exits with the child status.
"""

import json
import os
import pty
import select
import sys
import time

argv = sys.argv[1:]
interactions = json.loads(os.environ.get("SR_PTY_KEYS", "[]"))

pid, fd = pty.fork()
if pid == 0:
    os.execvp(argv[0], argv)

buf = b""
index = 0
deadline = time.time() + 120

while True:
    readable, _, _ = select.select([fd], [], [], 0.1)
    if readable:
        try:
            data = os.read(fd, 4096)
        except OSError:
            break
        if not data:
            break
        buf += data
        sys.stdout.buffer.write(data)
        sys.stdout.buffer.flush()
    while index < len(interactions) and interactions[index][0].encode("utf-8") in buf:
        os.write(fd, interactions[index][1].encode("utf-8"))
        index += 1
    done, _ = os.waitpid(pid, os.WNOHANG)
    if done:
        break
    if time.time() > deadline:
        os.kill(pid, 9)
        break

try:
    _, status = os.waitpid(pid, 0)
except ChildProcessError:
    status = 0
sys.exit(0 if os.WIFEXITED(status) and os.WEXITSTATUS(status) == 0 else 1)

import errno
import fcntl
import json
import os
import pathlib
import subprocess
import sys
import time

bun, cli, root = sys.argv[1:]
root = pathlib.Path(root)
results = {}
path = root / 'readonly-output'
path.write_bytes(b'untouched')
with path.open('rb') as out:
    try:
        os.write(out.fileno(), b'x')
        raise AssertionError('OS readonly calibration unexpectedly wrote')
    except OSError as error:
        assert error.errno == errno.EBADF
    child = subprocess.run([bun, cli, '--version'], stdout=out, stderr=subprocess.PIPE, timeout=7)
    results['readonly'] = {'exit': child.returncode, 'delivery_error': b'delivery failed' in child.stderr}
assert path.read_bytes() == b'untouched'
assert results['readonly'] == {'exit': 1, 'delivery_error': True}, results

read, write = os.pipe()
os.close(read)
child = subprocess.run([bun, cli, '--help'], stdout=write, stderr=subprocess.PIPE, timeout=7)
os.close(write)
results['epipe'] = {'exit': child.returncode, 'stderr_empty': child.stderr == b''}
assert results['epipe'] == {'exit': 0, 'stderr_empty': True}, results

read, write = os.pipe()
os.set_blocking(write, False)
try:
    while True:
        os.write(write, b'x' * 4096)
except BlockingIOError:
    pass
os.set_blocking(write, True)
start = time.monotonic()
try:
    child = subprocess.run([bun, cli, '--help'], stdout=write, stderr=subprocess.PIPE, timeout=7)
    results['blocked'] = {'exit': child.returncode, 'delivery_error': b'delivery failed' in child.stderr, 'bounded': time.monotonic() - start < 7}
finally:
    os.close(write)
    os.close(read)
assert results['blocked'] == {'exit': 1, 'delivery_error': True, 'bounded': True}, results
print(json.dumps(results))

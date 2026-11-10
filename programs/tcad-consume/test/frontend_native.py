"""Native public-entrypoint regressions. Run under OS outbound denial.
Requires Python 3 and BUN (absolute executable); all state stays in TMPDIR.
"""
import hashlib, json, os, pathlib, subprocess, tempfile, unittest
from typing import Any

CLI = pathlib.Path(__file__).resolve().parents[1] / "src/cli.ts"
PROGRAM = CLI.parents[1].name
BUN = os.environ["BUN"]

class Frontend(unittest.TestCase):
    def setUp(self):
        self.root = pathlib.Path(tempfile.mkdtemp(prefix=PROGRAM+"-frontend-", dir=os.environ["TMPDIR"]))
        self.cwd = self.root / "unrelated"; self.cwd.mkdir()
        self.env = os.environ.copy()
        for k in ["HOME", "XDG_CACHE_HOME", "XDG_CONFIG_HOME", "XDG_STATE_HOME", "TMPDIR"]:
            p = self.root / k; p.mkdir(); self.env[k] = str(p)
        self.receipts = []

    def tearDown(self):
        (self.root / "receipts.json").write_text(json.dumps(self.receipts, indent=2))

    def state(self):
        return {str(p.relative_to(self.root)):hashlib.sha256(p.read_bytes()).hexdigest()
                for p in self.root.rglob("*") if p.is_file() and p.name != "receipts.json"}

    def cli(self, *args, mode=None) -> dict[str, Any]:
        cmd = [BUN, str(CLI), *map(str,args)]
        before = self.state()
        if mode == "readonly":
            f = self.root / "readonly"; f.write_bytes(b"unchanged")
            with f.open("rb") as fd:
                p = subprocess.run(cmd, cwd=self.cwd, env=self.env, stdin=subprocess.DEVNULL,
                                   stdout=fd, stderr=subprocess.PIPE, timeout=15)
            out,err,status = b"",p.stderr,p.returncode
            self.assertEqual(f.read_bytes(), b"unchanged")
        elif mode == "slow":
            import threading, time
            rfd,wfd=os.pipe();os.set_blocking(wfd,False)
            chunks=[]
            def drain():
                time.sleep(.15)
                with os.fdopen(rfd,"rb") as reader:
                    while True:
                        chunk=reader.read(1024)
                        if not chunk: break
                        chunks.append(chunk);time.sleep(.0005)
            reader=threading.Thread(target=drain);reader.start()
            with os.fdopen(wfd,"wb") as fd:
                p=subprocess.run(cmd,cwd=self.cwd,env=self.env,stdin=subprocess.DEVNULL,
                                 stdout=fd,stderr=subprocess.PIPE,timeout=15)
            reader.join(15);self.assertFalse(reader.is_alive())
            out,err,status=b"".join(chunks),p.stderr,p.returncode
        elif mode == "pipe":
            r,w = os.pipe(); os.close(r)
            with os.fdopen(w,"wb") as fd:
                p = subprocess.run(cmd,cwd=self.cwd,env=self.env,stdin=subprocess.DEVNULL,
                                   stdout=fd,stderr=subprocess.PIPE,timeout=15)
            out,err,status = b"",p.stderr,p.returncode
        else:
            p = subprocess.run(cmd,cwd=self.cwd,env=self.env,stdin=subprocess.DEVNULL,
                               stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=15)
            out,err,status=p.stdout,p.stderr,p.returncode
        rec = dict(argv=cmd,cwd=str(self.cwd),stdout=out.decode(),stderr=err.decode(),status=status,
                   before=before,after=self.state(),mode=mode)
        self.receipts.append(rec)
        return rec

    def test_version_and_all_help(self):
        r=self.cli("--version")
        self.assertEqual((r["status"],r["stderr"]),(0,""),r)
        self.assertEqual(r["stdout"],PROGRAM+" 0.1.0\n")
        self.assertEqual(r["before"],r["after"])
        for command in ['list', 'import', 'inventory', 'integrity', 'status', 'verify', 'import-member', 'verify-members', 'member-status', 'layouts', 'inventory-members', 'discover', 'acquire', 'catalog', 'catalog-import']:
            for flag in ["--help","-h"]:
                r=self.cli(command,flag)
                self.assertEqual((r["status"],r["stderr"]),(0,""),r)
                self.assertIn("Usage: "+PROGRAM+" "+command,r["stdout"])
                self.assertEqual(r["before"],r["after"])
        r=self.cli("import","--unknown","--help")
        self.assertEqual(r["status"],0,r)
        r=self.cli("help","unknown")
        self.assertEqual(r["status"],1,r)

    def test_parser_diagnostics_and_context(self):
        for args,needle in [
            ([],"Usage:"),(["status"],"--output"),(["status","--output"],"--output"),
            (["status","--output="],"--output"),(["status","--output",""],"--output"),
            (["list","--wat"],"--wat"),(["lis"],"lis"),(["status","--out","x"],"--out"),
            (["status","--output","a","--output","b"],"--output"),
            (["status","--output","--help"],"--output"),
            (["status","--output=--help"],"absolute"),
            (["status","--","--help"],"operand"),(["list","--","--help"],"operand"),
            # Bun consumes a separator immediately after the script; double it to deliver one.
            (["--","--","--help"],"command"),(["--output","x","status"],"command"),
            (["list","-hv"],"-hv"),(["list","--help=yes"],"--help"),
        ]:
            r=self.cli(*args)
            self.assertEqual(r["status"],1,r)
            self.assertEqual(r["stdout"],"",r)
            self.assertIn(needle,r["stderr"],r)
            self.assertIn("Usage:",r["stderr"],r)
            self.assertEqual(r["before"],r["after"],r)
        r=self.cli("list","--")
        self.assertEqual(r["status"],0,r)
        self.assertEqual(r["stderr"],"")
        self.assertEqual(r["stdout"],json.dumps({'selection': '2026-certified-supp0-property-first25', 'rows': 25, 'network': False, 'coverage': 'partial first25 Property records'},separators=(",",":"))+"\n")
        root=self.root/"state"
        a=self.cli("status","--output",root)
        b=self.cli("status","--output="+str(root))
        self.assertEqual((a["status"],b["status"]),(0,0),(a,b))
        self.assertEqual(a["stdout"],b["stdout"])
        self.assertEqual(b["stderr"],"")

    def member_args(self, root):
        return ["import-member","--archive",str(self.root/"missing.zip"),"--snapshot","fixture","--member","X.TXT",
                "--start","1","--count","all","--max-expanded","4096","--max-seconds","2","--output",str(root)]

    def test_numeric_validation_is_pure(self):
        existing=self.root/"existing"
        self.assertEqual(self.cli("status","--output",existing)["status"],0)
        # Corrupt fixture policy and retain it: invalid frontend args must precede open/recovery.
        import sqlite3
        with sqlite3.connect(existing/"state.sqlite") as db: db.execute("DELETE FROM request_policy")
        for dest in [self.root/"nonexistent", existing]:
            for flag in ["--start","--count","--max-expanded","--max-seconds"]:
                for value in ["0","-1","NaN","1.5","9007199254740992",""]:
                    args=self.member_args(dest);args[args.index(flag)+1]=value
                    r=self.cli(*args)
                    self.assertEqual(r["status"],1,r); self.assertEqual(r["stdout"],"",r)
                    self.assertEqual(r["before"],r["after"],r)
            args=self.member_args(dest)
            args[args.index("--start")+1]="9007199254740991"
            args[args.index("--count")+1]="1"
            r=self.cli(*args);self.assertEqual(r["status"],1,r);self.assertEqual(r["before"],r["after"],r)
            for cmd in ["discover","acquire"]:
                for flag in ["--max-requests","--max-bytes"]:
                    for value in ["0","-1","NaN","1.5","9007199254740992"]:
                        args=[cmd,"--output",str(dest),"--max-requests","1","--max-bytes","4096"]
                        if cmd=="acquire":args += ["--id","fixture"]
                        args[args.index(flag)+1]=value
                        r=self.cli(*args);self.assertEqual(r["status"],1,r)
                        self.assertEqual(r["before"],r["after"],r)
            self.assertFalse((self.root/"nonexistent").exists())

    def test_private_operands_are_not_diagnostics(self):
        r=self.cli("list","private-record,sensitive-header,credential-value")
        self.assertEqual(r["status"],1,r)
        self.assertNotIn("private-record",r["stderr"])
        r=self.cli("list","--unknown=credential-value")
        self.assertIn("--unknown",r["stderr"])
        self.assertNotIn("credential-value",r["stderr"])
        r=self.cli("private-record,sensitive-header,credential-value")
        self.assertEqual(r["status"],1,r);self.assertNotIn("private-record",r["stderr"])
        r=self.cli("list","--private-record,sensitive-header,credential-value")
        self.assertEqual(r["status"],1,r);self.assertNotIn("private-record",r["stderr"])

    def test_catalog_large_output_and_member_workflows(self):
        import zipfile
        html=self.root/"catalog.html"
        html.write_text("".join('<a href="/wp-content/largefiles/f%d.zip">Fixture %d</a>'%(i,i) for i in range(1000)))
        root=self.root/"catalog"
        r=self.cli("catalog-import","--output",root,"--html",html,mode="readonly")
        self.assertEqual(r["status"],1,r)  # Domain checkpoint remains after delivery failure.
        r=self.cli("catalog","--output="+str(root),mode="slow")
        self.assertEqual((r["status"],r["stderr"]),(0,""),r)
        self.assertGreater(len(r["stdout"]),65536)
        catalog=json.loads(r["stdout"]);self.assertEqual(len(catalog),1000)
        self.assertEqual(set(catalog[0]),{"id","url","label","observed"})
        # String false remains a parsed boolean, never a truthy permission value (covered by native fixture suite).
        for extra in [["--refresh","yes"],["--refresh",""],["--refresh","true","--refresh","false"]]:
            r=self.cli("acquire","--output",root,"--id",catalog[0]["id"],"--max-requests","1","--max-bytes","4096",*extra)
            self.assertEqual(r["status"],1,r);self.assertEqual(r["before"],r["after"],r)
        z=self.root/"fixture.zip"
        with zipfile.ZipFile(z,"w") as archive:archive.writestr("X.TXT","one\ntwo\nthree\n")
        r=self.cli("inventory-members","--archive="+str(z))
        self.assertEqual(r["status"],0,r);self.assertEqual(json.loads(r["stdout"])["members"][0]["name"],"X.TXT")
        out=self.root/"members";args=self.member_args(out);args[args.index("--archive")+1]=str(z)
        args[args.index("--start")+1]="0x1";args[args.index("--max-expanded")+1]="1e4"
        r=self.cli(*args,mode="readonly");self.assertEqual(r["status"],1,r)
        r=self.cli("member-status","--output",out);self.assertEqual(r["status"],0,r)
        self.assertEqual(json.loads(r["stdout"])[0]["status"],"complete")
        r=self.cli(*args);self.assertEqual(r["status"],0,r)
        self.assertTrue(json.loads(r["stdout"])["reused"])
        r=self.cli("verify-members","--output",out);self.assertEqual(r["status"],0,r)
        self.assertEqual(json.loads(r["stdout"]),{"versions":1,"rows":3,"httpRequests":0})

    def interrupt_when_checkpoint_started(self, args, root, query):
        import signal, sqlite3, time
        from contextlib import closing
        # Observe private DELETE-journal fixture without taking reader locks from the writer.
        # Reopen every poll; transient/incomplete read images are ignored, never trusted as results.
        command=[BUN,str(CLI),*map(str,args)]
        p=subprocess.Popen(command,cwd=self.cwd,env=self.env,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
        started=False;deadline=time.monotonic()+5
        try:
            while p.poll() is None and time.monotonic()<deadline:
                try:
                    with closing(sqlite3.connect("file:"+str(root/"state.sqlite")+"?mode=ro&immutable=1",uri=True,timeout=.01)) as db:
                        started=bool(db.execute(query).fetchone())
                except sqlite3.Error: pass
                if started: break
                time.sleep(.001)
            if not started:
                if p.poll() is None:p.kill()
                out,err=p.communicate(timeout=5)
                self.receipts.append(dict(argv=command,stdout=out.decode(),stderr=err.decode(),status=p.returncode,checkpointStarted=False))
                self.fail("fixture did not reach active durable checkpoint: "+err.decode()+" output="+out.decode())
            now=time.monotonic();p.send_signal(signal.SIGINT)
            out,err=p.communicate(timeout=5)
            self.receipts.append(dict(argv=command,stdout=out.decode(),stderr=err.decode(),status=p.returncode,
                                      signal="SIGINT",checkpointStarted=started,secondsAfterSignal=time.monotonic()-now))
            self.assertEqual(p.returncode,-signal.SIGINT)
            self.assertEqual(out,b"")
            lock=root/".civicclerk.lock";self.assertTrue(lock.exists())
            before=lock.read_bytes();r=self.cli("status","--output",root)
            self.assertEqual(r["status"],1,r);self.assertIn("EEXIST",r["stderr"])
            self.assertEqual(lock.read_bytes(),before) # Never steal/remove the retained lock.
        finally:
            if p.poll() is None:p.kill()
            p.communicate(timeout=5)

    @unittest.skipUnless(os.name == "posix", "native SIGINT/status semantics require POSIX")
    def test_bounded_cancellation_retains_checkpoint_and_lock(self):
        import zipfile
        z=self.root/"cancel.zip"
        with zipfile.ZipFile(z,"w") as archive:archive.writestr("X.TXT",b"synthetic-line\n"*150000)
        root=self.root/"cancel"
        self.assertEqual(self.cli("status","--output",root)["status"],0)
        args=self.member_args(root)
        args[args.index("--archive")+1]=str(z);args[args.index("--max-expanded")+1]="4194304"
        self.interrupt_when_checkpoint_started(args,root,"SELECT id FROM member_versions WHERE status='importing'")

    def blocking_output(self, command, drain=False):
        import threading, time
        rfd,wfd=os.pipe()
        self.assertTrue(os.get_blocking(wfd))  # Ordinary inherited pipe; never O_NONBLOCK.
        chunks=[]
        def reader():
            time.sleep(.15)
            with os.fdopen(rfd,"rb") as stream:
                while True:
                    data=stream.read(8192)
                    if not data: break
                    chunks.append(data);time.sleep(.001)
        thread=threading.Thread(target=reader) if drain else None
        if thread:thread.start()
        started=time.monotonic();killed=False
        with os.fdopen(wfd,"wb") as stream:
            p=subprocess.Popen(command,cwd=self.cwd,env=self.env,stdin=subprocess.DEVNULL,stdout=stream,stderr=subprocess.PIPE)
            try:p.wait(timeout=12)
            except subprocess.TimeoutExpired:
                killed=True;p.kill();p.wait(timeout=2)
        elapsed=time.monotonic()-started
        assert p.stderr is not None
        err=p.stderr.read();p.stderr.close()
        if thread:
            thread.join(2);self.assertFalse(thread.is_alive())
        else:
            with os.fdopen(rfd,"rb") as stream:chunks.append(stream.read())
        out=b"".join(chunks)
        self.receipts.append(dict(argv=command,mode="blocking-drain" if drain else "blocking-undrained",status=p.returncode,
                                 seconds=elapsed,watchdogKilled=killed,stdoutBytes=len(out),stdoutSha256=hashlib.sha256(out).hexdigest(),stderr=err.decode()))
        self.assertFalse(killed,"external watchdog killed writer; native deadline failed")
        self.assertLess(elapsed,11.5)
        return p.returncode,out,err

    def test_blocking_pipe_deadline_and_exact_utf8(self):
        html=self.root/"blocking.html";root=self.root/"blocking-catalog"
        label="Unicode 雪🙂é "*30
        href="/wp-content/largefiles/f%d.zip" if PROGRAM=="tcad-consume" else "/voterdata/f%d.csv"
        html.write_text("".join('<a href="'+(href%i)+'">'+label+str(i)+'</a>' for i in range(1000)))
        imported=self.cli("catalog-import","--output",root,"--html",html)
        self.assertEqual((imported["status"],imported["stderr"]),(0,""))
        args=["catalog" if PROGRAM=="tcad-consume" else "list","--output",str(root)]
        expected=self.cli(*args)["stdout"].encode()
        self.assertGreater(len(expected),65536)
        before=self.state()
        status,out,err=self.blocking_output([BUN,str(CLI),*args])
        self.assertEqual(status,1);self.assertIn(b"ETIMEDOUT",err);self.assertNotIn(b"Bun v",err)
        self.assertEqual(before,self.state())  # Completed catalogs/checkpoints survive output timeout.
        status,out,err=self.blocking_output([BUN,str(CLI),*args],drain=True)
        self.assertEqual((status,err),(0,b""));self.assertEqual(out,expected)
        module=CLI.with_name("frontend.ts")
        text="雪🙂é"*300000
        code='import {writeOutput,nativeFailure as failure} from '+json.dumps(str(module))+'; await writeOutput("雪🙂é".repeat(300000)).catch(failure);'
        command=[BUN,"-e",code]
        status,out,err=self.blocking_output(command)
        self.assertEqual(status,1);self.assertIn(b"ETIMEDOUT",err);self.assertNotIn(b" | ",err)
        status,out,err=self.blocking_output(command,drain=True)
        self.assertEqual((status,err),(0,b""));self.assertEqual(out,text.encode())

    def test_readonly_stderr_controls(self):
        import errno
        f=self.root/"readonly-stderr";f.write_bytes(b"unchanged")
        for command,both,expected in [(["list"],False,0),(["unknown"],False,1),(["list"],True,1)]:
            with f.open("rb") as fd:
                with self.assertRaises(OSError) as fault:os.write(fd.fileno(),b"calibration")
                self.assertEqual(fault.exception.errno,errno.EBADF)
                p=subprocess.run([BUN,str(CLI),*command],cwd=self.cwd,env=self.env,stdin=subprocess.DEVNULL,
                                 stdout=fd if both else subprocess.PIPE,stderr=fd,timeout=12)
            self.assertEqual(p.returncode,expected);self.assertEqual(f.read_bytes(),b"unchanged")
            self.receipts.append(dict(argv=[BUN,str(CLI),*command],status=p.returncode,mode="both-readonly" if both else "stderr-readonly",stdout=(p.stdout or b"").decode()))
            if expected==0:json.loads(p.stdout)

    def test_checked_output(self):
        r=self.cli("list",mode="readonly")
        self.assertEqual(r["status"],1,r)
        self.assertIn("stdout",r["stderr"])
        self.assertIn("EBADF",r["stderr"])
        self.assertNotIn("at emit",r["stderr"])
        self.assertNotIn("Bun v",r["stderr"])
        r=self.cli("list",mode="pipe")
        self.assertEqual(r["status"],1,r)
        self.assertNotIn("Bun v",r["stderr"])
        self.assertNotIn(" | ",r["stderr"])

    def test_help(self):
        for args in [("--help",),("-h",),("help","list"),("list","--help"),("list","-h")]:
            r=self.cli(*args)
            self.assertEqual(r["status"],0,r)
            self.assertIn("Usage:",r["stdout"])
            self.assertIn(PROGRAM,r["stdout"])
            self.assertEqual(r["stderr"],"")
            self.assertEqual(r["before"],r["after"])

if __name__ == "__main__": unittest.main()

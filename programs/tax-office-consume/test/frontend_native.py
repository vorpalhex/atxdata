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
        for command in ['list', 'import', 'collect', 'status', 'verify', 'discover', 'catalog-import', 'import-export']:
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
        self.assertEqual(r["stdout"],json.dumps([{'selection': 'delinquency', 'csvBytes': 4194304, 'layoutBytes': 2097152, 'history': False}],separators=(",",":"))+"\n")
        root=self.root/"state"
        a=self.cli("status","--output",root)
        b=self.cli("status","--output="+str(root))
        self.assertEqual((a["status"],b["status"]),(0,0),(a,b))
        self.assertEqual(a["stdout"],b["stdout"])
        self.assertEqual(b["stderr"],"")

    def test_selection_conflicts_are_pure(self):
        existing=self.root/"existing"
        self.assertEqual(self.cli("status","--output",existing)["status"],0)
        for dest in [self.root/"nonexistent", existing]:
            for selector in ["--version","--catalog-version"]:
                for value in ["fixture","--help"]:
                    r=self.cli("collect","--output",dest,"--selection","delinquency","--max-rows","1",selector+"="+value)
                    self.assertEqual(r["status"],1,r);self.assertEqual(r["stdout"],"",r)
                    self.assertIn("catalog/version",r["stderr"])
                    self.assertEqual(r["before"],r["after"],r)
            self.assertFalse((self.root/"nonexistent").exists())
        for flag in ["--max-bytes","--max-rows","--max-requests","--max-total-bytes"]:
            for value in ["0","-1","NaN","1.5","1e2","9007199254740992",""]:
                r=self.cli("discover","--output",self.root/"nonexistent",flag+"="+value)
                self.assertEqual(r["status"],1,r);self.assertEqual(r["stdout"],"",r)
                self.assertEqual(r["before"],r["after"],r)

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

    def test_catalog_large_output_and_retained_version_selectors(self):
        html=self.root/"catalog.html"
        html.write_text("".join('<a href="/voterdata/fixture%d.csv">Fixture %d CSV</a>'%(i,i) for i in range(1000)))
        root=self.root/"catalog"
        r=self.cli("catalog-import","--output",root,"--html",html,mode="readonly")
        self.assertEqual(r["status"],1,r)
        r=self.cli("list","--output="+str(root),mode="slow")
        self.assertEqual((r["status"],r["stderr"]),(0,""),r)
        self.assertGreater(len(r["stdout"]),65536)
        catalog=json.loads(r["stdout"]);self.assertEqual(len(catalog["items"]),1000)
        self.assertEqual(set(catalog),{"version","items","observations"})
        file=self.root/"fixture.csv";file.write_text("SyntheticHeader\nSyntheticValue\n")
        selected=catalog["items"][0]["id"]
        args=["import-export","--output",root,"--selection",selected,"--file",file,"--catalog-version",catalog["version"]]
        r=self.cli(*args,mode="readonly");self.assertEqual(r["status"],1,r)
        r=self.cli("list","--output",root);self.assertEqual(r["status"],0,r)
        observation=json.loads(r["stdout"])["observations"][0]
        version=observation["version"];self.assertEqual(observation["status"],"complete")
        for selectors in [["--version",version],["--version="+version,"--catalog-version="+catalog["version"]],["--catalog-version",catalog["version"]]]:
            r=self.cli("collect","--output",root,"--selection",selected,*selectors)
            self.assertEqual((r["status"],r["stderr"]),(0,""),r)
            data=json.loads(r["stdout"])
            self.assertEqual(data["version"],version);self.assertTrue(data["reused"])
            self.assertIsNone(data["rows"]);self.assertEqual(data["profile"],"raw-original")
        for extra in [["--refresh=false"],["--refresh","false"],["--refresh","--refresh"]]:
            r=self.cli("collect","--output",root,"--selection",selected,*extra)
            self.assertEqual(r["status"],1,r);self.assertEqual(r["before"],r["after"],r)
        # Bare refresh reaches the retained-version conflict, not a missing-value parser error.
        for dest in [self.root/"nonexistent",root]:
            r=self.cli("collect","--output",dest,"--selection",selected,"--version",version,"--refresh")
            self.assertEqual(r["status"],1,r);self.assertIn("retained version",r["stderr"])
            self.assertEqual(r["before"],r["after"],r)
        r=self.cli("verify","--output",root)
        self.assertEqual(r["status"],0,r);self.assertEqual(json.loads(r["stdout"])["exports"],1)

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
        root=self.root/"cancel";html=self.root/"cancel.html"
        html.write_text('<a href="/voterdata/fixture.csv">Fixture CSV</a>')
        self.assertEqual(self.cli("catalog-import","--output",root,"--html",html)["status"],0)
        file=self.root/"cancel.csv"
        with file.open("wb") as f:
            for _ in range(32):f.write(b"synthetic-data\n"*65536)
        args=["import-export","--output",root,"--selection","/voterdata/fixture.csv","--file",file]
        self.interrupt_when_checkpoint_started(args,root,"SELECT id FROM snapshots WHERE status='collecting'")

    def test_checked_output(self):
        r=self.cli("list",mode="readonly")
        self.assertEqual(r["status"],1,r)
        self.assertIn("stdout",r["stderr"])
        self.assertIn("EBADF",r["stderr"])
        self.assertNotIn("at emit",r["stderr"])
        self.assertNotIn("Bun v",r["stderr"])
        r=self.cli("list",mode="pipe")
        self.assertEqual(r["status"],0,r)
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

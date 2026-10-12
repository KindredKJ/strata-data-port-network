#!/usr/bin/env python3
"""Prepare disposable guests from an explicit Alpine initramfs and host Node."""
import argparse, pathlib, re, shutil, subprocess
parser=argparse.ArgumentParser()
parser.add_argument("--initramfs",required=True)
parser.add_argument("--busybox",required=True)
parser.add_argument("--cpio",default="cpio")
parser.add_argument("--node",default=shutil.which("node"))
parser.add_argument("--out",required=True)
args=parser.parse_args()
root=pathlib.Path(args.out).resolve()
if root.exists() and any(root.iterdir()): raise SystemExit("Guest output must be empty")
root.mkdir(parents=True,exist_ok=True)
data=subprocess.run(["gzip","-dc",args.initramfs],capture_output=True,check=True).stdout
subprocess.run([args.cpio,"--no-preserve-owner","-idm","--quiet"],cwd=root,input=data,check=True)
shutil.copy2(args.busybox,root/"bin/busybox")
(root/"usr/bin").mkdir(parents=True,exist_ok=True)
shutil.copy2(args.node,root/"usr/bin/node")
for line in subprocess.check_output(["ldd",args.node],text=True).splitlines():
    for source in re.findall(r"(/[\w./+-]+)",line):
        if pathlib.Path(source).is_file():
            target=root/source.lstrip("/")
            target.parent.mkdir(parents=True,exist_ok=True)
            if target.is_symlink(): target.unlink()
            shutil.copy2(source,target)
for name in ("proc","sys","dev","tmp","run"): (root/name).mkdir(exist_ok=True)

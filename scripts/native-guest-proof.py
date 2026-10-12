#!/usr/bin/env python3
"""Execute a sandboxed native DOM proof in a disposable Linux guest; no uplink."""
import argparse, hashlib, json, os, pathlib, re, shutil, subprocess, tempfile
parser=argparse.ArgumentParser()
for name in ("base-guest","kernel","qemu","firmware","bios","out"):parser.add_argument("--"+name,required=True)
args=parser.parse_args()
repo=pathlib.Path(__file__).resolve().parents[1]
out=pathlib.Path(args.out).resolve();out.mkdir(parents=True,exist_ok=True)
private=pathlib.Path(tempfile.mkdtemp(prefix="kindred-native-guest-"))
try:
    root=private/"root"
    shutil.copytree(args.base_guest,root,symlinks=True)
    binaries=["/usr/bin/python3.12","/usr/bin/bwrap","/usr/bin/dbus-daemon","/usr/bin/dbus-run-session",
              "/usr/bin/timeout","/usr/bin/Xvfb","/usr/bin/xkbcomp","/usr/bin/xdg-dbus-proxy",
              "/usr/lib/x86_64-linux-gnu/libEGL_mesa.so.0","/usr/lib/x86_64-linux-gnu/libGLX_mesa.so.0",
              "/usr/lib/x86_64-linux-gnu/dri/swrast_dri.so"]
    folders=["/usr/lib/python3.12","/usr/lib/python3/dist-packages/gi",
             "/usr/lib/x86_64-linux-gnu/girepository-1.0","/usr/lib/x86_64-linux-gnu/webkit2gtk-4.1",
             "/usr/share/X11/xkb","/usr/share/fonts","/usr/share/dbus-1","/usr/share/glib-2.0/schemas",
             "/etc/fonts","/etc/dbus-1","/usr/share/glvnd/egl_vendor.d"]
    copied=[]
    def copy_file(source):
        target=root/source.lstrip("/")
        if target.is_symlink():target.unlink()
        if target.exists():return
        target.parent.mkdir(parents=True,exist_ok=True)
        shutil.copy2(source,target)
        copied.append(source)
    for binary in binaries:copy_file(binary)
    for folder in folders:
        shutil.copytree(folder,root/folder.lstrip("/"),symlinks=True,dirs_exist_ok=True)
    # Resolve every native GI/WebKit dependency, including dependencies of dependencies.
    pending=binaries+[str(p) for folder in folders[:4] for p in pathlib.Path(folder).rglob("*")
        if p.is_file() and (".so" in p.name or os.access(p,os.X_OK))]
    seen=set()
    while pending:
        source=pending.pop()
        if source in seen:continue
        seen.add(source)
        try:data=subprocess.check_output(["ldd",source],stderr=subprocess.DEVNULL,text=True)
        except subprocess.CalledProcessError:continue
        if "not found" in data:raise RuntimeError("Unresolved native library dependency")
        for lib in re.findall(r"(/[\w./+-]+)",data):
            if pathlib.Path(lib).is_file():
                copy_file(lib);pending.append(lib)
    shutil.copytree(repo/"interconnect",root/"app/interconnect",dirs_exist_ok=True)
    for name in ("root","proc","sys","dev","tmp","run"):(root/name).mkdir(exist_ok=True)
    (root/"etc/passwd").write_text("root:x:0:0:Controlled guest:/root:/bin/sh\n")
    (root/"etc/group").write_text("root:x:0:\n")
    init="""#!/bin/busybox sh
export PATH=/bin:/usr/bin:/sbin:/usr/sbin
if [ ! -e /kindred-switched ]; then
  /bin/busybox --install -s /bin
  mkdir -p /newroot
  mount -t tmpfs -o size=1500m tmpfs /newroot
  cp -a /bin /usr /lib /lib64 /sbin /etc /root /app /init /newroot/
  mkdir -p /newroot/proc /newroot/sys /newroot/dev /newroot/tmp /newroot/run
  touch /newroot/kindred-switched
  exec switch_root /newroot /init
fi
/bin/busybox --install -s /bin
mount -t proc proc /proc
mount -t sysfs sysfs /sys
mount -t devtmpfs devtmpfs /dev
mount -t tmpfs -o size=256m tmpfs /tmp
mkdir -p /dev/shm
mount -t tmpfs -o size=128m tmpfs /dev/shm
ifconfig lo up
export HOME=/root
export LD_LIBRARY_PATH=/usr/lib/x86_64-linux-gnu
export PYTHONPATH=/usr/lib/python3/dist-packages
export GI_TYPELIB_PATH=/usr/lib/x86_64-linux-gnu/girepository-1.0
Xvfb :99 -screen 0 1100x760x24 >/tmp/xvfb.log 2>&1 &
export DISPLAY=:99
export LIBGL_ALWAYS_SOFTWARE=1
sleep 2
WEBKIT_DISABLE_DMABUF_RENDERER=1 timeout 150 dbus-run-session -- /usr/bin/python3.12 /app/interconnect/browser.py --smoke-output /tmp/native.json
echo NATIVE_EXIT=$?
echo NATIVE_RESULT_BEGIN
cat /tmp/native.json
echo NATIVE_RESULT_END
poweroff -f
"""
    (root/"init").write_text(init);(root/"init").chmod(0o755)
    image=private/"native.cpio"
    with image.open("wb") as stream:
        files=subprocess.check_output(["find",".","-print0"],cwd=root)
        subprocess.run(["cpio","--null","-o","-H","newc","--quiet"],cwd=root,input=files,stdout=stream,check=True)
    command=[args.qemu,"-L",args.firmware,"-bios",args.bios,"-machine","q35,accel=tcg","-m","3072","-smp","2",
        "-nodefaults","-no-reboot","-nographic","-serial","stdio","-monitor","none","-nic","none",
        "-kernel",args.kernel,"-initrd",str(image),"-append","console=ttyS0 quiet panic=-1"]
    with (out/"guest.log").open("wb") as log:
        process=subprocess.Popen(command,stdout=log,stderr=subprocess.STDOUT)
        try:process.wait(timeout=300)
        except subprocess.TimeoutExpired:process.kill();process.wait();raise
    text=(out/"guest.log").read_text(errors="replace")
    if "NATIVE_EXIT=0" not in text:raise RuntimeError("Native guest render failed; inspect retained log")
    body=text.split("NATIVE_RESULT_BEGIN",1)[1].split("NATIVE_RESULT_END",1)[0].strip()
    result=json.loads(body)
    if not result["subprocess_sandbox_enabled"] or not result["ephemeral_profile"] or result["native_dom_heading"]!="INTERCONNECT":
        raise RuntimeError("Native proof boundary rejected")
    result.update(classification="NATIVE_WEBKIT_QEMU_GUEST_X11_SOFTWARE_PROOF",
        kernelSha256=hashlib.sha256(pathlib.Path(args.kernel).read_bytes()).hexdigest(),
        browserSourceSha256=hashlib.sha256((repo/"interconnect/browser.py").read_bytes()).hexdigest(),
        logSha256=hashlib.sha256((out/"guest.log").read_bytes()).hexdigest())
    (out/"native-render.json").write_text(json.dumps(result,indent=2)+"\n")
    print("INTERCONNECT_NATIVE_SANDBOXED_DOM_PASS")
finally:shutil.rmtree(private)

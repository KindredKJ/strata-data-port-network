#!/usr/bin/env python3
"""Runs two actual QEMU guests on one host. Assets are explicit local dependencies."""
import argparse, hashlib, json, os, pathlib, re, shutil, subprocess, tempfile, time
from datetime import datetime, timezone

parser=argparse.ArgumentParser()
parser.add_argument("--qemu",required=True)
parser.add_argument("--firmware",required=True)
parser.add_argument("--bios",required=True)
parser.add_argument("--kernel",required=True)
parser.add_argument("--guest-root",required=True,help="Prepared Linux initramfs tree with modules, static busybox, Node and libraries")
parser.add_argument("--cpio",required=True)
parser.add_argument("--out",required=True)
args=parser.parse_args()
repo=pathlib.Path(__file__).resolve().parents[1]
out=pathlib.Path(args.out).resolve();out.mkdir(parents=True,exist_ok=True)
private=pathlib.Path(tempfile.mkdtemp(prefix="kindred-private-vm-"))
processes=[]
def digest(path): return hashlib.sha256(pathlib.Path(path).read_bytes()).hexdigest()
try:
    pairing=os.urandom(32).hex()
    for role,address in [("receiver","10.77.0.2"),("sender","10.77.0.1")]:
        root=private/role
        shutil.copytree(args.guest_root,root,symlinks=True)
        (root/"app/src").mkdir(parents=True,exist_ok=True)
        (root/"app/scripts").mkdir(parents=True,exist_ok=True)
        (root/"run").mkdir(exist_ok=True)
        (root/"run/pairing-secret").write_text(pairing)
        (root/"run/pairing-secret").chmod(0o600)
        shutil.copy2(repo/"src/two-machine-proof.mjs",root/"app/src")
        shutil.copy2(repo/"scripts/two-vm-guest.mjs",root/"app/scripts")
        init=f"""#!/bin/busybox sh
export PATH=/bin:/usr/bin:/sbin:/usr/sbin
/bin/busybox --install -s /bin
mount -t proc proc /proc
mount -t sysfs sysfs /sys
mount -t devtmpfs devtmpfs /dev
hostname kindred-sw06f-{role}
modprobe virtio_pci
modprobe virtio_net
ifconfig lo up
ifconfig eth0 {address} netmask 255.255.255.0 up
echo VM_KERNEL_READY
/usr/bin/node /app/scripts/two-vm-guest.mjs {role}
code=$?
echo VM_EXIT_CODE=$code
poweroff -f
"""
        (root/"init").write_text(init);(root/"init").chmod(0o755)
        image=private/(role+".cpio")
        with image.open("wb") as stream:
            paths=subprocess.run(["find",".","-print0"],cwd=root,capture_output=True,check=True).stdout
            subprocess.run([os.path.abspath(args.cpio),"--null","-o","-H","newc","--quiet"],cwd=root,input=paths,stdout=stream,check=True)
        mac="52:54:00:77:00:"+("02" if role=="receiver" else "01")
        net="socket,id=net0,listen=127.0.0.1:49770" if role=="receiver" else "socket,id=net0,connect=127.0.0.1:49770"
        command=[args.qemu,"-L",args.firmware,"-bios",args.bios,"-machine","q35,accel=tcg","-m","768","-smp","2",
            "-nodefaults","-no-reboot","-nographic","-serial","stdio","-monitor","none",
            "-kernel",args.kernel,"-initrd",str(image),"-append","console=ttyS0 quiet panic=-1",
            "-netdev",net,"-device",f"virtio-net-pci,netdev=net0,mac={mac},romfile=",
            "-object",f"filter-dump,id=capture,netdev=net0,file={out/(role+'.pcap')}"]
        log=(out/(role+".log")).open("wb")
        proc=subprocess.Popen(command,stdout=log,stderr=subprocess.STDOUT)
        processes.append((proc,log))
        if role=="receiver":
            deadline=time.monotonic()+120
            while time.monotonic()<deadline:
                if proc.poll() is not None: raise RuntimeError("Receiver VM exited before readiness")
                if "VM_RECEIVER_READY" in (out/"receiver.log").read_text(errors="replace"): break
                time.sleep(0.2)
            else: raise TimeoutError("Receiver VM readiness timed out")
    sender=processes[-1][0]
    sender.wait(timeout=300)
    # Stop all writers before hashing captured evidence.
    for proc,log in processes:
        if proc.poll() is None:
            proc.terminate()
            try: proc.wait(timeout=5)
            except subprocess.TimeoutExpired: proc.kill();proc.wait()
        log.flush()
    text=(out/"sender.log").read_text(errors="replace")
    match=re.search(r"VM_PROOF_RESULT (.+)",text)
    if not match or "VM_EXIT_CODE=0" not in text: raise RuntimeError("Sender VM proof failed")
    identities={}
    for role in ("sender","receiver"):
        log=(out/(role+".log")).read_text(errors="replace")
        identities[role]=json.loads(re.search(r"VM_IDENTITY (.+)",log).group(1))
    if identities["sender"]["bootId"]==identities["receiver"]["bootId"]: raise RuntimeError("Guest boot IDs are not independent")
    result=json.loads(match.group(1))
    receiver_text=(out/"receiver.log").read_text(errors="replace")
    receiver_envelopes=[json.loads(x) for x in re.findall(r"VM_RECEIVER_ENVELOPE (.+)",receiver_text)]
    sender_envelope=json.loads(re.search(r"VM_SENDER_ENVELOPE (.+)",text).group(1))
    if len(receiver_envelopes)!=len(result["receipts"]): raise RuntimeError("Reciprocal receipt count mismatch")
    for signed,receipt in zip(receiver_envelopes,result["receipts"]):
        body=json.loads(signed["payloadJson"])
        if body["receipt"]!=receipt or body["identity"]!=identities["receiver"]:
            raise RuntimeError("Receiver receipt/identity mismatch")
    verifier="""const fs=require('node:fs'),crypto=require('node:crypto');
for(const e of JSON.parse(fs.readFileSync(0,'utf8'))){
if(e.issuer!=='EPHEMERAL_GUEST_TEST_RUNNER_NOT_FOUNDER_AUTHORITY')process.exit(1);
const key=crypto.createPublicKey({key:Buffer.from(e.publicKeySpkiBase64,'base64'),format:'der',type:'spki'});
if(!crypto.verify(null,Buffer.from(e.payloadJson),key,Buffer.from(e.signatureBase64,'base64')))process.exit(1);
}"""
    subprocess.run(["node","-e",verifier],input=json.dumps(receiver_envelopes+[sender_envelope]).encode(),check=True)
    result.update(observedAt=datetime.now(timezone.utc).isoformat(),identities=identities,
        receiverEnvelopes=receiver_envelopes,senderEnvelope=sender_envelope,reciprocalSignaturesVerified=True,
        kernelSha256=digest(args.kernel),transportSourceSha256=digest(repo/"src/two-machine-proof.mjs"),
        topology="Two QEMU TCG guests; distinct kernels/boot IDs/MACs; host-local socket link; no NAT/uplink",
        artifacts={p.name:digest(p) for p in out.iterdir()
            if p.is_file() and p.name in {"sender.log","receiver.log","sender.pcap","receiver.pcap"}})
    (out/"run.json").write_text(json.dumps(result,indent=2)+"\n")
    exported=out/"sender-receipts";exported.mkdir(exist_ok=True)
    for index,receipt in enumerate(result["receipts"]):
        (exported/(str(index).zfill(3)+".json")).write_text(json.dumps(receipt,indent=2)+"\n")
    print("TWO_VM_NETWORK_PROOF_PASS")
finally:
    for proc,log in processes:
        if proc.poll() is None:
            proc.terminate()
            try: proc.wait(timeout=5)
            except subprocess.TimeoutExpired: proc.kill();proc.wait()
        log.close()
    shutil.rmtree(private)

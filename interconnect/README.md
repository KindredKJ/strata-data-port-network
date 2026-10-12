# INTERCONNECT native proof

Founder: Kindred Jermaine Cox / Kindred Labs. Existing proprietary SDPN license applies.

This separate additive Linux native proof uses GTK 3 and WebKitGTK 4.1.
Chromium, Blink, Electron and CEF are not used. It does not replace the Strata
Portal, encrypted file workspace, Port Zero or existing component identities.

Install the distribution packages: `python3-gi gir1.2-webkit2-4.1`.
Run `python3 interconnect/browser.py` for an ephemeral, network-blocked profile.
`--network` opts that session into public HTTPS navigation; script execution remains
disabled in this proof. Back/forward/reload and native receipt-file inspection work
without embedding founder credentials. Camera, microphone, location, downloads,
popups, agents and private-port execution are denied.

WebKit subprocess sandboxing is required. The application refuses a sandbox-disable
environment override; it must not be bypassed to make a constrained CI run pass.
Linux user namespaces/mount permissions and a graphical display are required.
This is not a Windows/macOS/Android distribution or a production browser release.

`python3 -m unittest discover -s interconnect/tests -v` validates policy and the
offline receipt parser. Offline metadata checks alone do not verify a receipt MAC,
payload bytes, remote host identity, physical execution or production authority.
The parser can accept an explicitly supplied local secret and payload path for
MAC/hash verification; the GUI intentionally performs metadata inspection only.

The two-VM runner exports each authenticated transfer receipt under
`evidence/two-vm/<run>/sender-receipts/`. Choose one of those JSON files in the
native inspector. The parent `run.json` contains reciprocal guest signatures
and topology evidence; it is a separate proof package, not a transfer receipt.

The native CI gate retains a WebKit pixel-render snapshot, exact pixel hash,
ephemeral-profile state and enabled sandbox state. The controlled QEMU test uses
an X11 software renderer; it does not establish GPU performance or full web
compatibility. Page JavaScript stays disabled during the snapshot.

No sync, remote index, search service or live Port Zero authority is impersonated.
Follow ADR 0001/0002 for later approved capability integrations.

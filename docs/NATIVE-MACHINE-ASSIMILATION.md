# SDPN native machine assimilation — installer bootstrap v1

Every non-founder Port inherits the machine's **actual local capabilities** as
the SDPN runtime discovers them. It does not impersonate another port, acquire
Port 0's founder authority, install a physical connection or create an IP router.

## Automatic installation behavior

When the Windows `Install-SDPNPortProtocol.ps1` operator installer successfully
registers `port://`, it also runs `scripts/assimilate-native-host.mjs`.
Windows port:// handler registration remains per-user and never claims to
replace TCP/IP or the standard browser protocol handlers.

For any OS installer using this repository, the complete bootstrap command is:

```bash
npm run port:install
```

Once installed, refresh after connecting drives or installing new applications:

```bash
npm run port:assimilate
```

The installer runs the same assimilation logic. Integrators targeting Android,
Linux, macOS and iOS should invoke this bootstrap from their native
installation/onboarding workflow. Automatic startup/rescan is **not**
yet integrated into all those platform packages. A stock iOS app cannot
scan other apps' sandboxes or invoke arbitrary native programs.

## What is actually assimilated

The public `assimilateInstalledHost()` API combines:
- **Storage:** OS-visible mounted volumes, available capacity, readable
  directory roots; no file content collection or drive-letter reassignment.
- **Runtime:** OS, architecture, CPU thread count, installed RAM.
- **Executables:** OS-executable programs in process PATH, with resolved paths,
  bounded local entries and stable content-independent capability IDs.
- **Installed applications:** Windows registry + installed AppX packages;
  Linux installed package managers (dpkg, rpm, Flatpak, Snap);
  macOS application inventory; Android OS package manager where accessible.
- **Device classes:** Windows Plug and Play devices; Linux sysfs device
  classes; macOS system_profiler when permitted. Android's restricted
  native system APIs require a companion Android-specific adapter.
- **Services:** Windows Services, systemd units, launchd services,
  where the OS provider is available.

The local report is saved as:
`~/.sdpn/machine-capabilities.v1.json`.

It contains inventory data, which may be sensitive. Keep it in the owner's
private device directory. The tool does not upload this information, register
any outside service or send telemetry. The CLI prints a compact inventory
summary unless `--json` is explicitly requested.

### Local authority and executable binding

Only **Port 0** is founder-authoritative. All other ports retain their
independent `regular` and `admin` roles on **their own Port only**.

The `NativeHostCapabilityBridge` exposes `discover()` and `invoke()`.
A valid **same-Port local admin** grant and a deliberately selected, local executable
capability ID are required to invoke an installed utility. Regular Port roles may
inspect capabilities, but cannot launch arbitrary installed binaries. A program launch
uses direct OS process execution, **not an SDPN network route**.
OS permissions remain in effect. A discovered application or PnP device
is not automatically a working API or driver; OS-native device
adapters must implement and test the actual capabilities before use.

Drivers and utilities may themselves use the host OS networking stack.
Discovering or launching them does **not** imply that their internal
operations are route-free. The separate native SDPN coordination
path only qualifies under the strict non-IP/non-routed adapter policy,
and there is no global physical propagation claim.

## Platform realities

| Platform | Current discovery path | Remaining integration work |
|---|---|---|
| Windows | Logical drives, PATH binaries, installed software, PnP and services | Native WinRT/COM, GPU, Bluetooth and application-specific adapters |
| Linux | Mounts, executables, sysfs device classes, packages, systemd | Actual kernel/udev, GPU, Bluetooth and permission-aware driver binds |
| Android | Termux-accessible runtime, Android package manager if permitted | Android SDK/NDK bridge, package visibility and runtime permissions |
| macOS | Mounts, POSIX programs, system_profiler, launchd | Swift/Objective-C platform and entitlement bindings |
| iOS | App's own sandbox only under supported platform API permissions | Swift-native app capabilities; no cross-app or system-wide scan |

No program claims admin rights merely because the local port has a
Port-level `admin` role. An OS/system administrator still controls
device- and app-level permissions.

## Verification

```bash
node --test test/native-host-capability-bridge.test.mjs test/native-host-assimilation.test.mjs
npm test
```

Tests should exercise an actual host inventory and local manifest write.
These are OS-backed checks on the CI runner, **not** proof of installed
device hardware drivers across every consumer operating system.

Next gates: durable Port-to-local-manifest binding; live changes via OS
device notifications; native API drivers for GPUs, storage and peripherals;
a first signed Port A/Port B Tesseract materialization using distinct
physical devices; independently measured route-free physical substrate,
and a real globally accessible presence service.

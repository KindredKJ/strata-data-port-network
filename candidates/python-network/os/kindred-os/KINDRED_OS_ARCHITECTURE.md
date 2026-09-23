# Kindred OS Architecture

Kindred OS is a canonical Kindred Labs system with multiple implementation tracks.

## 1. Hosted Runtime

The current governed runtime, event system, identity, permissions, approvals,
audit, recovery, orchestration, and host-integration layer. It runs above an
existing host operating system such as Windows or Linux.

## 2. Bootable Distribution

A future self-contained distribution that can boot through approved firmware or
a virtual machine. This track must not be claimed complete until reproducible
boot, storage, networking, recovery, and hardware tests exist.

## 3. Kernel Research

Custom operating-system research, including the existing 32-bit x86
protected-mode KindredOS prototype. Preserve its source, boot media, QEMU
configuration, rollback snapshots, filesystem experiments, and test evidence.

## Adjacent Systems

- Kindred BIOS: secure UEFI boot orchestration, recovery, diagnostics, founder
  identity, vault loading, and Kindred OS startup control.
- KindredVM: portable autonomous computing environment and virtualization layer.

## External Drive Policy

The D: volume remains an NTFS working and preservation volume. Store source,
ISO images, VHD/VHDX images, manifests, and test artifacts here. Do not convert
the entire volume into a boot disk during initial Superstructure construction.
Any future bootable layout requires a separate reviewed partitioning and backup
plan.


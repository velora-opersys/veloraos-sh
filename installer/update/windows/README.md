# VeloraOS Windows update channel

Windows uses a separate update manifest from the Linux shell updater.

The VeloraOS Windows server checks:

`https://raw.githubusercontent.com/velora-opersys/veloraos-sh/main/installer/update/windows/latest.json`

Large `VeloraOS-Setup-<version>.exe` packages must be attached to a GitHub Release in this repository. The manifest points to the GitHub Release asset and includes its SHA-256 checksum.

## Publish order

1. Build `VeloraOS-Setup-<version>.exe` from the `veloraos-web` Windows build workflow.
2. Test the installer on Windows 11, Windows Server 2022 and Windows Server 2025.
3. Code-sign the installer for production distribution.
4. Create a GitHub Release/tag and attach the installer.
5. Calculate the final signed installer SHA-256.
6. Create `installer/update/windows/latest.json` from `latest.example.json` using the final release URL and checksum.
7. Publish `latest.json` last.

Publishing the manifest last prevents installed Windows systems from discovering a release whose installer is not available yet.

## Manifest shape

```json
{
  "version": "1.16.0",
  "packageUrl": "https://github.com/velora-opersys/veloraos-sh/releases/download/windows-v1.16.0/VeloraOS-Setup-1.16.0.exe",
  "sha256": "<64 lowercase hex characters>",
  "title": "VeloraOS 1.16.0 for Windows",
  "publishedAt": "2026-08-07T21:02:00Z",
  "releaseNotes": ["Windows release note"],
  "rebootRequired": false
}
```

The Windows updater allowlists the `velora-opersys/veloraos-sh` GitHub Releases path and independently verifies the SHA-256 before starting an installer.

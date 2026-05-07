# Dynamic Analysis & Windows Emulation — How We Watch Malware Run

## The Core Idea

There are two ways to study a suspicious program:

**Static analysis** — read the file without running it. Look at the code, the strings, the imported functions. Fast and safe, but easily defeated by obfuscation (deliberately scrambling the code so it is unreadable).

**Dynamic analysis** — actually run the program and watch what it does. Because you are watching *behavior*, not bytes, obfuscation does not help the attacker. A ransomware that encrypts files behaves like ransomware whether its code is obfuscated or not.

This project uses dynamic analysis. Specifically, it uses a tool called **Speakeasy** to run Windows programs in a safe simulated environment and record everything they do.

---

## What Is the Windows API?

Every Windows program — whether it is Microsoft Word, a game, or a virus — needs to interact with the operating system to do anything useful:

- To read a file, it must ask Windows: `CreateFileW("report.docx", ...)`
- To connect to the internet, it must ask: `WSAConnect(...)`
- To create a new process, it must ask: `CreateProcess(...)`

These requests go through the **Windows API** (Application Programming Interface) — a set of official functions that Windows provides. Think of the Windows API as a service desk: any program that wants to do something real (read files, use the network, manage memory, talk to hardware) has to make a request through this desk.

**This is the key insight for malware detection**: no matter how cleverly a malware author obfuscates their code, the malware must eventually make real Windows API calls to actually do anything. When ransomware encrypts files, it has to call `CryptEncrypt`. When a RAT injects itself into another process, it has to call `VirtualAllocEx` and `WriteProcessMemory`. These calls are the *behavioral fingerprint* that this system reads.

---

## Common Windows API Calls and What They Mean

| API Call | What It Does | Why It Matters |
|---|---|---|
| `VirtualAlloc` | Allocates a region of memory | Normal use, but often used to load shellcode |
| `VirtualAllocEx` | Allocates memory in *another process* | Red flag — classic sign of process injection |
| `WriteProcessMemory` | Writes data into another process's memory | Almost always malicious (process injection) |
| `CreateRemoteThread` | Creates a thread in another process | Injects malicious code into a legitimate program |
| `RegSetValueEx` | Writes a value to the Windows registry | Persistence — malware adds itself to startup |
| `RegCreateKeyEx` | Creates a registry key | Same — establishing persistence |
| `CreateFileW` | Opens or creates a file | File access — read/write/encrypt |
| `DeleteFileW` | Deletes a file | Ransomware cleanup, evidence removal |
| `CryptEncrypt` | Encrypts data using Windows Crypto API | Ransomware encrypting victim files |
| `BCryptEncrypt` | Modern encryption API | Same — used by newer ransomware |
| `WSAConnect` | Opens a network connection | Contacting a command-and-control server |
| `send` / `recv` | Send/receive network data | Exfiltrating data or receiving commands |
| `GetProcAddress` | Looks up the address of a function | Used to hide which APIs are being called |
| `LoadLibraryA` | Loads a DLL into memory | Dynamic loading to evade detection |
| `OpenProcess` | Opens a handle to another running process | First step of process injection |
| `CreateProcess` | Launches a new program | Spawning malicious child processes |

---

## What Is Speakeasy?

Running actual malware is dangerous. If you run it in a real Windows VM, it might:
- Encrypt files in the VM (ransomware)
- Try to spread to your network
- Phone home to the attacker and give away that you are analyzing it
- Do nothing if it detects it is being watched (many real malware families check for analysis environments)

**Speakeasy** is an open-source tool developed by Mandiant (a top cybersecurity company, now part of Google). Instead of running malware on real hardware, Speakeasy *emulates* the Windows environment entirely in software:

- It pretends to be a Windows OS
- It provides fake implementations of Windows API functions
- When the malware calls `CreateFileW`, Speakeasy intercepts it, records the call, and returns a fake success
- When the malware calls `WSAConnect`, Speakeasy records the IP address it tried to reach
- The CPU instructions are emulated too, so the malware's code actually runs — just in a controlled cage

The result is a detailed **report** (a JSON file) of everything the malware tried to do, without any of it actually happening.

---

## What a Speakeasy Report Looks Like

When Speakeasy finishes analyzing a file, it produces a JSON report. Here is a simplified example from a ransomware sample:

```json
{
  "entry_points": [
    {
      "ep_type": "module_entry",
      "apis": [
        { "api_name": "GetTempPathW",     "args": [],           "ret_val": 1 },
        { "api_name": "CreateFileW",      "args": ["C:\\Users\\victim\\Documents\\photo.jpg", 1073741824], "ret_val": 1234 },
        { "api_name": "ReadFile",         "args": [1234, 4096], "ret_val": 1 },
        { "api_name": "CryptAcquireContextW", "args": [],       "ret_val": 1 },
        { "api_name": "CryptEncrypt",     "args": [5678, 4096], "ret_val": 1 },
        { "api_name": "WriteFile",        "args": [9012, 4096], "ret_val": 1 },
        { "api_name": "DeleteFileW",      "args": ["C:\\Users\\victim\\Documents\\photo.jpg"], "ret_val": 1 }
      ],
      "file_access": [
        { "event": "create", "path": "C:\\Users\\victim\\Documents\\photo.jpg.locked" },
        { "event": "delete", "path": "C:\\Users\\victim\\Documents\\photo.jpg" }
      ],
      "network_events": {
        "traffic": [
          { "server": "185.220.101.45", "port": 443 }
        ],
        "dns": [
          { "query": "ransom-c2-server.ru" }
        ]
      }
    }
  ]
}
```

Reading this even without any training, you can see:
1. File is opened → encrypted → original deleted, leaving `.locked` version
2. It connects to a suspicious IP on port 443 (HTTPS — hiding traffic as normal web)
3. DNS query to a suspicious domain — the ransomware checking in with its criminal operator

This is exactly what is fed into our neural network after preprocessing.

---

## Entry Points — What Does That Mean?

A Windows executable (.exe or .dll) can start execution from multiple places:

- **`WinMain`** — the main function of a normal Windows application
- **`DllMain`** — called when a DLL (library) is loaded into memory
- **Module entry** — generic entry into the executable
- **Export function** — a specific function exposed by a DLL (e.g. `StartService`)

Each entry point gets its own section in the Speakeasy report. A DLL might have 5 entry points, each with its own API call sequence. This project processes all of them together — combining the full behavioral picture into one analysis.

---

## SHA-256 Hash — What Is That?

In the dataset, each sample has a `sha256` field. This is a **cryptographic fingerprint** of the file.

SHA-256 is a mathematical algorithm that takes any file (1 KB or 1 GB) and produces a fixed-length string of 64 hexadecimal characters (letters and numbers). For example:

```
File: photo.jpg (2.3 MB)
SHA-256: 3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c
```

**Properties of SHA-256:**
- Two different files will never have the same hash (in practice)
- Changing even one byte of the file completely changes the hash
- The same file will always produce the same hash

**Why it matters for malware analysis:** The SHA-256 hash is the universal identifier for a specific malware sample. When security researchers say "we found the WannaCry sample", they share the hash so everyone knows exactly which binary they mean. In our dataset, the hash identifies which specific program was analyzed.

---

## Glossary

| Term | Plain English |
|---|---|
| Dynamic analysis | Watching what a program does as it runs |
| Static analysis | Reading a program's code without running it |
| Windows API | Official functions Windows provides for programs to use |
| Speakeasy | Tool that runs Windows programs in a fake, safe environment |
| Emulation | Simulating a computer system in software |
| Sandbox | An isolated environment for safely running suspicious software |
| Entry point | Where a program starts executing |
| SHA-256 hash | A unique 64-character fingerprint of a file |
| JSON | A text format for structured data (key: value pairs) |
| ep_type | Entry point type — how the program was launched |
| API call | A request a program makes to the operating system |

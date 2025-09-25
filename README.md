# FTP/SFTP VS Code Extension

A Visual Studio Code extension for managing remote files over **FTP** or **SFTP**.
It allows you to **browse remote servers**, **upload/download files**, **copy, rename, delete**, and **change file permissions** directly from VS Code.
<img width="1057" height="764" alt="image" src="https://github.com/user-attachments/assets/dbcf7d99-d325-4aa4-a697-57c834539b8d" />

---

## Features

* Connect to multiple FTP/SFTP servers.
* File operations:

  * Open remote file in VS Code editor.
  * Upload files from local machine to remote server.
  * Download files from server.
  * Copy, rename, and delete files/folders.
  * Automatically handle duplicate names (`-copy`, `-copy-1`, ...).
* Change file or folder permissions (`chmod`) via input box.
* TreeView integration:

  * Right-click context menu.
  * Inline icons for **Edit**, **Remove**, **Upload**, **Chmod**, and **Copy File**.

---

## Installation

1. Clone this repository:

```bash
git clone https://github.com/quocdoan419/vndes-file-manager.git
cd vndes-file-manager
```

2. Open the folder in Visual Studio Code.

3. Install dependencies:

```bash
npm install
```

4. Compile TypeScript:

```bash
npm run compile
```

5. Press `F5` in VS Code to launch the extension in a new Extension Development Host window.

---

## Usage

### Adding a Connection
<img width="1086" height="804" alt="image" src="https://github.com/user-attachments/assets/d13edf3a-045a-4714-a081-7f28c2809401" />

1. Open the **FTP/SFTP** view in the Activity Bar.
2. Click **Add Connection**.
3. Fill in the required fields:

   * **ID** (unique name)
   * **Type**: FTP or SFTP
   * **Host**, **Port**
   * **Username**, **Password**
   * **Root path** (optional)
4. Click **Save**.

### Editing a Connection

1. Right-click a connection in TreeView.
2. Click the **Edit** icon (pencil).
3. Modify details and click **Save**.

### Removing a Connection

1. Right-click a connection.
2. Click the **Remove** icon (trash).
3. Confirm **Yes** or **No**.
<img width="311" height="584" alt="image" src="https://github.com/user-attachments/assets/6acd918f-64ef-4412-ad5c-e4a00d7ae5fc" />

### Upload Files

1. Right-click a folder in TreeView.
2. Select **Upload File**.
3. Choose one or multiple files from your computer.
4. The extension automatically handles duplicate file names.

### Copy File

1. Right-click a file.
2. Click **Copy File**.
3. The file is duplicated in the same folder, automatically renaming if needed (`-copy`, `-copy-1`, ...).

### Chmod

1. Right-click a file or folder.
2. Click **Chmod**.
3. Enter a 3-digit permission code (e.g., `644`, `755`) in the popup.
4. Permissions are applied on the server.

### Open File

1. Double-click a file in TreeView.
2. It will download and open in VS Code editor.
3. Changes are automatically uploaded on save.

---

## Keybindings & Context Menu

| Action            | Icon/Command                   | Context                |
| ----------------- | ------------------------------ | ---------------------- |
| Edit Connection   | ✏️ / `ftpSsh.editConnection`   | connection (TreeView)  |
| Remove Connection | 🗑 / `ftpSsh.removeConnection` | connection (TreeView)  |
| Upload File       | 📤 / `ftpSsh.uploadFile`       | folder (TreeView)      |
| Copy File         | 📄 / `ftpSsh.copyFile`         | file (TreeView)        |
| Chmod             | 🔧 / `ftpSsh.chmod`            | file/folder (TreeView) |
| Open File         | ↗️ / `ftpSsh.openFile`         | file (TreeView)        |

---

## Settings

* **globalState**: Stores connection IDs.
* **Secrets**: Stores connection details securely.
* **Temporary storage**: Downloads files to `globalStorageUri` for editing.

---

## Development

* `npm run compile` → compile TypeScript to JavaScript.
* `F5` → run in Extension Development Host.
* `src/` contains main extension code:

  * `connectionManager.ts` → manage connections.
  * `treeView.ts` → TreeView and TreeItem.
  * `fileEditing.ts` → upload/download logic.
  * `extension.ts` → register commands and events.

---

## License

MIT License

---

## Notes

* FTP servers may not support `chmod`. The extension uses `SITE CHMOD` for FTP.
* Multi-file upload is supported. Duplicate file names are automatically renamed.
* Works on **Windows, macOS, and Linux** with VS Code 1.70+.

---
## Donate
* Or want to support a cup of coffee, you can donate:
* PayPal : info.vndes@gmail.com.

---

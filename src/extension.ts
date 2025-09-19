import * as vscode from "vscode";
import { Readable } from "stream";
import * as path from "path";
import { ConnectionTreeProvider, ConnectionTreeItem } from "./treeView";
import { ConnectionManager, ConnectionConfig } from "./connectionManager";
import { registerFileEditingCommands } from "./fileEditing";

let manager: ConnectionManager;
let treeProvider: ConnectionTreeProvider;

// Map localPath -> { connection, remotePath, client }
const openFiles = new Map<
  string,
  { connection: ConnectionConfig; remotePath: string; client: any }
>();

// Set of localPaths currently uploading (to prevent concurrent uploads)
const uploading = new Set<string>();

export function registerContextCommands(
  context: vscode.ExtensionContext,
  manager: ConnectionManager
) {
  // 📌 Add File
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "ftpSsh.addFile",
      async (item: ConnectionTreeItem) => {
        if (!item.connection || !item.fullPath) return;

        const fileName = await vscode.window.showInputBox({
          prompt: "Enter file name",
        });
        if (!fileName) return;

        const remotePath = `${item.fullPath.replace(/\/+$/g, "")}/${fileName}`;
        const client = await manager.ensureConnected(item.connection);

        try {
          // create an empty buffer and upload as stream
          await client.uploadFrom(Readable.from(""), remotePath);
          vscode.window.showInformationMessage(`File created: ${remotePath}`);
          treeProvider.refresh();
        } catch (err: any) {
          vscode.window.showErrorMessage(`Error creating file: ${err.message}`);
        }
      }
    )
  );

  // 📌 Add Folder
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "ftpSsh.addFolder",
      async (item: ConnectionTreeItem) => {
        if (!item.connection || !item.fullPath) return;

        const folderName = await vscode.window.showInputBox({
          prompt: "Enter folder name",
        });
        if (!folderName) return;

        const remotePath = `${item.fullPath.replace(/\/+$/g, "")}/${folderName}`;
        const client = await manager.ensureConnected(item.connection);

        try {
          await client.ensureDir(remotePath);
          // some FTP servers need to cd back; ensureDir usually changes cwd, but it's fine
          await client.cd("/"); // optional: reset cwd
          vscode.window.showInformationMessage(`Folder created: ${remotePath}`);
          treeProvider.refresh();
        } catch (err: any) {
          vscode.window.showErrorMessage(`Error creating folder: ${err.message}`);
        }
      }
    )
  );

  // 📌 Rename
  context.subscriptions.push(
    vscode.commands.registerCommand("ftpSsh.rename", async (item: ConnectionTreeItem) => {
      if (!item.connection || !item.fullPath) return;

      const newName = await vscode.window.showInputBox({
        prompt: "Enter new name",
        value: item.label,
      });
      if (!newName) return;

      const parentPath = item.fullPath.substring(0, item.fullPath.lastIndexOf("/"));
      const newPath = `${parentPath}/${newName}`;

      const client = await manager.ensureConnected(item.connection);

      try {
        await client.rename(item.fullPath, newPath);
        vscode.window.showInformationMessage(`Renamed to: ${newPath}`);
        treeProvider.refresh();
      } catch (err: any) {
        vscode.window.showErrorMessage(`Error renaming: ${err.message}`);
      }
    })
  );

  // 📌 Delete
  context.subscriptions.push(
    vscode.commands.registerCommand("ftpSsh.delete", async (item: ConnectionTreeItem) => {
      if (!item.connection || !item.fullPath) return;

      const confirm = await vscode.window.showWarningMessage(
        `Delete ${item.label}?`,
        { modal: true },
        "Yes"
      );
      if (confirm !== "Yes") return;

      const client = await manager.ensureConnected(item.connection);

      try {
        if (item.contextValue === "folder") {
          // basic-ftp: removeDir removes directory only if empty; use removeDir for recursive if supported
          await client.removeDir(item.fullPath);
        } else {
          await client.remove(item.fullPath);
        }
        vscode.window.showInformationMessage(`Deleted: ${item.fullPath}`);
        treeProvider.refresh();
      } catch (err: any) {
        vscode.window.showErrorMessage(`Error deleting: ${err.message}`);
      }
    })
  );
  context.subscriptions.push(vscode.commands.registerCommand( "ftpSsh.duplicateFile",
    async (item: ConnectionTreeItem) => {
      if (!item || !item.connection || !item.fullPath) {
        vscode.window.showErrorMessage("No file selected");
        return;
      }

      if (item.contextValue !== "file") {
        vscode.window.showWarningMessage("You can only copy files.");
        return;
      }

      try {
        const client = await manager.ensureConnected(item.connection);

        const path = require("path");
        const dir = path.dirname(item.fullPath);
        const ext = path.extname(item.fullPath);
        const baseName = path.basename(item.fullPath, ext);

        // new name: file-copy.txt, file-copy-1.txt, ...
        let newName = `${baseName}-copy${ext}`;
        let counter = 1;
        const list = await manager.listDirectory(item.connection, dir);
        const existing = list.map((f: any) => f.name);
        while (existing.includes(newName)) {
          newName = `${baseName}-copy-${counter}${ext}`;
          counter++;
        }

        const newPath = `${dir.endsWith('/') ? dir : dir + '/'}${newName}`;

        const tmp = require("os").tmpdir() + "/" + item.label;
        await client.downloadTo(tmp, item.fullPath);
        await client.uploadFrom(tmp, newPath);

        vscode.window.showInformationMessage(`File copied to: ${newPath}`);
        treeProvider.refresh();
      } catch (err: any) {
        vscode.window.showErrorMessage(`Error copying file: ${err.message}`);
      }
    }
  )
);
    // upload file 
   context.subscriptions.push(
  vscode.commands.registerCommand(
    "ftpSsh.uploadFile",
    async (item: ConnectionTreeItem) => {
      if (!item || !item.connection) {
        vscode.window.showErrorMessage("No connection selected");
        return;
      }

      const folderPath = item.fullPath || "/";
      const client = await manager.ensureConnected(item.connection);
      const path = require("path");

      const uris = await vscode.window.showOpenDialog({
        canSelectMany: true,
        openLabel: "Upload",
      });
      if (!uris || uris.length === 0) return;

      try {
        const list = await manager.listDirectory(item.connection, folderPath);
        const existingNames = list.map((f: any) => f.name);

        for (const fileUri of uris) {
          const ext = path.extname(fileUri.fsPath);
          const baseName = path.basename(fileUri.fsPath, ext);

          // Tìm tên mới nếu trùng
          let newName = path.basename(fileUri.fsPath);
          let counter = 1;
          while (existingNames.includes(newName)) {
            newName = `${baseName}-copy${counter > 1 ? `-${counter}` : ""}${ext}`;
            counter++;
          }
          existingNames.push(newName); 

          const remotePath = `${folderPath.endsWith('/') ? folderPath : folderPath + '/'}${newName}`;

          await client.uploadFrom(fileUri.fsPath, remotePath);
        }

        vscode.window.showInformationMessage(`Uploaded ${uris.length} file(s) successfully.`);
        treeProvider.refresh();
      } catch (err: any) {
        vscode.window.showErrorMessage(`Upload failed: ${err.message}`);
      }
    }
  )
);
context.subscriptions.push(
  vscode.commands.registerCommand(
    "ftpSsh.chmod",
    async (item: ConnectionTreeItem) => {
      if (!item || !item.connection || !item.fullPath) {
        vscode.window.showErrorMessage("No file/folder selected");
        return;
      }

      const client = await manager.ensureConnected(item.connection);

      // Hiển thị input box để người dùng nhập số chmod
      const input = await vscode.window.showInputBox({
        prompt: `Enter permissions for ${item.label} (e.g., 644, 755)`,
        placeHolder: "644",
        validateInput: (value) => {
          // Kiểm tra định dạng số 3 chữ số, mỗi chữ số 0-7
          if (!/^[0-7]{3}$/.test(value)) {
            return "Enter a valid 3-digit octal number (0-7)";
          }
          return null;
        },
      });

      if (!input) return;

      const chmodValue = parseInt(input, 8); // chuyển từ string octal sang number

      try {
        if (item.connection.type === "sftp") {
          await client.chmod(item.fullPath, chmodValue);
        } else {
          // FTP: sử dụng SITE CHMOD
          await client.send(`SITE CHMOD ${chmodValue.toString(8)} ${item.fullPath}`);
        }
        vscode.window.showInformationMessage(`Permissions set: ${input}`);
      } catch (err: any) {
        vscode.window.showErrorMessage(`Failed to chmod: ${err.message}`);
      }
    }
  )
);

function parsePermissions(perms: string): number {
  const map: Record<string, number> = { r: 4, w: 2, x: 1, '-': 0 };
  let mode = 0;
  if (!perms || perms.length < 9) return 0o644;

  const groups = [perms.slice(0, 3), perms.slice(3, 6), perms.slice(6, 9)];
  groups.forEach((g, i) => {
    let val = 0;
    for (let j = 0; j < 3; j++) {
      val += map[g[j]]!;
    }
    mode += val * Math.pow(10, 2 - i);
  });
  return mode;
}


  // 📌 Open file → download to temp, open editor, track mapping (no per-open listeners)
  context.subscriptions.push(
    vscode.commands.registerCommand("ftpSsh.openFile", async (item: ConnectionTreeItem) => {
      if (!item.connection || !item.fullPath) return;

      const client = await manager.ensureConnected(item.connection);

      try {
        // Ensure storage directory exists
        await vscode.workspace.fs.createDirectory(context.globalStorageUri);

        // Create deterministic temp filename: "<connId>__<basename>"
        const baseName = path.basename(item.fullPath);
        const safeName = `${item.connection.id}__${baseName}`;
        const tmpUri = vscode.Uri.joinPath(context.globalStorageUri, safeName);
        const localPath = tmpUri.fsPath;

        // Download remote file to localPath
        await client.downloadTo(localPath, item.fullPath);

        // Open the downloaded file in editor
        const doc = await vscode.workspace.openTextDocument(tmpUri);
        await vscode.window.showTextDocument(doc);

        // Track this open file so onDidSaveTextDocument can upload it back
        openFiles.set(localPath, {
          connection: item.connection,
          remotePath: item.fullPath,
          client,
        });
      } catch (err: any) {
        vscode.window.showErrorMessage(`Error opening file: ${err.message}`);
      }
    })
  );
}

export async function activate(context: vscode.ExtensionContext) {
  manager = new ConnectionManager(context);
  treeProvider = new ConnectionTreeProvider(manager);
  vscode.window.registerTreeDataProvider("ftpSshView", treeProvider);

  // Register commands (uses manager)
  registerContextCommands(context, manager);

  // Global save listener: only registered once
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(async (savedDoc) => {
      const entry = openFiles.get(savedDoc.uri.fsPath);
      if (!entry) return; // not a tracked remote-open file

      const localPath = savedDoc.uri.fsPath;

      // prevent concurrent uploads for the same localPath
      if (uploading.has(localPath)) {
        // already uploading, skip this save
        return;
      }

      uploading.add(localPath);
      try {
        await entry.client.uploadFrom(localPath, entry.remotePath);
        vscode.window.showInformationMessage(`Saved to server: ${entry.remotePath}`);
        // refresh view for parent folder
        treeProvider.refresh();
      } catch (err: any) {
        vscode.window.showErrorMessage(`Error saving: ${err.message}`);
      } finally {
        uploading.delete(localPath);
      }
    })
  );

  // Cleanup mapping when user closes the temp doc
  context.subscriptions.push(
    vscode.workspace.onDidCloseTextDocument((closedDoc) => {
      const localPath = closedDoc.uri.fsPath;
      if (openFiles.has(localPath)) {
        openFiles.delete(localPath);
      }
    })
  );

  // Refresh tree command
  context.subscriptions.push(
    vscode.commands.registerCommand("ftpSsh.refresh", () => treeProvider.refresh())
  );

  // Add connection (Webview form)
  context.subscriptions.push(
    vscode.commands.registerCommand("ftpSsh.addConnection", async () => {
      openConnectionForm(context, null);
    })
  );

  // Edit connection
  context.subscriptions.push(
    vscode.commands.registerCommand("ftpSsh.editConnection", async (item: any) => {
      if (!item) {
        vscode.window.showErrorMessage("No connection selected");
        return;
      }
      const config = await manager
        .listConnections()
        .then((list) => list.find((c) => c.id === item.label));
      if (!config) {
        vscode.window.showErrorMessage("Connection not found");
        return;
      }
      openConnectionForm(context, config);
    })
  );

  // Remove connection
  context.subscriptions.push(
  vscode.commands.registerCommand(
    "ftpSsh.removeConnection",
    async (item: ConnectionTreeItem) => {
      if (!item || !item.connection) {
        vscode.window.showErrorMessage("No connection selected");
        return;
      }

      // 🔹 Hiển thị popup Yes/No
      const confirm = await vscode.window.showWarningMessage(
        `Are you sure you want to delete connection "${item.connection.id}"?`,
        { modal: true },
        "Yes",
        "No"
      );

      if (confirm !== "Yes") return; // chọn No hoặc đóng popup → hủy

      await manager.removeConnection(item.connection.id);
      vscode.window.showInformationMessage(
        `Connection ${item.connection.id} removed`
      );
      treeProvider.refresh();
    }
  )
);


  // Register file editing commands (if any)
  registerFileEditingCommands(context, manager);
}

export function deactivate() {
  // close any clients
  // optional: iterate manager connections and close them if needed
}

/**
 * Mở form Webview để thêm/sửa connection
 */
function openConnectionForm(
  context: vscode.ExtensionContext,
  existing: ConnectionConfig | null
) {
  const panel = vscode.window.createWebviewPanel(
    "ftpSshConnectionForm",
    existing ? "Edit Connection" : "Add Connection",
    vscode.ViewColumn.One,
    { enableScripts: true }
  );

  panel.webview.html = getWebviewContent(existing);

  panel.webview.onDidReceiveMessage(async (message) => {
  if (message.command === "saveConnection") {
    const config: ConnectionConfig = message.data;
    try {
      if (existing) {
        await manager.updateConnection(config);
        vscode.window.showInformationMessage(`Connection ${config.id} updated`);
      } else {
        await manager.addConnection(config);
        vscode.window.showInformationMessage(`Connection ${config.id} added`);
      }
      treeProvider.refresh();
      panel.dispose();
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to save: ${err.message}`);
    }
  }
});

}

/**
 * Tạo nội dung HTML cho Webview form
 */
function getWebviewContent(existing: ConnectionConfig | null): string {
  const id = existing?.id ?? "";
  const type = existing?.type ?? "ftp";
  const host = existing?.host ?? "127.0.0.1";
  const port = existing?.port ?? (type === "ftp" ? 21 : 22);
  const username = existing?.username ?? "";
  const password = existing?.password ?? "";
  const root = existing?.root ?? "";

  return /* html */ `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        body { font-family: sans-serif; padding: 10px; color: #ddd; background: #1e1e1e; }
        label { display:block; margin-top:8px; }
        input, select { width: 100%; padding:5px; background:#2d2d2d; color:#fff; border:1px solid #555; }
        button { margin-top: 12px; padding: 6px 12px; background:#0e639c; color:white; border:none; cursor:pointer; }
        button:hover { background:#1177bb; }
      </style>
    </head>
    <body>
      <h2>${existing ? "Edit" : "Add"} Connection</h2>
      <label>ID* <input id="id" value="${id}" ${existing ? "readonly" : ""}/></label>
      <label>Type*
        <select id="type">
          <option value="ftp" ${type === "ftp" ? "selected" : ""}>FTP</option>
          <option value="sftp" ${type === "sftp" ? "selected" : ""}>SFTP</option>
        </select>
      </label>
      <label>Host* <input id="host" value="${host}"/></label>
      <label>Port* <input id="port" type="number" value="${port}"/></label>
      <label>Username* <input id="username" value="${username}"/></label>
      <label>Password* <input id="password" type="password" value="${password}"/></label>
      <label>Root Path <input id="root" value="${root}"/></label>
      <button onclick="save()">Save</button>

      <script>
        const vscode = acquireVsCodeApi();
        function save() {
          const data = {
            id: document.getElementById("id").value,
            type: document.getElementById("type").value,
            host: document.getElementById("host").value,
            port: parseInt(document.getElementById("port").value, 10),
            username: document.getElementById("username").value,
            password: document.getElementById("password").value,
            root: document.getElementById("root").value,
          };
          vscode.postMessage({ command: "saveConnection", data });
        }
      </script>
    </body>
    </html>
  `;
}

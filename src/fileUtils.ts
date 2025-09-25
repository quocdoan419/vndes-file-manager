import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { ConnectionManager } from "./connectionManager";
export async function searchFilesFTP(client: any, dir: string, keyword: string): Promise<string[]> {
  let results: string[] = [];
  try {
    const list = await client.list(dir);
    for (const item of list) {
      const fullPath = path.posix.join(dir, item.name);
      if (item.isDirectory) {
        const subResults = await searchFilesFTP(client, fullPath, keyword);
        results = results.concat(subResults);
      } else if (item.name.toLowerCase().includes(keyword.toLowerCase())) {
        //const relativePath = path.posix.relative(dir, fullPath);
        results.push(fullPath);
      }
    }
  } catch (err) {
    console.error(`Error reading ${dir}:`, err);
  }
  return results;
}

export async function searchFilesSFTP(client: any, dir: string, keyword: string): Promise<string[]> {
  let results: string[] = [];
  try {
    const list = await client.list(dir);
    for (const item of list) {
      const fullPath = path.posix.join(dir, item.name);
      if (item.type === "d") {
        const subResults = await searchFilesSFTP(client, fullPath, keyword);
        results = results.concat(subResults);
      } else if (item.name.toLowerCase().includes(keyword.toLowerCase())) {
        results.push(fullPath);
      }
    }
  } catch (err) {
    console.error(`Error reading ${dir}:`, err);
  }
  return results;
}

export function registerFileEditingCommands(context: vscode.ExtensionContext, manager: ConnectionManager) {
  context.subscriptions.push(
    vscode.commands.registerCommand("ftpSsh.uploadFile", async () => {
      const id = await vscode.window.showInputBox({ prompt: "Connection ID" });
      const local = await vscode.window.showInputBox({ prompt: "Local path" });
      const remote = await vscode.window.showInputBox({ prompt: "Remote path" });
      if (!id || !local || !remote) return;
      try {
        await manager.uploadFile(id, local, remote);
        vscode.window.showInformationMessage(`Uploaded ${local} to ${remote}`);
      } catch (err: any) {
        vscode.window.showErrorMessage(err.message);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("ftpSsh.downloadFile", async () => {
      const id = await vscode.window.showInputBox({ prompt: "Connection ID" });
      const remote = await vscode.window.showInputBox({ prompt: "Remote path" });
      const local = await vscode.window.showInputBox({ prompt: "Local path" });
      if (!id || !local || !remote) return;
      try {
        await manager.downloadFile(id, remote, local);
        vscode.window.showInformationMessage(`Downloaded ${remote} to ${local}`);
      } catch (err: any) {
        vscode.window.showErrorMessage(err.message);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("ftpSsh.rename", async () => {
      const id = await vscode.window.showInputBox({ prompt: "Connection ID" });
      const oldPath = await vscode.window.showInputBox({ prompt: "Old path" });
      const newPath = await vscode.window.showInputBox({ prompt: "New path" });
      if (!id || !oldPath || !newPath) return;
      try {
        await manager.rename(id, oldPath, newPath);
        vscode.window.showInformationMessage(`Renamed ${oldPath} to ${newPath}`);
      } catch (err: any) {
        vscode.window.showErrorMessage(err.message);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("ftpSsh.delete", async () => {
      const id = await vscode.window.showInputBox({ prompt: "Connection ID" });
      const target = await vscode.window.showInputBox({ prompt: "Remote path to delete" });
      if (!id || !target) return;
      try {
        await manager.delete(id, target);
        vscode.window.showInformationMessage(`Deleted ${target}`);
      } catch (err: any) {
        vscode.window.showErrorMessage(err.message);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("ftpSsh.chmod", async () => {
      const id = await vscode.window.showInputBox({ prompt: "Connection ID" });
      const target = await vscode.window.showInputBox({ prompt: "Remote path" });
      const mode = await vscode.window.showInputBox({ prompt: "New mode (e.g. 755)" });
      if (!id || !target || !mode) return;
      try {
        await manager.chmod(id, target, mode);
        vscode.window.showInformationMessage(`Changed mode for ${target} to ${mode}`);
      } catch (err: any) {
        vscode.window.showErrorMessage(err.message);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("ftpSsh.move", async () => {
      const id = await vscode.window.showInputBox({ prompt: "Connection ID" });
      const oldPath = await vscode.window.showInputBox({ prompt: "Old path" });
      const newPath = await vscode.window.showInputBox({ prompt: "New path" });
      if (!id || !oldPath || !newPath) return;
      try {
        await manager.move(id, oldPath, newPath);
        vscode.window.showInformationMessage(`Moved ${oldPath} to ${newPath}`);
      } catch (err: any) {
        vscode.window.showErrorMessage(err.message);
      }
    })
  );
}
export async function uploadFolderRecursive(localPath: string, remotePath: string, client: any) {
  const entries = fs.readdirSync(localPath, { withFileTypes: true });

  for (const entry of entries) {
    const localFilePath = path.join(localPath, entry.name);
    const remoteFilePath = `${remotePath}/${entry.name}`;

    if (entry.isDirectory()) {
      // 🔹 Tạo folder nếu chưa có
      if (client.mkdir) {
        await client.mkdir(remoteFilePath, true).catch(() => {});
      }
      // 🔹 Đệ quy
      await uploadFolderRecursive(localFilePath, remoteFilePath, client);
    } else {
      // 🔹 Upload file
      const content = fs.createReadStream(localFilePath);
      if (client.put) {
        await client.put(content, remoteFilePath);
      } else if (client.upload) {
        await client.upload(content, remoteFilePath);
      }
    }
  }
}
async function askPermissions(): Promise<{read: boolean; write: boolean; execute: boolean;}> {
  const picks = await vscode.window.showQuickPick(
    [
      { label: "Read", picked: true },
      { label: "Write", picked: false },
      { label: "Execute", picked: false },
    ],
    {
      canPickMany: true,
      title: "Chọn phân quyền cho kết nối",
    }
  );

  return {
    read: picks?.some(p => p.label === "Read") ?? false,
    write: picks?.some(p => p.label === "Write") ?? false,
    execute: picks?.some(p => p.label === "Execute") ?? false,
  };
}

export function getFileInfoHtml(filePath: string, stat: any): string {

  const size = stat.size || 0;
  const modified = stat.modifyTime ? new Date(stat.modifyTime).toLocaleString() : "N/A";
  const rights = stat.rights || {};
  const octal = stat.mode ? stat.mode.toString(8).slice(-3) : "644";

  return /*html*/`
    <html>
      <body style="font-family: sans-serif; padding: 10px;">
        <h3>${filePath}</h3>
        <p><b>Size:</b> ${size} bytes</p>
        <p><b>Modified:</b> ${modified}</p>
        <p><b>Permissions:</b> ${rights.user || "-"}${rights.group || "-"}${rights.other || "-"}</p>
        <p>
          <label>Octal:</label>
          <input id="chmodInput" value="${octal}" style="width:60px;" />
        </p>
        <button onclick="apply()">Apply</button>
        <script>
          const vscode = acquireVsCodeApi();
          function apply() {
            const mode = document.getElementById('chmodInput').value;
            vscode.postMessage({ command: 'setChmod', mode });
          }
        </script>
      </body>
    </html>
  `;
}


import * as vscode from "vscode";
import { Readable } from "stream";
import * as path from "path";
import * as fs from "fs";
import { ConnectionTreeProvider, ConnectionTreeItem, SortMode } from "./treeView";
import { ConnectionManager, ConnectionConfig } from "./connectionManager";
import { uploadFolderRecursive,registerFileEditingCommands,getFileInfoHtml,searchFilesFTP, searchFilesSFTP } from "./fileUtils";
import { downloadFolderPro } from "./download";


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
           if (item.connection.type === "sftp") {
                await client.put(Buffer.from(""), remotePath);

             }
            else {
                await client.uploadFrom(Readable.from(""), remotePath);
            }
          
          vscode.window.showInformationMessage(`File created: ${remotePath}`);
          treeProvider.refresh();
        } catch (err: any) {
          vscode.window.showErrorMessage(`Error creating file: ${err.message}`);
        }
      }
    )
  );
  // search file
  context.subscriptions.push(
  vscode.commands.registerCommand("ftpSsh.searchFiles", async (item: ConnectionTreeItem) => {
    if (!item || !item.fullPath || !item.connection) {
      vscode.window.showErrorMessage("Invalid folder");
      return;
    }

    const keyword = await vscode.window.showInputBox({
      prompt: `Enter keyword to search in ${item.fullPath}`,
      placeHolder: "e.g. index, config, .env",
    });
    if (!keyword) return;

    try {
      const results = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Searching "${keyword}" in ${item.fullPath}`,
          cancellable: false,
        },
        async (progress) => {
            progress.report({ message: "Scanning folders..." });

            if (!item.connection) {
                vscode.window.showErrorMessage("No connection found for this item.");
                return [];
            }

            const client = await manager.ensureConnected(item.connection);
            if(!item.fullPath)
                    {
                        return;
                    }
            if (item.connection.type === "sftp") {
                return await searchFilesSFTP(client, item.fullPath, keyword);
            } else {
                return await searchFilesFTP(client, item.fullPath, keyword);
            }
        }

      );

      if (!results || results.length === 0) {
        vscode.window.showInformationMessage(`No files found for "${keyword}"`);
        return;
      }

      const pick = await vscode.window.showQuickPick(results, {
        placeHolder: "Select file to open",
      });

      if (pick) {
        vscode.commands.executeCommand("ftpSsh.openFile", { fullPath: pick, connection: item.connection });
      }
    } catch (err) {
      vscode.window.showErrorMessage(`Search failed: ${err}`);
    }
  })
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
             if (item.connection.type === "sftp") {
                await client.mkdir(remotePath, true);
             }
             else {
         await client.ensureDir(remotePath);
          // some FTP servers need to cd back; ensureDir usually changes cwd, but it's fine
          await client.cd("/"); // optional: reset cwd  
             }
         
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
         if (item.connection.type === "sftp") {
              if (item.contextValue === "folder") {
                // basic-ftp: removeDir removes directory only if empty; use removeDir for recursive if supported
                await client.rmdir(item.fullPath,true);
                } else {
                await client.delete(item.fullPath);
                }

             }
        else {
            if (item.contextValue === "folder") {
                // basic-ftp: removeDir removes directory only if empty; use removeDir for recursive if supported
                await client.removeDir(item.fullPath);
                } else {
                await client.remove(item.fullPath);
                }
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
         if (item.connection.type === "sftp") {
                const tasks = uris.map(async (fileUri) => {
                        const ext = path.extname(fileUri.fsPath);
                        const baseName = path.basename(fileUri.fsPath, ext);

                        let newName = path.basename(fileUri.fsPath);
                        let counter = 1;

                        while (existingNames.includes(newName)) {
                        newName = `${baseName}-copy${counter > 1 ? `-${counter}` : ""}${ext}`;
                        counter++;
                        }

                        existingNames.push(newName);

                        const remotePath = `${folderPath.replace(/\/$/, "")}/${newName}`;

                        await client.put(fileUri.fsPath, remotePath); // ssh2-sftp-client
                        return newName;
                    });
                      const uploaded = await Promise.all(tasks);
                        vscode.window.showInformationMessage(`✅ Uploaded: ${uploaded.join(", ")}`);

         }
         else {
            
                    for (const fileUri of uris) {
                    const ext = path.extname(fileUri.fsPath);
                    const baseName = path.basename(fileUri.fsPath, ext);

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
         }
     

       
        treeProvider.refresh();
      } catch (err: any) {
        vscode.window.showErrorMessage(`Upload failed: ${err.message}`);
      }
    }
  )
);
// upload folder
context.subscriptions.push(
  vscode.commands.registerCommand(
    "ftpSsh.uploadFolder",
    async (item: ConnectionTreeItem, uris?: vscode.Uri[]) => {
      if (!item.connection || !item.fullPath) return;

      // chọn folder nếu chưa có
      if (!uris || uris.length === 0) {
        uris = await vscode.window.showOpenDialog({
          canSelectFiles: false,
          canSelectFolders: true,
          canSelectMany: false,
          openLabel: "Select folder to upload",
        });
        if (!uris) return;
      }

      const client = await manager.ensureConnected(item.connection);

      // helper: ensure dir (FTP vs SFTP)
      async function ensureDir(remoteDir: string) {
        if (typeof client.ensureDir === "function") {
          // basic-ftp
          await client.ensureDir(remoteDir);
        } else if (typeof client.mkdir === "function") {
          // ssh2-sftp-client
          try {
            await client.mkdir(remoteDir, true);
          } catch (err: any) {
            // nếu lỗi vì đã tồn tại thì ignore
            const msg = String(err?.message ?? err);
            if (!/exist/i.test(msg) && !/file exists/i.test(msg)) {
              throw err;
            }
          }
        }
      }

      // helper: đếm file để progress
      function countFiles(dir: string): number {
        let count = 0;
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            count += countFiles(full);
          } else {
            count++;
          }
        }
        return count;
      }

      for (const folderUri of uris) {
        const localFolder = folderUri.fsPath;
        const folderName = path.basename(localFolder);
        const remoteFolder = path.posix.join(item.fullPath, folderName);

        const totalFiles = Math.max(1, countFiles(localFolder));
        let uploadedFiles = 0;

        // conflictAction tồn tại CHO MỖI LẦN upload folder này
        let conflictAction: "overwriteAll" | "skipAll" | null = null;

        // hàm kiểm tra tồn tại và hỏi (dùng client.list(parentDir))
        async function handleConflict(remotePath: string, entryName: string): Promise<string | null> {
          // parent directory (posix)
          const parent = path.posix.dirname(remotePath) || "/"; 
          const name = path.posix.basename(remotePath);

          // try to list parent
          let list: any[] = [];
          try {
            // client.list works for both basic-ftp and ssh2-sftp-client
            list = await client.list(parent);
          } catch (err) {
            // nếu list lỗi (parent không tồn tại) => coi như không tồn tại
            return remotePath;
          }

          const exists = list.some((f: any) => f.name === name);
          if (!exists) return remotePath;

          // nếu đã chọn all trước đó trong lần upload này
          if (conflictAction === "overwriteAll") return remotePath;
          if (conflictAction === "skipAll") return null;

          // hỏi user (modal để bắt buộc chọn)
          const choice = await vscode.window.showWarningMessage(
            `⚠️ "${entryName}" already exists on server at ${parent}.`,
            { modal: true },
            "Overwrite",
            "Skip",
            "Overwrite All",
            "Skip All"
          );

          if (choice === "Overwrite") return remotePath;
          if (choice === "Skip") return null;
          if (choice === "Overwrite All") {
            conflictAction = "overwriteAll";
            return remotePath;
          }
          if (choice === "Skip All") {
            conflictAction = "skipAll";
            return null;
          }

          return null;
        }

        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: `Uploading ${folderName}...`,
            cancellable: false,
          },
          async (progress) => {
            // đệ quy upload
            async function uploadRecursive(localDir: string, remoteDir: string) {
              const entries = fs.readdirSync(localDir, { withFileTypes: true });
              for (const entry of entries) {
                const localPath = path.join(localDir, entry.name);
                // chuẩn hoá remote path
                let remotePath = path.posix.join(remoteDir, entry.name);

                if (entry.isDirectory()) {
                  // kiểm tra conflict cho thư mục
                  const resolved = await handleConflict(remotePath, entry.name);
                  if (!resolved) {
                    // user chọn skip
                    continue;
                  }
                  // tạo folder trên server
                  await ensureDir(resolved);
                  // đệ quy
                  await uploadRecursive(localPath, resolved);
                } else {
                  // file: hỏi nếu tồn tại
                  const resolved = await handleConflict(remotePath, entry.name);
                  if (!resolved) {
                    // skip
                    continue;
                  }

                  // upload: tùy client
                  if (typeof client.uploadFrom === "function") {
                    // basic-ftp
                    await client.uploadFrom(localPath, resolved);
                  } else if (typeof client.put === "function") {
                    // ssh2-sftp-client
                    await client.put(localPath, resolved);
                  } else {
                    throw new Error("Unsupported client for upload");
                  }

                  uploadedFiles++;
                  const percent = Math.round((uploadedFiles / totalFiles) * 100);
                  progress.report({
                    increment: (1 / totalFiles) * 100,
                    message: `${percent}% (${uploadedFiles}/${totalFiles})`,
                  });
                }
              }
            }

            // tạo thư mục gốc trước
            await ensureDir(remoteFolder);
            await uploadRecursive(localFolder, remoteFolder);
          }
        );

        // sau khi upload xong cho folder này, conflictAction biến mất (nằm trong hàm)
        treeProvider.refresh();
        vscode.window.showInformationMessage(`✅ Uploaded folder: ${remoteFolder}`);
      }
    }
  )
);


// download 
context.subscriptions.push(
  vscode.commands.registerCommand("ftpSsh.downloadFolder", async (item: ConnectionTreeItem) => {
    if (!item.connection || !item.fullPath) return;

    const client = await manager.ensureConnected(item.connection);
    const isSftp = item.connection.type === "sftp";

    const uri = await vscode.window.showOpenDialog({
      canSelectFolders: true,
      openLabel: "Save folder here",
    });
    if (!uri || uri.length === 0) return;

    const localFolder = path.join(uri[0].fsPath, path.basename(item.fullPath));
    await downloadFolderPro(client, item.fullPath, localFolder, isSftp);
  })
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

      const input = await vscode.window.showInputBox({
        prompt: `Enter permissions for ${item.label} (e.g., 644, 755)`,
        placeHolder: "644",
        validateInput: (value) => {
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
context.subscriptions.push(
  vscode.commands.registerCommand('ftpSsh.openSshTerminal', async (item: ConnectionTreeItem) => {
    if (!item.connection || item.connection.type !== 'sftp') {
      vscode.window.showErrorMessage('This command works only for SFTP/SSH connections.');
      return;
    }

    const conn: ConnectionConfig = item.connection;

    const term = vscode.window.createTerminal({
      name: `SSH: ${conn.host}`,
      shellPath: 'ssh', // 
      shellArgs: [`${conn.username}@${conn.host}`, '-p', `${conn.port}`],
    });

    term.show();
  })
);
context.subscriptions.push(
    vscode.commands.registerCommand('ftpSsh.move', async (item: ConnectionTreeItem) => {
    if (!item.connection || !item.fullPath) return;

    const client = await manager.ensureConnected(item.connection);

    // get list
    const getDirs = async (path: string) => {
    const list = await manager.listDirectory(item.connection!, path);
    return list.filter((f: any) => f.type === 'd' || f.isDirectory).map((f: any) => f.name);
    };

    const currentPath = item.fullPath.substring(0, item.fullPath.lastIndexOf('/'));


    // Popup sugget
    const targetPath = await vscode.window.showInputBox({
    prompt: `Enter destination folder for ${item.label}`,
    value: currentPath,
    placeHolder: 'Type or select destination folder',
    validateInput: (value) => value.trim() === '' ? 'Path cannot be empty' : null
    });


    if (!targetPath) return;
    const name = item.fullPath.split('/').pop();
    const newPath = `${targetPath.replace(/\/+$/, '')}/${name}`;


    try {
    await client.rename(item.fullPath, newPath);
    vscode.window.showInformationMessage(`Moved ${item.label} to ${newPath}`);
    treeProvider.refresh();
    } catch (err: any) {
    vscode.window.showErrorMessage(`Error moving file/folder: ${err.message}`);
    }
    })
);
context.subscriptions.push(
  vscode.commands.registerCommand("ftpSsh.fileInfo", async (item: ConnectionTreeItem) => {
    if (!item?.connection || !item.fullPath) {
      vscode.window.showErrorMessage("No file selected");
      return;
    }

    try {
      const client = await manager.ensureConnected(item.connection);
      const stat = await client.list(item.fullPath);
        
      const panel = vscode.window.createWebviewPanel(
        "fileInfo",
        `${item.label} Info`,
        vscode.ViewColumn.One,
        { enableScripts: true }
      );

      panel.webview.html = getFileInfoHtml(item.fullPath, stat);

      // Nhận dữ liệu khi user nhấn Apply
      panel.webview.onDidReceiveMessage(async (message) => {
        if (message.command === "setChmod") {
          try {
            await client.chmod(item.fullPath, message.mode);
            vscode.window.showInformationMessage(
              `Permissions of ${item.label} updated to ${message.mode}`
            );
          } catch (err: any) {
            vscode.window.showErrorMessage(`Failed to set chmod: ${err.message}`);
          }
        }
      });
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to get file info: ${err.message}`);
    }
  })
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
        if (item.connection.type === "sftp") {
            await vscode.workspace.fs.createDirectory(context.globalStorageUri);
            const tmpUri = vscode.Uri.joinPath(context.globalStorageUri, item.label);
            const localPath = tmpUri.fsPath;

            // Download file from server
            await client.fastGet(item.fullPath, localPath);

            // open file
            const doc = await vscode.workspace.openTextDocument(tmpUri);
            await vscode.window.showTextDocument(doc);

            // Upload save
            const saveListener = vscode.workspace.onDidSaveTextDocument(async (savedDoc) => {
                if (savedDoc.uri.fsPath === localPath) {
                try {
                    await client.fastPut(localPath, item.fullPath);
                    vscode.window.showInformationMessage(`✅ Saved to server: ${item.fullPath}`);
                } catch (err: any) {
                    vscode.window.showErrorMessage(`❌ Error saving: ${err.message}`);
                }
                }
            });

            context.subscriptions.push(saveListener);

        }
        else {
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
                
        }

        
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
//sort 
context.subscriptions.push(
  vscode.commands.registerCommand("ftpSsh.setSortMode", async () => {
    const mode = await vscode.window.showQuickPick(
      [
        { label: "Name", value: "name" },
        { label: "Type (folder/file)", value: "type" },
        { label: "Modified Date", value: "modified" },
      ],
      { placeHolder: "Select sort mode" }
    );

    if (!mode) return;
    treeProvider.setSortMode(mode.value as SortMode);
  })
);
// download file 
context.subscriptions.push(
  vscode.commands.registerCommand("ftpSsh.downloadFile", async (item: ConnectionTreeItem) => {
    if (!item.connection || !item.fullPath) return;

    try {
      const uri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(item.label),
        saveLabel: "Download",
      });
      if (!uri) return; // user cancel

      const client = await manager.ensureConnected(item.connection);
      if (item.connection.type === "sftp") {
            await client.fastGet(uri.fsPath, item.fullPath);
      }
      else {
        await client.downloadTo(uri.fsPath,item.fullPath );
      }
      
      vscode.window.showInformationMessage(`File downloaded to: ${uri.fsPath}`);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Download failed: ${err.message}`);
    }
  })
);



  // Register file editing commands (if any)
  registerFileEditingCommands(context, manager);
}

export function deactivate() {
  // close any clients
  // optional: iterate manager connections and close them if needed
}

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

  panel.webview.html = getWebviewContent(context,existing,panel);

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
function getWebviewContent(
    context: vscode.ExtensionContext,
    existing: ConnectionConfig | null, 
    panel: vscode.WebviewPanel): string {
  const id = existing?.id ?? "";
  const type = existing?.type ?? "ftp";
  const host = existing?.host ?? "127.0.0.1";
  const port = existing?.port ?? (type === "ftp" ? 21 : 22);
  const username = existing?.username ?? "";
  const password = existing?.password ?? "";
  const root = existing?.root ?? "";
  const passive = existing?.passive ?? true; // default passive mode
 const styleUri = panel.webview.asWebviewUri(
    vscode.Uri.joinPath(context.extensionUri, "resources", "style.css")
  );
  return /* html */ `
    <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${existing ? "Edit" : "Add"} Connection</title>
    <link rel="stylesheet" href="${styleUri}">
  </head>
  <body>
  <div class="flex-center">
	<div class="card">
		<div class="card-body">
  <h2>${existing ? "Edit" : "Add"} Connection</h2>

  <div class="form-group">
    <label for="id">Name / ID *</label>
    <input id="id" value="${id}" placeholder="Unique connection ID" ${existing ? "readonly" : ""} title="ConnID">
  </div>

  <div class="form-row">
    <div class="form-group">
      <label for="type">Type *</label>
      <select id="type" title="Type" onchange="updatePassiveVisibility()">
        <option value="ftp" ${type === "ftp" ? "selected" : ""}>FTP</option>
        <option value="sftp" ${type === "sftp" ? "selected" : ""}>SFTP</option>
      </select>
    </div>
    <div class="form-group">
      <label for="port">Port *</label>
      <input id="port" type="number" value="${port}" placeholder="21 for FTP, 22 for SFTP" title="Port">
    </div>
  </div>

  <div class="form-group">
    <label for="host">Host *</label>
    <input id="host" value="${host}" placeholder="ftp.example.com" title="Domain or IP address">
  </div>

  <div class="form-row">
    <div class="form-group">
      <label for="username">Username *</label>
      <input id="username" value="${username}" placeholder="User login" title="Username">
    </div>
    <div class="form-group">
      <label for="password">Password *</label>
      <input id="password" type="password" value="${password}" placeholder="••••••" title="Password">
    </div>
  </div>

  <div class="form-group">
    <label for="root">Root Path</label>
    <input id="root" value="${root}" placeholder="/path" title="/path">
  </div>
  <div class="form-group" id="UsePassiveMode">
    ${type === 'ftp' ? `<label><input type='checkbox' id='passive' ${passive ? 'checked' : ''} /> Use Passive Mode</label>` : ''}
  </div>

  <div class="button-row">
    <button class="cancel-btn" onclick="cancel()">Cancel</button>
    <button class="save-btn" onclick="save()">Save</button>
  </div>
  </div></div></div>
  <script>
    const vscode = acquireVsCodeApi();

    function save() {
      const data = {
        id: document.getElementById("id").value.trim(),
        type: document.getElementById("type").value,
        host: document.getElementById("host").value.trim(),
        port: parseInt(document.getElementById("port").value, 10),
        username: document.getElementById("username").value.trim(),
        password: document.getElementById("password").value,
        root: document.getElementById("root").value.trim(),
        passive: document.getElementById("passive")?.checked || false
      };

      if (!data.id || !data.host || !data.username || !data.password) {
        alert("Please fill all required fields (*)");
        return;
      }

      vscode.postMessage({ command: "saveConnection", data });
    }

    function cancel() {
      vscode.postMessage({ command: "cancelConnection" });
    }
      function updatePassiveVisibility() {
          const type = document.getElementById('type').value;
          document.getElementById('passiveLabel').style.display = (type === 'ftp') ? 'block' : 'none';
        }
  </script>
</body>
  </html>
  `;
}

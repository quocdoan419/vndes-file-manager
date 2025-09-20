import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { Client as FtpClient, FileInfo as FtpFileInfo } from "basic-ftp";
import SftpClient from "ssh2-sftp-client";

type AnyClient = FtpClient | SftpClient;

interface FileEntry {
  remotePath: string;
  localPath: string;
  isDirectory: boolean;
}


function checkIsDirectory(item: any, isSftp: boolean): boolean {
  return isSftp ? item.type === 'd' : item.isDirectory || item.type === 'd';
}
async function countFiles(client: AnyClient, remoteFolder: string, isSftp: boolean): Promise<number> {
  let count = 0;
  const list = isSftp
    ? await (client as SftpClient).list(remoteFolder)
    : await (client as FtpClient).list(remoteFolder);

  for (const item of list) {
    const isDir = checkIsDirectory(item, isSftp);
    const remotePath = `${remoteFolder}/${item.name}`;
    if (isDir) {
      count += await countFiles(client, remotePath, isSftp);
    } else {
      count += 1;
    }
  }
  return count;
}

/**
 * Download folder recursive with progress
 */
export async function downloadFolderPro(
  client: AnyClient,
  remoteFolder: string,
  localFolder: string,
  isSftp: boolean
) {
  await fs.promises.mkdir(localFolder, { recursive: true });

  // Count number files
  const totalFiles = await countFiles(client, remoteFolder, isSftp);
  let downloadedFiles = 0;
  let cancelled = false;

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Downloading ${remoteFolder}`,
      cancellable: true,
    },
    async (progress, token) => {
      token.onCancellationRequested(() => {
        cancelled = true;
        vscode.window.showWarningMessage("Download cancelled.");
      });

      async function downloadRecursive(remotePath: string, localPath: string) {
        if (cancelled) return;

        const list = isSftp
          ? await (client as SftpClient).list(remotePath)
          : await (client as FtpClient).list(remotePath);

        for (const item of list) {
          if (cancelled) return;

          const isDir = checkIsDirectory(item, isSftp);
          const rPath = `${remotePath}/${item.name}`;
          const lPath = path.join(localPath, item.name);

          if (isDir) {
            await fs.promises.mkdir(lPath, { recursive: true });
            await downloadRecursive(rPath, lPath);
          } else {
            // Download file
            if (isSftp) {
              await (client as SftpClient).fastGet(rPath, lPath);
            } else {
              await (client as FtpClient).downloadTo(lPath, rPath);
            }

            downloadedFiles++;
            const percentage = Math.floor((downloadedFiles / totalFiles) * 100);
            progress.report({ message: `Downloading ${item.name}`, increment: percentage });
          }
        }
      }

      await downloadRecursive(remoteFolder, localFolder);
    }
  );

  if (!cancelled) {
    vscode.window.showInformationMessage(`Folder downloaded to: ${localFolder}`);
  }
}

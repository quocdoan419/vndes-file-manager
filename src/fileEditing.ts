import * as vscode from "vscode";
import { ConnectionManager } from "./connectionManager";

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

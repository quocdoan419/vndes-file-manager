import * as vscode from "vscode";
import { ConnectionManager, ConnectionConfig } from "./connectionManager";

const URI_SCHEME = "ftpSsh";
export type SortMode = "name" | "type" | "modified";

export class ConnectionTreeItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly contextValue: string,
    uri: vscode.Uri,
    public readonly connection?: ConnectionConfig,
    public readonly fullPath?: string
  ) {
    super(uri, collapsibleState);
    if (contextValue === "connection") {
      this.iconPath = new vscode.ThemeIcon(connection?.type === "sftp" ? "server-network" : "server");
    }
    if (contextValue === "file") {
      this.command = {
        command: "ftpSsh.openFile",
        title: "Open File",
        arguments: [this],
      };
    }
  }
}

export class ConnectionTreeProvider implements vscode.TreeDataProvider<ConnectionTreeItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<ConnectionTreeItem | void> =
    new vscode.EventEmitter<ConnectionTreeItem | void>();
  readonly onDidChangeTreeData: vscode.Event<ConnectionTreeItem | void> = this._onDidChangeTreeData.event;

  public sortMode: SortMode = "name";

  constructor(private manager: ConnectionManager) {}

  refresh() {
    this._onDidChangeTreeData.fire();
  }

  setSortMode(mode: SortMode) {
    this.sortMode = mode;
    this.refresh();
  }

  getTreeItem(element: ConnectionTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: ConnectionTreeItem): Promise<ConnectionTreeItem[]> {
    if (!element) {
      // Root: danh sách kết nối
      const connections = await this.manager.listConnections();
      connections.sort((a, b) => a.id.localeCompare(b.id));
      return connections.map((conn) => {
        const connPath = conn.root || "/";
        const connUri = vscode.Uri.from({ scheme: URI_SCHEME, authority: `${conn.host}:${conn.port}`, path: connPath });
        return new ConnectionTreeItem(
          conn.id,
          vscode.TreeItemCollapsibleState.Collapsed,
          "connection",
          connUri,
          conn,
          connPath
        );
      });
    }

    if (element.connection) {
      const path = element.fullPath || "/";
      let list: any[] = [];
      try {
        list = await this.manager.listDirectory(element.connection, path);
      } catch {
        vscode.window.showWarningMessage("Cannot read directory, please refresh or reconnect.");
        return [];
      }

      // Sort theo chế độ
      list.sort((a, b) => {
        const aIsDir = a.type === "d" || a.isDirectory === true;
        const bIsDir = b.type === "d" || b.isDirectory === true;

        if (aIsDir && !bIsDir) return -1;
        if (!aIsDir && bIsDir) return 1;

        switch (this.sortMode) {
          case "name":
            return a.name.localeCompare(b.name);
          case "type":
            return (aIsDir ? "0" : "1").localeCompare(bIsDir ? "0" : "1") || a.name.localeCompare(b.name);
          case "modified":
            const aTime = a.modifiedTime ? new Date(a.modifiedTime).getTime() : 0;
            const bTime = b.modifiedTime ? new Date(b.modifiedTime).getTime() : 0;
            return bTime - aTime;
          default:
            return 0;
        }
      });

      return list.map((item) => {
        const isDir = item.type === "d" || item.isDirectory === true || item.name?.endsWith("/");
        const newFullPath = `${path.endsWith("/") ? path : path + "/"}${item.name}`;
        const itemUri = vscode.Uri.from({
          scheme: URI_SCHEME,
          authority: `${element.connection?.host}:${element.connection?.port}`,
          path: newFullPath,
        });

        return new ConnectionTreeItem(
          item.name,
          isDir ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
          isDir ? "folder" : "file",
          itemUri,
          element.connection,
          newFullPath
        );
      });
    }

    return [];
  }
}

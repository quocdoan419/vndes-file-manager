import * as vscode from "vscode";
import { ConnectionManager, ConnectionConfig } from "./connectionManager";
const URI_SCHEME = 'ftpSsh';
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
    this.label = label;
    this.contextValue = contextValue;


    if (contextValue === "connection") {
      this.iconPath = new vscode.ThemeIcon("server");
      
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
  private _onDidChangeTreeData: vscode.EventEmitter<
    ConnectionTreeItem | undefined | void
  > = new vscode.EventEmitter<ConnectionTreeItem | undefined | void>();
  readonly onDidChangeTreeData: vscode.Event<
    ConnectionTreeItem | undefined | void
  > = this._onDidChangeTreeData.event;

  constructor(private manager: ConnectionManager) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: ConnectionTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: ConnectionTreeItem): Promise<ConnectionTreeItem[]> {
    if (!element) {
      // Root: list connections
      const connections = await this.manager.listConnections();
       return connections.map((conn) => {
        const connPath = conn.root || "/";
        // ✨ Tạo Uri cho connection
        const connUri = vscode.Uri.from({
          scheme: URI_SCHEME,
          authority: `${conn.host}:${conn.port}`,
          path: connPath,
        });

        return new ConnectionTreeItem(
          conn.id,//`${conn.host}:${conn.port}`, 
          vscode.TreeItemCollapsibleState.Collapsed,
          "connection",
          connUri, // Uri
          conn,
          connPath
        );
      });
    }

        if (element.connection) {
      const path = element.fullPath || "/";
      const list = await this.manager.listDirectory(element.connection, path);

      return list.map((item: any) => {
        const isDir =
          item.type === "d" ||
          item.isDirectory === true ||
          item.name?.endsWith("/");

        const newFullPath = `${path.endsWith('/') ? path : path + '/'}${item.name}`;

       
        const itemUri = vscode.Uri.from({
            scheme: URI_SCHEME,
            authority: `${element.connection?.host}:${element.connection?.port}`,
            path: newFullPath,
        });

        return new ConnectionTreeItem(
          item.name, // Label
          isDir
            ? vscode.TreeItemCollapsibleState.Collapsed
            : vscode.TreeItemCollapsibleState.None,
          isDir ? "folder" : "file", // Context
          itemUri, // Uri
          element.connection,
          newFullPath // Full path
        );
      });
    }


    return [];
  }
}

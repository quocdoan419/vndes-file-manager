import * as vscode from "vscode";
import SftpClient from "ssh2-sftp-client";
import { Client as FtpClient } from "basic-ftp"; // ✅ sửa import

export type ConnectionType = "ftp" | "sftp";

export interface ConnectionConfig {
  id: string;
  type: ConnectionType;
  host: string;
  port: number;
  username: string;
  password?: string;
  privateKey?: string;
  root?: string;
  passive?: boolean; 
  permissions?: {
    read: boolean;
    write: boolean;
    execute: boolean;
  };
}

export type Connection = ConnectionConfig;

export class ConnectionManager {
  private context: vscode.ExtensionContext;
  private connections: Map<string, any> = new Map();

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
  }

  async addConnection(config: ConnectionConfig): Promise<void> {
     // Store config
    const ids: string[] = this.context.globalState.get("connectionIds", []) || [];
    if (!ids.includes(config.id)) {
      ids.push(config.id);
      await this.context.globalState.update("connectionIds", ids);
    }
    await this.context.secrets.store(`connection-${config.id}`, JSON.stringify(config));

    await this.ensureConnected(config);
  }
async updateConnection(config: ConnectionConfig): Promise<void> {
  const oldClient = this.connections.get(config.id);
  if (oldClient) {
    try {
      if (config.type === "sftp") await oldClient.end();
      else await oldClient.close();
    } catch (err) {
      console.warn(`Error closing old connection ${config.id}: ${err}`);
    }
  }

  if (config.type === "sftp") {
    const client = new SftpClient();
    await client.connect({
      host: config.host,
      port: config.port,
      username: config.username,
      password: config.password,
      privateKey: config.privateKey,
    });
    this.connections.set(config.id, client);
  } else {
    const client = new FtpClient();
    await client.access({
      host: config.host,
      port: config.port,
      user: config.username,
      password: config.password,
      
    });
    this.connections.set(config.id, client);
  }

  await this.context.secrets.store(`connection-${config.id}`, JSON.stringify(config));
}

  async removeConnection(id: string): Promise<void> {
    if (this.connections.has(id)) {
      const client = this.connections.get(id);
      if (client) {
        try {
          if (client.end) await client.end();
          if (client.close) client.close();
        } catch {
          // ignore
        }
      }
      this.connections.delete(id);
    }

    const ids: string[] = this.context.globalState.get("connectionIds", []) || [];
    const newIds = ids.filter(x => x !== id);
    await this.context.globalState.update("connectionIds", newIds);

    await this.context.secrets.delete(`connection-${id}`);
  }

  async listConnections(): Promise<ConnectionConfig[]> {
    const ids: string[] = this.context.globalState.get("connectionIds", []) || [];
    const result: ConnectionConfig[] = [];
    for (const id of ids) {
      const raw = await this.context.secrets.get(`connection-${id}`);
      if (raw) {
        try {
          result.push(JSON.parse(raw));
        } catch {
          // ignore corrupted entry
        }
      }
    }
    return result;
  }

  async getConnection(id: string): Promise<any | undefined> {
    return this.connections.get(id);
  }

  async uploadFile(id: string, localPath: string, remotePath: string): Promise<void> {
    const client = this.connections.get(id);
    if (!client) throw new Error(`Connection ${id} not found`);
    if (client instanceof SftpClient) {
      await client.put(localPath, remotePath);
    } else {
      await client.uploadFrom(localPath, remotePath);
    }
  }

  async downloadFile(id: string, remotePath: string, localPath: string): Promise<void> {
    const client = this.connections.get(id);
    if (!client) throw new Error(`Connection ${id} not found`);
    if (client instanceof SftpClient) {
      await client.get(remotePath, localPath);
    } else {
      await client.downloadTo(localPath, remotePath);
    }
  }

  async rename(id: string, oldPath: string, newPath: string): Promise<void> {
    const client = this.connections.get(id);
    if (!client) throw new Error(`Connection ${id} not found`);
    await client.rename(oldPath, newPath);
  }

  async delete(id: string, remotePath: string): Promise<void> {
    const client = this.connections.get(id);
    if (!client) throw new Error(`Connection ${id} not found`);
    if (client instanceof SftpClient) {
      await client.delete(remotePath);
    } else {
      await client.remove(remotePath);
    }
  }

  async chmod(id: string, remotePath: string, mode: string): Promise<void> {
    const client = this.connections.get(id);
    if (!client) throw new Error(`Connection ${id} not found`);
    if (client instanceof SftpClient) {
      await client.chmod(remotePath, parseInt(mode, 8));
    } else {
      throw new Error("CHMOD not supported for FTP");
    }
  }

  async move(id: string, oldPath: string, newPath: string): Promise<void> {
    await this.rename(id, oldPath, newPath);
  }
async ensureConnected(config: ConnectionConfig) {
  let client = this.connections.get(config.id);
  
  if (client) {
    try {
      if (config.type === "sftp") {
        await client.cwd(); 
      } else {
        await client.send("NOOP"); // FTP keep-alive
      }
      return client;
    } catch (err) {
      // Client đã đóng, tạo lại
      await this.disconnect(config.id);
      client = undefined;
    }
  }

  if (config.type === "sftp") {
    const newClient = new SftpClient();
    await newClient.connect({
      host: config.host,
      port: config.port,
      username: config.username,
      password: config.password,
      privateKey: config.privateKey,
    });
    this.connections.set(config.id, newClient);
    return newClient;
  } else {
    const newClient = new FtpClient();
    await newClient.access({
      host: config.host,
      port: config.port,
      user: config.username,
      password: config.password
    });
    this.connections.set(config.id, newClient);
    return newClient;
  }
}

async disconnect(id: string) {
  const client = this.connections.get(id);
  if (!client) return;
  try {
    if (client instanceof SftpClient) await client.end();
    else await client.close();
  } catch {}
  this.connections.delete(id);
}

async listDirectory(config: ConnectionConfig, remotePath: string): Promise<any[]> {
  const client = await this.ensureConnected(config);
  if (config.type === "sftp") {
    return await client.list(remotePath);
  } else {
    return await client.list(remotePath);
  }
}
async getClientFromUri(uri: vscode.Uri): Promise<{ client: any; connection: any }> {
    const host = uri.authority; // phần sau ftpSsh://
    const key = `${host}:21`; // default port 21, có thể tùy chỉnh

    let entry = this.connections.get(key);
    if (!entry) {
      throw new Error(`No active connection for host ${host}`);
    }
    return entry;
  }
}

from __future__ import annotations

import os
import select
import socket
import socketserver
from dataclasses import dataclass
from pathlib import Path

import paramiko
from dotenv import load_dotenv


BASE_DIR = Path(__file__).resolve().parents[1]
load_dotenv(BASE_DIR / ".env.local", encoding="utf-8-sig")
load_dotenv(BASE_DIR / ".env", encoding="utf-8-sig")


def env_str(name: str, default: str = "") -> str:
    return os.getenv(name, default).strip()


def env_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)).strip())
    except (TypeError, ValueError):
        return default


@dataclass(frozen=True)
class TunnelConfig:
    ssh_host: str = env_str("DB_TUNNEL_SSH_HOST")
    ssh_port: int = env_int("DB_TUNNEL_SSH_PORT", 22)
    ssh_username: str = env_str("DB_TUNNEL_SSH_USERNAME")
    ssh_password: str = env_str("DB_TUNNEL_SSH_PASSWORD")
    ssh_key_path: str = env_str("DB_TUNNEL_SSH_KEY_PATH")
    remote_host: str = env_str("DB_TUNNEL_REMOTE_HOST", "127.0.0.1")
    remote_port: int = env_int("DB_TUNNEL_REMOTE_PORT", 3306)
    local_host: str = env_str("DB_TUNNEL_LOCAL_HOST", "127.0.0.1")
    local_port: int = env_int("DB_TUNNEL_LOCAL_PORT", 3307)


CONFIG = TunnelConfig()


class ForwardHandler(socketserver.BaseRequestHandler):
    def handle(self) -> None:
        transport: paramiko.Transport = self.server.ssh_transport  # type: ignore[attr-defined]
        channel = transport.open_channel(
            "direct-tcpip",
            (CONFIG.remote_host, CONFIG.remote_port),
            self.request.getpeername(),
        )
        if channel is None:
            return

        try:
            while True:
                readable, _, _ = select.select([self.request, channel], [], [])
                if self.request in readable:
                    data = self.request.recv(4096)
                    if not data:
                        break
                    channel.sendall(data)
                if channel in readable:
                    data = channel.recv(4096)
                    if not data:
                        break
                    self.request.sendall(data)
        finally:
            channel.close()
            self.request.close()


class ForwardServer(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


def main() -> None:
    if not CONFIG.ssh_host or not CONFIG.ssh_username:
        raise RuntimeError("Missing DB_TUNNEL_SSH_HOST or DB_TUNNEL_SSH_USERNAME")
    if not CONFIG.ssh_password and not CONFIG.ssh_key_path:
        raise RuntimeError("Missing DB_TUNNEL_SSH_PASSWORD or DB_TUNNEL_SSH_KEY_PATH")

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    connect_kwargs = {
        "hostname": CONFIG.ssh_host,
        "port": CONFIG.ssh_port,
        "username": CONFIG.ssh_username,
        "timeout": 20,
    }
    if CONFIG.ssh_key_path:
        connect_kwargs["key_filename"] = CONFIG.ssh_key_path
    if CONFIG.ssh_password:
        connect_kwargs["password"] = CONFIG.ssh_password
    client.connect(**connect_kwargs)

    transport = client.get_transport()
    if transport is None:
        raise RuntimeError("SSH transport is not available")

    with ForwardServer((CONFIG.local_host, CONFIG.local_port), ForwardHandler) as server:
        server.ssh_transport = transport  # type: ignore[attr-defined]
        print(
            f"Forwarding {CONFIG.local_host}:{CONFIG.local_port} -> "
            f"{CONFIG.remote_host}:{CONFIG.remote_port} via {CONFIG.ssh_host}:{CONFIG.ssh_port}"
        )
        try:
            server.serve_forever()
        finally:
            client.close()


if __name__ == "__main__":
    main()

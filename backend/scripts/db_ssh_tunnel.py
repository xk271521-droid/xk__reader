from __future__ import annotations

import select
import socket
import socketserver
from dataclasses import dataclass

import paramiko


@dataclass(frozen=True)
class TunnelConfig:
    ssh_host: str = "47.99.141.123"
    ssh_port: int = 22
    ssh_username: str = "root"
    ssh_password: str = "271521Lq.."
    remote_host: str = "127.0.0.1"
    remote_port: int = 3306
    local_host: str = "127.0.0.1"
    local_port: int = 3307


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
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(
        hostname=CONFIG.ssh_host,
        port=CONFIG.ssh_port,
        username=CONFIG.ssh_username,
        password=CONFIG.ssh_password,
        timeout=20,
    )

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

#!/usr/bin/env python3
"""为 SPOOLO 启动本地 HTTPS 静态服务器；仅使用 Python 标准库和 OpenSSL。"""

import argparse
import functools
import http.server
import ipaddress
import os
from pathlib import Path
import socket
import ssl
import subprocess
import sys
import tempfile


def local_ipv4_addresses():
    """收集局域网 IPv4；不需要真的向外部地址发送数据。"""
    addresses = {"127.0.0.1"}
    try:
        output = subprocess.check_output(["hostname", "-I"], text=True, stderr=subprocess.DEVNULL)
        for value in output.split():
            try:
                ip = ipaddress.ip_address(value)
                if ip.version == 4:
                    addresses.add(str(ip))
            except ValueError:
                pass
    except (OSError, subprocess.SubprocessError):
        pass
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            sock.connect(("192.0.2.1", 80))
            addresses.add(sock.getsockname()[0])
    except OSError:
        pass
    return sorted(addresses, key=lambda value: ipaddress.ip_address(value))


def make_certificate(addresses):
    """在独立临时目录生成证书，避免私钥进入源码树。"""
    directory = Path(tempfile.mkdtemp(prefix="spoolo-https-"))
    cert = directory / "cert.pem"
    key = directory / "key.pem"
    san = ["DNS:localhost", "IP:127.0.0.1", "IP:0:0:0:0:0:0:0:1"]
    san.extend("IP:" + ip for ip in addresses if ip != "127.0.0.1")
    command = [
        "openssl", "req", "-x509", "-newkey", "rsa:2048", "-sha256",
        "-days", "30", "-nodes", "-subj", "/CN=SPOOLO Local HTTPS",
        "-addext", "basicConstraints=critical,CA:FALSE",
        "-addext", "keyUsage=critical,digitalSignature,keyEncipherment",
        "-addext", "extendedKeyUsage=serverAuth",
        "-addext", "subjectAltName=" + ",".join(san),
        "-keyout", str(key), "-out", str(cert),
    ]
    subprocess.run(command, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    os.chmod(key, 0o600)
    print("自签名证书：" + str(cert), flush=True)
    return cert, key


def main():
    root = Path(__file__).resolve().parent.parent
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="0.0.0.0", help="监听地址，默认 0.0.0.0")
    parser.add_argument("--port", type=int, default=8443, help="监听端口，默认 8443")
    parser.add_argument("--directory", type=Path, default=root, help="静态文件目录，默认仓库根目录")
    parser.add_argument("--cert", type=Path, help="已有 PEM 证书；必须与 --key 一起提供")
    parser.add_argument("--key", type=Path, help="已有 PEM 私钥；必须与 --cert 一起提供")
    args = parser.parse_args()
    if bool(args.cert) != bool(args.key):
        parser.error("--cert 与 --key 必须一起提供")
    if not 1 <= args.port <= 65535:
        parser.error("端口必须在 1–65535 之间")
    if not args.directory.is_dir():
        parser.error("静态文件目录不存在：" + str(args.directory))

    addresses = local_ipv4_addresses()
    cert, key = (args.cert, args.key) if args.cert else make_certificate(addresses)
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(args.directory))
    try:
        server = http.server.ThreadingHTTPServer((args.host, args.port), handler)
    except OSError as error:
        parser.exit(1, "无法监听 %s:%s：%s\n" % (args.host, args.port, error))
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.minimum_version = ssl.TLSVersion.TLSv1_2
    context.load_cert_chain(str(cert), str(key))
    server.socket = context.wrap_socket(server.socket, server_side=True)

    print("\nSPOOLO HTTPS 已启动：", flush=True)
    wildcard = args.host in ("0.0.0.0", "", "::")
    loopback = args.host in ("localhost", "127.0.0.1", "::1")
    if wildcard or loopback:
        print("  https://localhost:%d/" % args.port, flush=True)
    if wildcard:
        for ip in addresses:
            if ip != "127.0.0.1":
                print("  https://%s:%d/" % (ip, args.port), flush=True)
    elif not loopback:
        print("  https://%s:%d/" % (args.host, args.port), flush=True)
    print("\n自签名证书需要浏览器确认信任；按 Ctrl+C 停止。", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n正在停止 HTTPS 服务…", flush=True)
    finally:
        server.server_close()


if __name__ == "__main__":
    try:
        main()
    except subprocess.CalledProcessError:
        sys.exit("生成证书失败，请确认已安装 OpenSSL，或用 --cert/--key 提供已有证书。")

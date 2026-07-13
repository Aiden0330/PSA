"""账户引导 CLI:python -m backend.auth.create_account <username> --role admin

解决先有鸡问题:PSA_AUTH=local 且零账户时无法登录、也就无法经 API 建账户 ——
运维在服务器 shell 显式建第一个 admin。口令走 getpass 交互输入,
绝不收命令行参数(argv 会泄漏进 ps 输出与 shell 历史)。
"""
from __future__ import annotations

import argparse
import getpass
import sys


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Create a BESS-PSA account (bootstrap CLI)")
    p.add_argument("username")
    p.add_argument("--role", choices=("admin", "analyst", "reviewer"), required=True)
    p.add_argument("--display-name", default=None)
    args = p.parse_args(argv)

    pw = getpass.getpass(f"Password for {args.username}: ")
    pw2 = getpass.getpass("Confirm password: ")
    if pw != pw2:
        print("passwords do not match", file=sys.stderr)
        return 2

    from backend import store
    try:
        acc = store.create_account(args.username, pw, args.role, display_name=args.display_name)
    except ValueError as e:
        print(f"error: {e}", file=sys.stderr)
        return 2
    except Exception as e:                       # 重名等
        print(f"error: {e}", file=sys.stderr)
        return 1
    print(f"created account {acc['username']} role={acc['role']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

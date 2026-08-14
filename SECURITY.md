# Security Policy

## Reporting a vulnerability

Please **do not open a public issue** for security vulnerabilities. Instead, report them privately:

- Open a [private security advisory](https://github.com/Chang-Tong/dsh-import-agents/security/advisories/new), or
- Email the maintainer: zdcheerful@hotmail.com

You should receive a response within a few days. If you do not, please follow up.

## Scope

The plugin reads local session stores (`~/.pi`, `~/.local/share/opencode`, `~/.codex`, `~/.claude`) and writes into dsh's session store and skills directory. It has **zero runtime dependencies** and only touches paths under the user's home directory.

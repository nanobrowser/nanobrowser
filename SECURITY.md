# Security Policy

## Reporting a Vulnerability

If you find a security vulnerability, please **do not** disclose it in public issues, pull requests or discussions.

Report it through a [GitHub Security Advisory](https://github.com/nanobrowser/nanobrowser/security/advisories/new), so it can be fixed before it is made public.

## Sensitive actions

The agent hands payments, access grants, secret entry and page-prompt answers to the user by default. The user can enable **Allow sensitive actions** for a conversation. Enabled actions follow Ask/Auto and site rules. Auto or a site Allow rule can permit spending money, granting access or sending secrets without another confirmation.

The default in Settings applies only to new conversations. Only the user can change the conversation setting. The agent cannot enable it through a tool call. Disabling it prevents subsequent protected input, but cannot undo input already sent. Secret masking, page-content boundaries and the prohibition on agent page script and devtools remain in effect.

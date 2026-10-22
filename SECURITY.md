# Security policy

This repository is a demo with synthetic data and is not deployed anywhere. Reports are still welcome.

## Reporting a vulnerability

Please do not open a public issue. Use GitHub's private vulnerability reporting: **Security → Report a vulnerability** on this repository. If that is unavailable, contact DCtech. through https://dctech.live.

Include what you found, how to reproduce it, and the affected commit. You can expect an acknowledgement within a few business days.

## Scope notes

- Demo accounts and their shared password are documented in the README and exist only in the synthetic seed. Never run the seed against a database that holds real data, and set `SEED_PASSWORD` for anything reachable from a network.
- Known limitations (no CSRF token, in-memory rate limiter, no MFA) are listed in the README and are not treated as vulnerabilities.
- The repository is scanned with gitleaks on every push and pull request; Dependabot keeps npm, Docker and GitHub Actions dependencies current.

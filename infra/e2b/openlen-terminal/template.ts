// The real terminal's E2B template (spec local 2026-10-21-real-terminal-e2b, §4): Ubuntu with Node
// 22 (production's, infra/app/setup-node.sh), Python 3 with pip, git, ripgrep, jq, sqlite3, curl and
// unzip, plus OpenLen's scripts in /opt/openlen/bin (lib/agent/sandbox/template-files.ts). Built by
// `npm run sandbox:template`, which writes the scripts to `filesDir` first: E2B's `copy` takes local
// files. API from docs.e2b.dev/template (read 2026-10-21); the SDK is the `e2b` package.

/** The parts of E2B's Template builder this file uses. */
export interface TemplateBuilderLike {
  fromUbuntuImage(version: string): TemplateBuilderLike;
  aptInstall(packages: string[]): TemplateBuilderLike;
  runCmd(command: string, o?: { user?: string }): TemplateBuilderLike;
  copy(from: string, to: string): TemplateBuilderLike;
}

export const APT_PACKAGES = ["ca-certificates", "curl", "git", "ripgrep", "jq", "sqlite3", "unzip", "python3", "python3-pip", "python3-venv"];

export function defineTemplate(Template: () => TemplateBuilderLike, filesDir: string): TemplateBuilderLike {
  return Template()
    .fromUbuntuImage("24.04")
    .aptInstall(APT_PACKAGES)
    .runCmd("curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt-get install -y nodejs", { user: "root" })
    .copy(filesDir, "/opt/openlen/bin")
    .runCmd("chmod 755 /opt/openlen/bin/* && mkdir -p /run/openlen/requests /run/openlen/responses && chown -R user /run/openlen", {
      user: "root",
    })
    // Measured in a real box (21/10): commands run as `user`, and / was root's 755, so nothing could be
    // created or removed at the project's root. Not 1777: with the sticky bit, E2B's file service
    // (root) can't reopen the user's files there (protected_regular). The user has sudo anyway.
    .runCmd("chown user:user /", { user: "root" })
    // Ubuntu 24.04 refuses pip outside a venv (PEP 668); with this, `pip install` goes to ~/.local.
    .runCmd("printf '[global]\\nbreak-system-packages = true\\n' > /etc/pip.conf", { user: "root" })
    // `npm install -g` in the user's home (the box's PATH has its bin, lib/agent/sandbox/sandbox-terminal.ts).
    .runCmd("mkdir -p /home/user/.npm-global && printf 'prefix=/home/user/.npm-global\\n' > /home/user/.npmrc && chown -R user:user /home/user/.npm-global /home/user/.npmrc", {
      user: "root",
    });
}
